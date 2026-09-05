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

/**
 * Supported transcription tiers.
 *
 * `en`/`en-hq` are the English-only Whisper exports. `multi` is the
 * multilingual one, and may carry a spoken-language code — `multi:fr` — which
 * is passed to Whisper as a decoding hint. See SPOKEN_LANGUAGES.
 */
export const LANGS = Object.freeze(["en", "en-hq", "multi"]);

/**
 * The spoken languages offered for the multilingual model.
 *
 * ── Why a list, and why these ───────────────────────────────────────────────
 * "Other languages" used to mean: run multilingual Whisper and let it detect
 * the language from the first 30 seconds. That is a real feature and it is also
 * the source of the worst failure this app can have — a meeting that opens in
 * English pleasantries and continues in German is transcribed as an entire
 * meeting of hallucinated English, confidently, with no error anywhere. Telling
 * Whisper the language removes that failure mode outright, and also improves
 * accuracy within the language, because the decoder is no longer spending its
 * first tokens deciding.
 *
 * The set is the languages Whisper actually handles, ordered by the word error
 * rates in the Whisper paper's own evaluation (Appendix D, large-v3 on FLEURS),
 * and each carries an honest `tier`:
 *
 *   strong  usable transcripts from the base multilingual model.
 *   fair    recognisable but with real errors; names and numbers need checking.
 *
 * `tier` is shown in the picker. Whisper supports ~99 languages, but most of
 * the tail is unusable at the model sizes that run on a laptop in real time,
 * and offering them would be offering something that does not work.
 */
export const SPOKEN_LANGUAGES = Object.freeze([
  { code: "es", label: "Spanish", tier: "strong" },
  { code: "it", label: "Italian", tier: "strong" },
  { code: "pt", label: "Portuguese", tier: "strong" },
  { code: "de", label: "German", tier: "strong" },
  { code: "ca", label: "Catalan", tier: "strong" },
  { code: "nl", label: "Dutch", tier: "strong" },
  { code: "fr", label: "French", tier: "strong" },
  { code: "id", label: "Indonesian", tier: "strong" },
  { code: "pl", label: "Polish", tier: "strong" },
  { code: "ja", label: "Japanese", tier: "strong" },
  { code: "ru", label: "Russian", tier: "strong" },
  { code: "sv", label: "Swedish", tier: "strong" },
  { code: "ko", label: "Korean", tier: "strong" },
  { code: "no", label: "Norwegian", tier: "strong" },
  { code: "fi", label: "Finnish", tier: "strong" },
  { code: "da", label: "Danish", tier: "strong" },
  { code: "uk", label: "Ukrainian", tier: "strong" },
  { code: "tr", label: "Turkish", tier: "strong" },
  { code: "cs", label: "Czech", tier: "strong" },
  { code: "ro", label: "Romanian", tier: "strong" },
  { code: "el", label: "Greek", tier: "fair" },
  { code: "zh", label: "Chinese", tier: "fair" },
  { code: "hu", label: "Hungarian", tier: "fair" },
  { code: "he", label: "Hebrew", tier: "fair" },
  { code: "ms", label: "Malay", tier: "fair" },
  { code: "vi", label: "Vietnamese", tier: "fair" },
  { code: "ar", label: "Arabic", tier: "fair" },
  { code: "hi", label: "Hindi", tier: "fair" },
  { code: "th", label: "Thai", tier: "fair" },
  { code: "bg", label: "Bulgarian", tier: "fair" },
  { code: "sk", label: "Slovak", tier: "fair" },
  { code: "hr", label: "Croatian", tier: "fair" },
]);

const SPOKEN_CODES = new Set(SPOKEN_LANGUAGES.map((l) => l.code));

/**
 * How each option is described to a person, kept beside the plan it must match.
 *
 * A picker offering a value the plan does not know silently falls back to
 * English — somebody selects "Other languages", gets an English-only model, and
 * the transcript comes out as nonsense with no error anywhere. Defining the
 * labels here, in the same file as LANGS, means the two cannot drift, and a
 * test asserts every option maps to a real rung.
 */
export const LANG_OPTIONS = Object.freeze([
  { value: "en", label: "English", hint: "Fastest. Best for English-only meetings." },
  { value: "en-hq", label: "English, more accurate", hint: "A larger model. Slower to download and to run." },
  { value: "multi", label: "Detect the language", hint: "Multilingual. Picks the language itself — say which one below if you know it." },
  ...SPOKEN_LANGUAGES.map((l) => ({
    value: `multi:${l.code}`,
    label: l.label,
    hint: l.tier === "strong"
      ? "Multilingual model, told to expect this language."
      : "Multilingual model. Workable, but check names and numbers.",
  })),
]);

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

/**
 * Normalise an arbitrary lang input to a supported one (defaults to "en").
 *
 * Accepts both the tier on its own ("multi") and a tier with a spoken language
 * ("multi:fr"). An unknown spoken code degrades to plain "multi" — detection
 * rather than English, because somebody who asked for a language other than
 * English should never silently get an English-only model.
 */
export function normaliseLang(lang) {
  if (typeof lang !== "string") return "en";
  if (LANGS.includes(lang)) return lang;
  if (lang.startsWith("multi:")) {
    return SPOKEN_CODES.has(lang.slice(6)) ? lang : "multi";
  }
  return "en";
}

/** The tier a lang value belongs to — the key into MODELS. */
export function langTier(lang) {
  const norm = normaliseLang(lang);
  return norm.startsWith("multi:") ? "multi" : norm;
}

/**
 * The language code to hand Whisper, or null to let it decide.
 *
 * Null for the English-only models too: passing `language` to an English-only
 * export is rejected by transformers.js, and the model has nothing to decide
 * anyway.
 */
export function whisperLanguage(lang) {
  const norm = normaliseLang(lang);
  return norm.startsWith("multi:") ? norm.slice(6) : null;
}

/** The human label for a lang value, for UI and logs. */
export function langLabel(lang) {
  const norm = normaliseLang(lang);
  return LANG_OPTIONS.find((o) => o.value === norm)?.label ?? norm;
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
  const models = MODELS[langTier(lang)];
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
