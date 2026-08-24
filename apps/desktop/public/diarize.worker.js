// Ledgeur in-browser speaker diarization worker — canonical copy.
//
// EDIT THIS FILE ONLY. It is copied verbatim into each app's public/ directory
// by packages/asr/sync.mjs (wired into predev/prebuild); a test fails the build
// if a copy drifts.
//
// Answers "who was speaking, and when" for a finished recording, entirely on
// the user's machine. It does NOT decide what the words were — that is
// transcribe.worker.js — and it does not decide who "Speaker 2" really is;
// clustering and identity live in @ledgeur/core so they can be unit-tested
// without a browser.
//
// What this worker owns is the part that genuinely needs the models:
//   1. Walk the audio in windows and ask pyannote where the voice changes.
//   2. For each turn long enough to be worth it, ask WeSpeaker for a voice
//      vector.
// The caller clusters those vectors into speakers.
//
// Like the ASR worker, one instance runs exactly ONE rung of the load plan: a
// failed onnxruntime session poisons the runtime for the whole worker, so the
// controller discards this worker and spawns a fresh one for the next rung.
//
// Messages in:
//   { type: "load",    attempt }
//   { type: "diarize", id, audio, sampleRate, attempt }
//   { type: "embed",   id, audio, sampleRate, attempt }   // one voice-print
// Messages out:
//   { status: "device", device, label, runtime, attempt }
//   { status: "progress", file, progress }
//   { status: "ready", attempt }
//   { status: "stage", id, stage, done, total }
//   { status: "result", id, turns, embeddings, embeddedIndices, durationSeconds }
//   { status: "embedding", id, embedding }
//   { status: "load-error", attempt, hasNext, message, friendly }
//   { status: "error", id, message }

import {
  buildDiarizePlan, friendlyDiarizeError, planWindows,
  SEGMENTATION_MODEL, EMBEDDING_MODEL,
  MAX_EMBED_SECONDS, MIN_EMBED_SECONDS, DIARIZE_SAMPLE_RATE,
} from "./diarize-plan.js";

async function hasWebGpu() {
  try {
    if (typeof navigator !== "undefined" && navigator.gpu) {
      return Boolean(await navigator.gpu.requestAdapter());
    }
  } catch {
    /* fall through to wasm */
  }
  return false;
}

let capsPromise = null;
const caps = () => (capsPromise ??= hasWebGpu().then((webgpu) => ({ webgpu })));

const onProgress = (x) => {
  if (x.status === "progress") {
    self.postMessage({ status: "progress", file: x.file, progress: Math.round(x.progress || 0) });
  }
};

/** The models this worker instance owns, keyed by attempt. */
let loaded = null; // { key, promise }

function load(attempt) {
  const key = String(attempt);
  if (loaded && loaded.key === key) return loaded.promise;

  const promise = (async () => {
    const plan = buildDiarizePlan(await caps());
    const step = plan[attempt];
    if (!step) {
      const err = new Error("No diarization backend available for this browser.");
      err.hasNext = false;
      throw err;
    }
    try {
      const mod = await import(/* @vite-ignore */ `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${step.runtime}`);
      const { AutoProcessor, AutoModelForAudioFrameClassification, AutoModel, env } = mod;
      env.allowLocalModels = false;

      self.postMessage({
        status: "device", device: step.device, label: step.label, runtime: step.runtime, attempt,
      });

      // Segmentation and embedding are loaded together: a transcript with turns
      // but no voice vectors would give every window its own "Speaker 1", which
      // is worse than no labels at all.
      const [processor, segmenter, embedProcessor, embedder] = await Promise.all([
        AutoProcessor.from_pretrained(SEGMENTATION_MODEL),
        AutoModelForAudioFrameClassification.from_pretrained(SEGMENTATION_MODEL, {
          device: step.device, dtype: step.dtype, progress_callback: onProgress,
        }),
        AutoProcessor.from_pretrained(EMBEDDING_MODEL),
        AutoModel.from_pretrained(EMBEDDING_MODEL, {
          device: step.device, dtype: step.dtype, progress_callback: onProgress,
        }),
      ]);
      return { processor, segmenter, embedProcessor, embedder };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      err.hasNext = attempt + 1 < plan.length;
      throw err;
    }
  })();

  loaded = { key, promise };
  promise.catch(() => { if (loaded && loaded.key === key) loaded = null; });
  return promise;
}

function postLoadError(err, attempt) {
  const hasNext = Boolean(err && err.hasNext);
  self.postMessage({
    status: "load-error",
    attempt,
    hasNext,
    message: err && err.message ? err.message : String(err),
    friendly: friendlyDiarizeError(err, { exhausted: !hasNext }),
  });
}

/**
 * The embedding model returns a bare tensor whose ONNX output name is not part
 * of any published contract, so we take the first float output rather than
 * hard-coding a key that a future re-export could rename. Anything else would
 * fail silently as "every speaker is identical".
 */
function firstFloatTensor(output) {
  if (!output) return null;
  if (output.data instanceof Float32Array) return output;
  for (const value of Object.values(output)) {
    if (value && value.data instanceof Float32Array) return value;
  }
  return null;
}

/** Voice vector for one slice of PCM, or null when the model gives nothing. */
async function embedSlice(models, slice) {
  const inputs = await models.embedProcessor(slice);
  const output = await models.embedder(inputs);
  const tensor = firstFloatTensor(output);
  if (!tensor) return null;
  return Array.from(tensor.data);
}

/**
 * Where the voice changes, across the whole clip.
 *
 * Returns turns whose `speaker` is local to the window they came from — which
 * is why every one of them also gets an embedding. Reconciling them is the
 * caller's job (clusterEmbeddings in @ledgeur/core).
 */
async function segment(models, audio, sampleRate, id) {
  const windows = planWindows(audio.length, sampleRate);
  const turns = [];

  for (let w = 0; w < windows.length; w++) {
    const win = windows[w];
    const slice = audio.subarray(win.start, win.end);
    // A window that is essentially silence still costs a full model pass.
    if (slice.length < sampleRate * 0.2) continue;

    const inputs = await models.processor(slice);
    const { logits } = await models.segmenter(inputs);
    const [local] = models.processor.post_process_speaker_diarization(logits, slice.length);

    for (const turn of local ?? []) {
      const start = turn.start + win.offsetSeconds;
      const end = turn.end + win.offsetSeconds;
      if (!(end > start)) continue;
      turns.push({
        start,
        end,
        // Windows overlap, so a local id must be namespaced by its window or
        // window 2's "speaker 0" would be merged into window 1's.
        speaker: w * 8 + turn.id,
        confidence: typeof turn.confidence === "number" ? turn.confidence : 0,
      });
    }
    self.postMessage({ status: "stage", id, stage: "segmenting", done: w + 1, total: windows.length });
  }

  return dedupeOverlaps(turns);
}

/**
 * Windows overlap by design, so the same two seconds of speech can arrive as
 * two turns with different local ids. Keeping both would double-count that
 * person's talking time and hand the clusterer two vectors where one belongs.
 *
 * A later turn is trimmed to start where the previous one ended; if that leaves
 * nothing, it is dropped.
 */
function dedupeOverlaps(turns) {
  const sorted = [...turns].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const turn of sorted) {
    const last = out[out.length - 1];
    if (!last || turn.start >= last.end) { out.push({ ...turn }); continue; }
    const trimmed = { ...turn, start: last.end };
    if (trimmed.end - trimmed.start > 0.05) out.push(trimmed);
  }
  return out;
}

self.addEventListener("message", async (event) => {
  const { type, id, audio, sampleRate, attempt: rawAttempt } = event.data || {};
  const attempt = Number(rawAttempt) || 0;
  const rate = Number(sampleRate) || DIARIZE_SAMPLE_RATE;

  if (type === "load") {
    try {
      await load(attempt);
      self.postMessage({ status: "ready", attempt });
    } catch (err) {
      postLoadError(err, attempt);
    }
    return;
  }

  if (type === "embed") {
    let models;
    try {
      models = await load(attempt);
    } catch (err) {
      postLoadError(err, attempt);
      self.postMessage({ status: "error", id, message: friendlyDiarizeError(err, { exhausted: !err?.hasNext }) });
      return;
    }
    try {
      const capped = audio.length > rate * MAX_EMBED_SECONDS
        ? audio.subarray(0, Math.round(rate * MAX_EMBED_SECONDS))
        : audio;
      self.postMessage({ status: "embedding", id, embedding: await embedSlice(models, capped) });
    } catch (err) {
      self.postMessage({ status: "error", id, message: err && err.message ? err.message : String(err) });
    }
    return;
  }

  if (type === "diarize") {
    let models;
    try {
      models = await load(attempt);
    } catch (err) {
      postLoadError(err, attempt);
      self.postMessage({ status: "error", id, message: friendlyDiarizeError(err, { exhausted: !err?.hasNext }) });
      return;
    }

    try {
      const turns = await segment(models, audio, rate, id);

      // Only turns with enough voice in them are embedded. The rest still
      // appear in the transcript — they inherit a neighbour's speaker — but
      // clustering on half a second of "mm-hm" invents speakers that are not
      // in the room.
      const embeddings = [];
      const embeddedIndices = [];
      const worth = turns
        .map((t, i) => [t, i])
        .filter(([t]) => t.end - t.start >= MIN_EMBED_SECONDS);

      for (let k = 0; k < worth.length; k++) {
        const [turn, index] = worth[k];
        const from = Math.max(0, Math.round(turn.start * rate));
        const span = Math.min(
          Math.round((turn.end - turn.start) * rate),
          Math.round(MAX_EMBED_SECONDS * rate),
        );
        const slice = audio.subarray(from, Math.min(audio.length, from + span));
        try {
          const embedding = await embedSlice(models, slice);
          if (embedding && embedding.length) { embeddings.push(embedding); embeddedIndices.push(index); }
        } catch {
          // One unembeddable turn is a turn that inherits a neighbour, not a
          // failed meeting.
        }
        self.postMessage({ status: "stage", id, stage: "identifying", done: k + 1, total: worth.length });
      }

      self.postMessage({
        status: "result",
        id,
        turns,
        embeddings,
        embeddedIndices,
        durationSeconds: audio.length / rate,
      });
    } catch (err) {
      self.postMessage({ status: "error", id, message: err && err.message ? err.message : String(err) });
    }
  }
});
