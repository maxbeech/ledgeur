// Canonical speaker-diarization plan — the single source of truth for which
// models, quantisations and window sizes every Ledgeur surface uses to work out
// who is speaking. Sibling of asr-plan.js, and deliberately the same shape.
//
// Plain ESM JavaScript on purpose: this exact file is served from
// /diarize-plan.js and imported by the diarization Web Worker, AND imported
// directly by the Node test suite. No build step, no second copy to drift.
//
// ── The two models ──────────────────────────────────────────────────────────
// Segmentation — `onnx-community/pyannote-segmentation-3.0`. A SincNet+BiLSTM
// with a "powerset" head over 7 classes (silence, each of 3 speakers, and each
// of the 3 overlapping pairs), so it handles people talking over each other,
// which is the case a naive energy-based splitter always gets wrong. MIT, and
// un-gated — pyannote's own repo requires accepting terms, which would make the
// first run of a private, offline product depend on a login. This mirror does
// not.
//
// Embedding — `onnx-community/wespeaker-voxceleb-resnet34-LM`. Turns a slice of
// one person's speech into a 256-d vector that is close to other slices of the
// same person, and far from everyone else. This is what makes a name stick
// between meetings.
//
// Both are ~10–30 MB, downloaded once and then cached by the browser, and both
// run entirely on the user's machine. No audio leaves the device, which is the
// whole promise of the product — a hosted diarization API would quietly break
// it.
//
// ── Why fp32 ────────────────────────────────────────────────────────────────
// The int8 exports exist, but see asr-plan.js: a failed onnxruntime session
// poisons the runtime for the whole worker, and these two models are small
// enough that the download saving is not worth re-running that gauntlet. fp32
// first; a quantised rung is kept as a fallback for memory-constrained devices.

/** transformers.js release used for diarization. Pinned to the same version the
 *  ASR ladder trusts, so a page never loads two runtime majors at once. */
export const DIARIZE_RUNTIME = "3.8.1";

export const SEGMENTATION_MODEL = "onnx-community/pyannote-segmentation-3.0";
export const EMBEDDING_MODEL = "onnx-community/wespeaker-voxceleb-resnet34-LM";

/** Both models are trained at 16 kHz — the same rate Whisper wants, so one
 *  decode of the audio feeds all three models. */
export const DIARIZE_SAMPLE_RATE = 16000;

/**
 * Seconds of audio handed to the segmentation model at a time.
 *
 * pyannote 3.0 is trained on 10-second chunks; its speaker indices are only
 * meaningful inside one such chunk, and its accuracy degrades on longer input.
 * So the audio is walked in windows and the resulting local speakers are
 * reconciled globally afterwards by clustering their embeddings.
 */
export const WINDOW_SECONDS = 10;

/**
 * How far the window advances. Less than {@link WINDOW_SECONDS}, so every
 * boundary is covered by two passes — a turn that starts 0.2 s before a window
 * ends is otherwise a 0.2 s fragment nobody can embed.
 */
export const WINDOW_STRIDE_SECONDS = 8;

/** Longest slice of a single turn that is embedded. Beyond a few seconds the
 *  embedding stops improving, and a 20-minute monologue would otherwise
 *  allocate a 20-minute mel spectrogram. */
export const MAX_EMBED_SECONDS = 8;

/** WeSpeakerFeatureExtractor needs at least `min_num_frames` (9) frames at a
 *  10 ms shift plus the 25 ms window — a hard floor of ~0.115 s. We stay well
 *  above it: below about a second the embedding is too noisy to cluster on. */
export const MIN_EMBED_SECONDS = 0.9;

/**
 * @typedef {object} DiarizeAttempt
 * @property {string} id       Stable identifier, used in logs and tests.
 * @property {string} runtime  transformers.js version to import.
 * @property {"webgpu"|"wasm"} device
 * @property {string} dtype    Explicit dtype — never rely on runtime defaults.
 * @property {string} label    Human-readable, shown in the UI.
 */

/**
 * Ordered load attempts, best first. Same contract as buildLoadPlan in
 * asr-plan.js: each rung is tried in a fresh worker, and the first that creates
 * a session wins.
 *
 * WebGPU is offered first where available but is not required — diarization on
 * WASM is perfectly usable, because it runs once at the end of a meeting rather
 * than continuously during it.
 *
 * @param {{ webgpu?: boolean }} caps Detected device capabilities.
 * @returns {DiarizeAttempt[]}
 */
export function buildDiarizePlan(caps = {}) {
  /** @type {DiarizeAttempt[]} */
  const plan = [];
  if (caps.webgpu) {
    plan.push({ id: "webgpu-fp32", runtime: DIARIZE_RUNTIME, device: "webgpu", dtype: "fp32", label: "WebGPU" });
  }
  plan.push({ id: "wasm-fp32", runtime: DIARIZE_RUNTIME, device: "wasm", dtype: "fp32", label: "CPU" });
  // Last resort for a device that cannot hold the fp32 weights.
  plan.push({ id: "wasm-q8", runtime: DIARIZE_RUNTIME, device: "wasm", dtype: "q8", label: "CPU (compressed model)" });
  return plan;
}

/**
 * Window boundaries for a clip, in samples.
 *
 * The final window is snapped back to end exactly at the clip end rather than
 * running past it, so the last few seconds are never processed as a window
 * mostly full of silence — Whisper and pyannote both behave badly on that.
 *
 * @param {number} totalSamples
 * @param {number} sampleRate
 * @returns {{ start: number, end: number, offsetSeconds: number }[]}
 */
export function planWindows(totalSamples, sampleRate = DIARIZE_SAMPLE_RATE) {
  if (!(totalSamples > 0) || !(sampleRate > 0)) return [];
  const size = Math.round(WINDOW_SECONDS * sampleRate);
  const stride = Math.round(WINDOW_STRIDE_SECONDS * sampleRate);
  if (totalSamples <= size) {
    return [{ start: 0, end: totalSamples, offsetSeconds: 0 }];
  }

  const windows = [];
  for (let start = 0; start < totalSamples; start += stride) {
    const end = Math.min(start + size, totalSamples);
    windows.push({ start, end, offsetSeconds: start / sampleRate });
    if (end >= totalSamples) break;
  }
  return windows;
}

/**
 * Turn a raw diarization failure into something a person can act on. Same
 * contract as friendlyAsrError — the raw text is kept on a second line so a bug
 * report is still diagnosable.
 *
 * Diarization failing is never fatal: the transcript is still correct, it just
 * has no names on it. The wording says so, because a scary error over a working
 * transcript is worse than the missing feature.
 *
 * @param {unknown} err
 * @param {{ exhausted?: boolean }} [opts]
 * @returns {string}
 */
export function friendlyDiarizeError(err, opts = {}) {
  const raw = String((err && /** @type {any} */ (err).message) || err || "").trim();
  const lower = raw.toLowerCase();

  let lead;
  if (/failed to fetch|networkerror|load failed|err_internet|network request failed|fetch failed/i.test(lower)) {
    lead = "Couldn't download the speaker models, so this transcript has no speaker labels. Check your connection (or a firewall blocking huggingface.co) and run it again.";
  } else if (/out of memory|oom|allocation failed|aborted\(/i.test(lower)) {
    lead = "Ran out of memory working out who was speaking, so this transcript has no speaker labels. The transcript itself is unaffected.";
  } else if (/can't create a session|invalidgraph|invalid_graph|failed to load model/i.test(lower)) {
    lead = opts.exhausted
      ? "This browser couldn't start the speaker models, so this transcript has no speaker labels. The transcript itself is unaffected."
      : "Couldn't start the speaker models — retrying with a more compatible build…";
  } else {
    lead = "Couldn't work out who was speaking, so this transcript has no speaker labels. The transcript itself is unaffected.";
  }

  return raw ? `${lead}\n(${raw})` : lead;
}
