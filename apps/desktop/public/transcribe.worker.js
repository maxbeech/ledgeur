// ParleyNotes in-browser transcription worker.
//
// Loads transformers.js straight from the jsDelivr CDN (so the Next.js build
// never has to bundle the onnxruntime ML stack — fast deploys, no OOM) and runs
// OpenAI Whisper entirely on the user's device. Whisper model weights stream
// from the Hugging Face CDN on first use and are then cached by the browser.
//
// Messages in:  { type: "load", lang } | { type: "transcribe", id, audio, lang }
//   lang: "en" (English-only, faster) | "multi" (multilingual)
// Messages out: { status: "device", device } | { status: "progress", file, progress }
//               | { status: "ready" } | { status: "result", id, text }
//               | { status: "error", id?, message }

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";

// We always fetch models from the Hub CDN (no local model files in this app).
env.allowLocalModels = false;

async function pickDevice() {
  try {
    if (typeof navigator !== "undefined" && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return "webgpu";
    }
  } catch {
    /* fall through to wasm */
  }
  return "wasm";
}

// Model matrix. Default ("en") is the small tiny.en model so the FIRST load is
// fast (~40MB) — important for the "try a sample" first impression. "en-hq"
// opts into the larger, more accurate base.en. "multi" is multilingual.
// WebGPU uses onnx-community builds (webgpu-optimised); WASM uses Xenova builds.
function modelFor(device, lang) {
  const webgpu = device === "webgpu";
  if (lang === "multi") return webgpu ? "onnx-community/whisper-base" : "Xenova/whisper-tiny";
  if (lang === "en-hq") return webgpu ? "onnx-community/whisper-base.en" : "Xenova/whisper-base.en";
  return webgpu ? "onnx-community/whisper-tiny.en" : "Xenova/whisper-tiny.en";
}

class Transcriber {
  static instance = null;
  static device = null;
  static modelId = null;

  static async get(lang, progress) {
    const device = this.device || (this.device = await pickDevice());
    const wanted = modelFor(device, lang || "en");
    if (this.instance && this.modelId === wanted) return this.instance;
    // Language/model changed (or first load) — (re)build the pipeline.
    this.modelId = wanted;
    self.postMessage({ status: "device", device });
    this.instance = await pipeline("automatic-speech-recognition", wanted, {
      device,
      progress_callback: progress,
    });
    return this.instance;
  }
}

const onProgress = (x) => {
  if (x.status === "progress") {
    self.postMessage({ status: "progress", file: x.file, progress: Math.round(x.progress || 0) });
  }
};

self.addEventListener("message", async (event) => {
  const { type, id, audio, lang } = event.data || {};
  try {
    if (type === "load") {
      await Transcriber.get(lang, onProgress);
      self.postMessage({ status: "ready" });
      return;
    }
    if (type === "transcribe") {
      const transcriber = await Transcriber.get(lang, onProgress);
      const output = await transcriber(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const text = (Array.isArray(output) ? output[0]?.text : output?.text) || "";
      self.postMessage({ status: "result", id, text: text.trim() });
      return;
    }
  } catch (err) {
    self.postMessage({
      status: "error",
      id,
      message: err && err.message ? err.message : String(err),
    });
  }
});
