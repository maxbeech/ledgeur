// Starts the on-device models loading as soon as the app opens, so "Start
// recording" never has to wait for them.
//
// This module is only the *trigger* and the *status surface*. The pipeline
// itself is owned by asrEngine.ts, for the whole life of the process — see the
// long comment there for why that ownership had to move out of here. Warmup and
// the recorder are now two callers of one engine, so warming up genuinely means
// every recording starts instantly, not just the first one.
//
// The status exists so this background work is visible somewhere (the sidebar)
// rather than only surfacing the first time somebody hits "Start recording".

import { getSettings } from "./settings.ts";
import { ensureTranscriber, ensureDiarizer, subscribeEngine, getEngineStatus } from "./asrEngine.ts";
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
/** Set only by the native path, which reports no per-byte progress. */
let nativeStatus: WarmupStatus | null = null;
const listeners = new Set<() => void>();

function setNativeStatus(next: WarmupStatus | null): void {
  nativeStatus = next;
  listeners.forEach((l) => l());
}

/** For `useSyncExternalStore` — the sidebar's download indicator. */
export function subscribeWarmup(listener: () => void): () => void {
  listeners.add(listener);
  const unsubscribeEngine = subscribeEngine(listener);
  return () => { listeners.delete(listener); unsubscribeEngine(); };
}

/**
 * Warmup status, derived from the engine rather than tracked alongside it.
 *
 * Cached and identity-stable while nothing changes: `useSyncExternalStore`
 * re-renders on every snapshot that isn't `Object.is`-equal to the last, so
 * building a fresh object here would spin the sidebar forever.
 */
let snapshot: WarmupStatus = IDLE;
export function getWarmupStatus(): WarmupStatus {
  const next = computeWarmupStatus();
  if (next.phase !== snapshot.phase || next.progress !== snapshot.progress || next.label !== snapshot.label) {
    snapshot = next;
  }
  return snapshot;
}

function computeWarmupStatus(): WarmupStatus {
  if (nativeStatus) return nativeStatus;
  const engine = getEngineStatus();
  switch (engine.phase) {
    case "loading": return { phase: "downloading", progress: engine.progress, label: "Speech model" };
    case "ready": return { phase: "ready", progress: 100, label: "" };
    case "failed": return { phase: "failed", progress: null, label: "" };
    default: return IDLE;
  }
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
          // The Rust download is one blocking call with no per-byte progress to
          // report, so this is honest about showing a spinner rather than
          // fabricating a percentage.
          setNativeStatus({ phase: "downloading", progress: null, label: "On-device models" });
          await downloadModels()
            .then(() => setNativeStatus({ phase: "ready", progress: 100, label: "" }))
            .catch((e: unknown) => {
              log.warn("native model warmup failed", e);
              setNativeStatus({ phase: "failed", progress: null, label: "" });
            });
        }
        return; // the native engine transcribes; the webview model isn't needed
      }
    }

    // Both are started together and neither is awaited by the other: the
    // transcriber is what a recording needs first, and a slow speaker-model
    // download must not delay it.
    await Promise.allSettled([
      // The user's own choice, not a constant: warming a model the next
      // recording won't ask for is the same as not warming anything.
      ensureTranscriber(getSettings().transcriptionLang),
      ensureDiarizer().catch((e: unknown) => log.warn("speaker model warmup failed", e)),
    ]);
    log.info("model warmup complete");
  } catch (e) {
    log.warn("model warmup failed", e);
  }
}
