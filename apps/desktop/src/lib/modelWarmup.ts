// Warms the on-device model caches as soon as the app opens, so "Start
// recording" doesn't have to wait for a multi-hundred-MB download the first
// time someone uses it.
//
// Native engine (whisper.cpp/sherpa-onnx, compiled with --features native-ai):
// kicks off the same download the "Download models" button in Settings does.
// Webview engine (transformers.js, what the shipped build actually runs):
// loads the model into a worker so its weights land in the browser's
// persistent Cache Storage AND a live ONNX/WebGPU session is left running —
// the model *bytes* being cached does not make session creation and shader
// compilation instant, and that (not the download) is what actually takes
// time. useRecorder.start() claims this warm worker via
// claimWarmTranscriber()/claimWarmDiarizer() instead of building a fresh one,
// so the first recording of a session skips that reload entirely. Only claims
// this once — a second recording in the same session loads normally, same as
// before this existed.
//
// The status below exists so this background work is actually visible
// somewhere (the sidebar) instead of only surfacing the first time someone
// hits "Start recording" — which used to be the only place a download's
// progress was ever shown, making the background warmup look like it hadn't
// started at all.

import { TranscriberController, DiarizerController } from "@ledgeur/core/browser";
import { aiStatus, downloadModels } from "./nativeAI.ts";
import { isTauri } from "./runtime.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("model-warmup");
let started = false;

export interface WarmupStatus {
  /** Nothing to show: not started, already cached, or finished. */
  phase: "idle" | "downloading" | "ready" | "failed";
  /** 0–100 aggregate across every file being fetched, or null when no byte
   *  count is available at all (the native engine's download reports none). */
  progress: number | null;
  /** Short label for what's currently loading, e.g. "Speech model". */
  label: string;
}

const IDLE: WarmupStatus = { phase: "idle", progress: null, label: "" };
let status: WarmupStatus = IDLE;
const listeners = new Set<() => void>();

function setStatus(next: WarmupStatus): void {
  status = next;
  listeners.forEach((l) => l());
}

/** For `useSyncExternalStore` — the sidebar's download indicator. */
export function subscribeWarmup(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWarmupStatus(): WarmupStatus {
  return status;
}

let warmTranscriber: TranscriberController | null = null;
let warmDiarizer: DiarizerController | null = null;

/** One-shot claim: returns the warmed transcriber and clears it, so a second
 *  caller (a second recording this session) gets null and loads normally. */
export function claimWarmTranscriber(): TranscriberController | null {
  const t = warmTranscriber;
  warmTranscriber = null;
  return t;
}

/** One-shot claim — see claimWarmTranscriber(). */
export function claimWarmDiarizer(): DiarizerController | null {
  const d = warmDiarizer;
  warmDiarizer = null;
  return d;
}

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
          // The Rust download is one blocking call with no per-byte progress
          // to report, so this is honest about showing a spinner rather than
          // fabricating a percentage.
          setStatus({ phase: "downloading", progress: null, label: "On-device models" });
          await downloadModels()
            .then(() => setStatus({ phase: "ready", progress: 100, label: "" }))
            .catch((e: unknown) => { log.warn("native model warmup failed", e); setStatus({ phase: "failed", progress: null, label: "" }); });
        }
        return; // native engine handles transcription; the webview model isn't needed
      }
    }

    setStatus({ phase: "downloading", progress: 0, label: "Speech model" });
    const tr = new TranscriberController({
      onProgress: (_f, p) => setStatus({ phase: "downloading", progress: p, label: "Speech model" }),
    });
    const dz = new DiarizerController({
      onProgress: (_f, p) => setStatus({ phase: "downloading", progress: p, label: "Speaker models" }),
    });
    // Kept alive (not disposed) on success so useRecorder.start() can claim a
    // pipeline that is already live — see the header comment. Only disposed
    // here if its own load failed, since a dead worker has nothing to claim.
    const results = await Promise.allSettled([
      tr.preloadAndWait("en-hq").catch((e: unknown) => { log.warn("transcriber warmup failed", e); tr.dispose(); throw e; }),
      dz.preload().catch((e: unknown) => { log.warn("diarizer warmup failed", e); dz.dispose(); throw e; }),
    ]);
    if (results[0].status === "fulfilled") warmTranscriber = tr;
    if (results[1].status === "fulfilled") warmDiarizer = dz;
    setStatus(results.some((r) => r.status === "fulfilled")
      ? { phase: "ready", progress: 100, label: "" }
      : { phase: "failed", progress: null, label: "" });
    log.info("model warmup complete");
  } catch (e) {
    log.warn("model warmup failed", e);
    setStatus({ phase: "failed", progress: null, label: "" });
  }
}
