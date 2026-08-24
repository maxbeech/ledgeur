// Ledgeur in-browser transcription worker — canonical copy.
//
// EDIT THIS FILE ONLY. It is copied verbatim into each app's public/ directory
// by packages/asr/sync.mjs (wired into predev/prebuild); a test fails the build
// if a copy drifts.
//
// Loads transformers.js from the jsDelivr CDN (so the Next.js/Vite builds never
// bundle the onnxruntime ML stack — fast deploys, no OOM) and runs OpenAI
// Whisper entirely on the user's device. Model weights stream from the Hugging
// Face CDN on first use and are then cached by the browser.
//
// One worker instance runs exactly ONE rung of the load plan (see asr-plan.js):
// a failed onnxruntime session poisons the runtime for the whole worker, so the
// controller discards this worker and spawns a fresh one for the next rung.
//
// Messages in:
//   { type: "load",       lang, attempt }
//   { type: "transcribe", id, audio, lang, attempt, offsetSeconds }
// Messages out:
//   { status: "device", device, label, model, runtime, attempt }
//   { status: "progress", file, progress }
//   { status: "ready", attempt }
//   { status: "result", id, text, chunks }   chunks: [{ text, start, end }]
//   { status: "load-error", attempt, hasNext, message, friendly }
//   { status: "error", id, message }

import { buildLoadPlan, friendlyAsrError, normaliseLang, runtimeUrl } from "./asr-plan.js";

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

/** The single pipeline this worker instance owns, keyed by lang+attempt. */
let loaded = null; // { key, promise }

function load(lang, attempt) {
  const key = `${normaliseLang(lang)}#${attempt}`;
  if (loaded && loaded.key === key) return loaded.promise;

  const promise = (async () => {
    const plan = buildLoadPlan(lang, await caps());
    const step = plan[attempt];
    if (!step) {
      const err = new Error("No transcription backend available for this browser.");
      err.hasNext = false;
      throw err;
    }
    try {
      const { pipeline, env } = await import(/* @vite-ignore */ runtimeUrl(step.runtime));
      // Models always come from the Hub CDN — no local model files in these apps.
      env.allowLocalModels = false;
      self.postMessage({
        status: "device",
        device: step.device,
        label: step.label,
        model: step.model,
        runtime: step.runtime,
        attempt,
      });
      const instance = await pipeline("automatic-speech-recognition", step.model, {
        device: step.device,
        dtype: step.dtype,
        progress_callback: onProgress,
      });
      return instance;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      err.hasNext = attempt + 1 < plan.length;
      throw err;
    }
  })();

  loaded = { key, promise };
  // A failed attempt must not be cached — the controller retries in a fresh
  // worker, but clearing keeps this instance honest if it is reused.
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
    friendly: friendlyAsrError(err, { exhausted: !hasNext }),
  });
}

self.addEventListener("message", async (event) => {
  const { type, id, audio, lang } = event.data || {};
  const attempt = Number(event.data?.attempt) || 0;
  // Live capture transcribes 20-second slices; without this every slice would
  // report timings starting at 0 and the whole transcript would sit on top of
  // itself. A whole-file transcription passes 0.
  const offsetSeconds = Number(event.data?.offsetSeconds) || 0;

  if (type === "load") {
    try {
      await load(lang, attempt);
      self.postMessage({ status: "ready", attempt });
    } catch (err) {
      postLoadError(err, attempt);
    }
    return;
  }

  if (type === "transcribe") {
    let transcriber;
    try {
      transcriber = await load(lang, attempt);
    } catch (err) {
      // Report the load failure so the controller can walk the plan, and fail
      // this request explicitly — never silently drop it.
      postLoadError(err, attempt);
      self.postMessage({ status: "error", id, message: friendlyAsrError(err, { exhausted: !err?.hasNext }) });
      return;
    }
    try {
      // `return_timestamps` is what makes speaker labels possible: without
      // timings the transcript is one undifferentiated string and there is
      // nothing to line up against the diarization turns. It costs nothing
      // extra — Whisper already predicts timestamp tokens.
      const output = await transcriber(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
      });
      const first = Array.isArray(output) ? output[0] : output;
      const text = (first?.text || "").trim();
      // Shape: [{ text, timestamp: [startSeconds, endSeconds|null] }]. The end
      // of the final chunk can be null when the audio stops mid-utterance.
      const chunks = Array.isArray(first?.chunks)
        ? first.chunks
            .map((c) => ({
              text: String(c?.text ?? "").trim(),
              start: Number(c?.timestamp?.[0] ?? 0) + offsetSeconds,
              end: c?.timestamp?.[1] == null ? null : Number(c.timestamp[1]) + offsetSeconds,
            }))
            .filter((c) => c.text.length > 0)
        : [];
      self.postMessage({ status: "result", id, text, chunks });
    } catch (err) {
      self.postMessage({ status: "error", id, message: err && err.message ? err.message : String(err) });
    }
  }
});
