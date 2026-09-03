// Warms the on-device model caches as soon as the app opens, so "Start
// recording" doesn't have to wait for a multi-hundred-MB download the first
// time someone uses it.
//
// Native engine (whisper.cpp/sherpa-onnx, compiled with --features native-ai):
// kicks off the same download the "Download models" button in Settings does.
// Webview engine (transformers.js, what the shipped build actually runs):
// loads the model into a throwaway worker so its weights land in the
// browser's persistent Cache Storage, then discards the worker — the real
// worker created at record time reads from that cache instead of the network.

import { TranscriberController, DiarizerController } from "@ledgeur/core/browser";
import { aiStatus, downloadModels } from "./nativeAI.ts";
import { isTauri } from "./runtime.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("model-warmup");
let started = false;

/** Idempotent within a session — call freely from anywhere the app mounts. */
export function warmupModels(): void {
  if (started) return;
  started = true;
  void run();
}

async function run(): Promise<void> {
  try {
    if (isTauri()) {
      const status = await aiStatus();
      if (status?.compiled) {
        if (!status.models_ready) {
          log.info("warming native AI models in the background");
          await downloadModels().catch((e: unknown) => log.warn("native model warmup failed", e));
        }
        return; // native engine handles transcription; the webview model isn't needed
      }
    }

    const tr = new TranscriberController();
    const dz = new DiarizerController();
    await Promise.allSettled([
      tr.preloadAndWait("en").catch((e: unknown) => log.warn("transcriber warmup failed", e)),
      dz.preload().catch((e: unknown) => log.warn("diarizer warmup failed", e)),
    ]);
    tr.dispose();
    dz.dispose();
    log.info("model warmup complete");
  } catch (e) {
    log.warn("model warmup failed", e);
  }
}
