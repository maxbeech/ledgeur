// The app's speech pipeline, owned once for the life of the process.
//
// ── Why a singleton ─────────────────────────────────────────────────────────
// Loading a Whisper pipeline in the webview is expensive in a way that caching
// does not fix. The model *bytes* land in Cache Storage on first use and are
// free after that, but every fresh `TranscriberController` still has to spawn a
// worker, import the transformers.js runtime, create an ONNX session and (on
// WebGPU) compile shaders. That is the part that takes ten to thirty seconds,
// and it was being paid again on every single recording:
//
//   - the background warmup kept a live controller, but handed it over with a
//     ONE-SHOT claim, so only the first recording of a session benefited;
//   - `useRecorder.stop()` then *disposed* that controller, terminating the
//     worker — so recording #2 onwards always rebuilt from scratch;
//   - and if the user hit Record before the warmup finished, the claim returned
//     null and a SECOND controller was built alongside the still-loading first
//     one, so two ONNX sessions competed for the same GPU and the orphan leaked.
//
// Hence: one transcriber and one diarizer, created lazily, kept alive, never
// disposed while the app is open. Warmup and the recorder are now two callers of
// the same thing rather than two owners of different things — the single source
// of truth this module exists to be.
//
// The controllers take their handlers at construction, so this module owns them
// and re-broadcasts to subscribers (the sidebar indicator, the live meeting
// header) instead of letting a caller's callbacks decide what everyone sees.

import { TranscriberController, DiarizerController } from "@ledgeur/core/browser";
import { createLogger } from "./logger.ts";

const log = createLogger("asr-engine");

export type EnginePhase = "idle" | "loading" | "ready" | "failed";

export interface EngineStatus {
  phase: EnginePhase;
  /** 0–100 across every file of the load in flight. */
  progress: number;
  /** Backend that actually started — "WebGPU", "CPU", … Empty until known. */
  device: string;
  /** Set only in the `failed` phase, already written for a person. */
  error: string;
  /** Language the live pipeline is loaded for, or null when there isn't one. */
  lang: string | null;
}

const IDLE: EngineStatus = { phase: "idle", progress: 0, device: "", error: "", lang: null };

let status: EngineStatus = IDLE;
const listeners = new Set<() => void>();

function setStatus(patch: Partial<EngineStatus>): void {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

/** For `useSyncExternalStore`. */
export function subscribeEngine(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getEngineStatus(): EngineStatus {
  return status;
}

let transcriber: TranscriberController | null = null;
/** The language the live pipeline is loaded (or loading) for. */
let loadedLang: string | null = null;
/** In-flight or settled load for `loadedLang`. Shared by every caller. */
let transcriberLoad: Promise<TranscriberController> | null = null;

let diarizer: DiarizerController | null = null;
let diarizerLoad: Promise<DiarizerController> | null = null;

/**
 * The shared transcriber, loaded for `lang`.
 *
 * Concurrent callers share one load. A caller asking for the language that is
 * already live resolves immediately — which is the whole point: the second and
 * every later recording of a session starts instantly, and so does the first
 * one whenever the background warmup got there first.
 *
 * Switching language genuinely needs a different model, so that reloads — but
 * on the same controller, via WorkerLadder's own keyed teardown, rather than by
 * leaking the old one and building a new one beside it.
 */
export function ensureTranscriber(lang: string): Promise<TranscriberController> {
  if (transcriberLoad && loadedLang === lang) return transcriberLoad;

  loadedLang = lang;
  if (!transcriber) {
    transcriber = new TranscriberController({
      onDevice: (device, info) => setStatus({ device: info?.label ?? device }),
      onProgress: (_file, progress) => setStatus({ phase: "loading", progress }),
    });
  }
  const controller = transcriber;
  setStatus({ phase: "loading", progress: 0, error: "", lang });

  const load = controller.preloadAndWait(lang)
    .then(() => {
      setStatus({ phase: "ready", progress: 100, error: "" });
      log.info("speech pipeline ready", { lang, device: status.device });
      return controller;
    })
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ phase: "failed", error: message });
      log.warn("speech pipeline failed to load", e);
      // Never cache a failure: the cause is usually fixable (a dropped
      // connection, a busy GPU) and the next attempt should start clean.
      if (transcriberLoad === load) { transcriberLoad = null; loadedLang = null; }
      throw e;
    });

  transcriberLoad = load;
  return load;
}

/**
 * The shared speaker models.
 *
 * Deliberately separate from the transcriber's readiness: speakers are only
 * needed when a meeting *ends*, so nothing waits on this to start recording.
 */
export function ensureDiarizer(): Promise<DiarizerController> {
  if (diarizerLoad) return diarizerLoad;
  if (!diarizer) diarizer = new DiarizerController();
  const controller = diarizer;

  const load = controller.preload()
    .then(() => controller)
    .catch((e: unknown) => {
      log.warn("speaker models failed to load", e);
      if (diarizerLoad === load) diarizerLoad = null;
      throw e;
    });

  diarizerLoad = load;
  return load;
}

/** The live transcriber if one is already loaded, without starting a load. */
export function liveTranscriber(): TranscriberController | null {
  return status.phase === "ready" ? transcriber : null;
}

/**
 * Tear the whole engine down. Only for app teardown and tests — the recorder
 * must never call this: the next recording would pay the full load again, which
 * is exactly the cost this module exists to remove.
 */
export function disposeEngine(): void {
  transcriber?.dispose();
  diarizer?.dispose();
  transcriber = null;
  diarizer = null;
  transcriberLoad = null;
  diarizerLoad = null;
  loadedLang = null;
  status = IDLE;
  listeners.forEach((l) => l());
}
