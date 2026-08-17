// Canonical speech-to-text load plan — the single source of truth for which
// transformers.js runtime, Whisper model and quantisation every Ledgeur surface
// (marketing recorder + desktop app) uses in the browser/webview.
//
// Plain ESM JavaScript on purpose: this exact file is served from /asr-plan.js
// and imported by the transcription Web Worker, AND imported directly by the
// Node test suite. No build step, no second copy to drift.
//
// ── Why a *plan* (a ladder) rather than one config ──────────────────────────
// transformers.js 4.x bundles an onnxruntime-web dev build whose QDQ optimiser
// rejects the published int8 ("q8") Whisper exports:
//
//   Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE: qdq_actions.cc:137
//   TransposeDQWeightsForMatMulNBits Missing required scale:
//   model.decoder.embed_tokens.weight_merged_0_scale
//
// q8 is the default dtype on the WASM backend, so *every* user without WebGPU
// hit this and could not transcribe at all. Verified in Chrome 152:
//
//   runtime  device  dtype  result
//   4.2.0    wasm    q8     FAIL (the error above)
//   4.2.0    wasm    fp32   ok  (152 MB, ~27 s first load)
//   3.8.1    wasm    q8     ok  ( 41 MB, ~9 s first load)
//   3.8.1    webgpu  fp32   ok
//   4.2.0    webgpu  fp32   ok
//
// Upstream issue: https://github.com/huggingface/transformers.js/issues/1707
//
// Critically, a failed session creation POISONS the onnxruntime instance: a
// subsequent load of a known-good model in the same page/worker fails with the
// same stale error. So a fallback must be attempted in a FRESH worker — which
// is why the plan is a list the controller walks one rung at a time, tearing
// the worker down in between.

/** transformers.js releases we pin to, both verified end-to-end (see table above). */
export const RUNTIMES = Object.freeze({
  /** Newest release whose onnxruntime-web loads the int8 Whisper exports. */
  stable: "3.8.1",
  /** Latest release — fp32 only, used as a last-resort rung. */
  latest: "4.2.0",
});

/** Supported transcription languages/qualities. */
export const LANGS = Object.freeze(["en", "en-hq", "multi"]);

// WebGPU uses the onnx-community builds (WebGPU-optimised); WASM uses the
// Xenova builds, which ship the small int8 exports.
const MODELS = Object.freeze({
  "en": { webgpu: "onnx-community/whisper-tiny.en", wasm: "Xenova/whisper-tiny.en" },
  "en-hq": { webgpu: "onnx-community/whisper-base.en", wasm: "Xenova/whisper-base.en" },
  "multi": { webgpu: "onnx-community/whisper-base", wasm: "Xenova/whisper-tiny" },
});

/** CDN module URL for a pinned transformers.js version. */
export function runtimeUrl(version) {
  return `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${version}`;
}

/** Normalise an arbitrary lang input to a supported one (defaults to "en"). */
export function normaliseLang(lang) {
  return LANGS.includes(lang) ? lang : "en";
}

/**
 * @typedef {object} AsrAttempt
 * @property {string} id            Stable identifier, used in logs/tests.
 * @property {string} runtime       transformers.js version to import.
 * @property {"webgpu"|"wasm"} device
 * @property {string} model         Hugging Face model id.
 * @property {string} dtype         Explicit dtype — never rely on runtime defaults.
 * @property {string} label         Human-readable, shown in the UI.
 */

/**
 * Ordered list of load attempts, best first. Each rung is tried in a fresh
 * worker; the first that creates a session wins.
 *
 * @param {string} lang "en" | "en-hq" | "multi"
 * @param {{ webgpu?: boolean }} caps Detected device capabilities.
 * @returns {AsrAttempt[]}
 */
export function buildLoadPlan(lang, caps = {}) {
  const models = MODELS[normaliseLang(lang)];
  /** @type {AsrAttempt[]} */
  const plan = [];

  if (caps.webgpu) {
    plan.push({
      id: "webgpu-fp32",
      runtime: RUNTIMES.stable,
      device: "webgpu",
      model: models.webgpu,
      dtype: "fp32",
      label: "WebGPU",
    });
  }

  // The workhorse for everyone without WebGPU: smallest download that works.
  plan.push({
    id: "wasm-q8",
    runtime: RUNTIMES.stable,
    device: "wasm",
    model: models.wasm,
    dtype: "q8",
    label: "CPU",
  });

  // Last resort: a different runtime major AND an unquantised model, so a bad
  // CDN release or a future optimiser regression on either axis still leaves a
  // working path. Bigger download, hence last.
  plan.push({
    id: "wasm-fp32",
    runtime: RUNTIMES.latest,
    device: "wasm",
    model: models.wasm,
    dtype: "fp32",
    label: "CPU (uncompressed model)",
  });

  return plan;
}

/**
 * Turn a raw onnxruntime/transformers.js failure into something a person can
 * act on. The raw text is kept on a second line for support/bug reports —
 * never swallowed, so failures stay diagnosable.
 *
 * @param {unknown} err
 * @param {{ exhausted?: boolean }} [opts] exhausted = every rung of the plan failed.
 * @returns {string}
 */
export function friendlyAsrError(err, opts = {}) {
  const raw = String((err && /** @type {any} */ (err).message) || err || "").trim();
  const lower = raw.toLowerCase();

  let lead;
  if (/can't create a session|qdq_actions|matmulnbits|failed to load model|invalidgraph|invalid_graph/i.test(raw)) {
    lead = opts.exhausted
      ? "This browser couldn't start the speech model. Please update your browser (or try Chrome or Edge) and reload."
      : "Couldn't start the speech model — retrying with a more compatible build…";
  } else if (/failed to fetch|networkerror|load failed|err_internet|network request failed|fetch failed/i.test(lower)) {
    lead = "Couldn't download the speech model. Check your connection (or a corporate firewall blocking huggingface.co) and try again.";
  } else if (/out of memory|oom|allocation failed|aborted\(/i.test(lower)) {
    lead = "Ran out of memory loading the speech model. Close some tabs and try again — or use the desktop app for long meetings.";
  } else if (/no available backend|webgpu|webassembly|wasm/i.test(lower) && /not (supported|available)|unsupported/i.test(lower)) {
    lead = "This browser can't run on-device transcription. Please use an up-to-date Chrome, Edge, Firefox or Safari.";
  } else {
    lead = "Transcription failed to start.";
  }

  return raw ? `${lead}\n(${raw})` : lead;
}
