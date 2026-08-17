// Main-thread controller around the Whisper Web Worker. Serialises requests so
// only one transcription runs at a time (the worker shares one pipeline). Lives
// outside React so the component stays small.
//
// It also walks the load plan in /asr-plan.js: if a model fails to start (some
// browser/runtime combinations cannot create an onnxruntime session), the
// worker is destroyed and the next rung is tried in a FRESH worker — a failed
// session poisons the runtime, so retrying in place always fails the same way.

type DeviceInfo = { device: string; label: string; model: string; runtime: string };

type Handlers = {
  onDevice?: (device: string, info?: DeviceInfo) => void;
  onProgress?: (file: string, progress: number) => void;
  onReady?: () => void;
};

let counter = 0;

export class TranscriberController {
  private worker: Worker | null = null;
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  private handlers: Handlers;
  /** In-flight (or settled) load for the current language. */
  private loading: { lang: string; promise: Promise<void> } | null = null;
  /** Abandons the in-flight load, so tearing down never leaves an awaiter hanging. */
  private abortLoad: ((e: Error) => void) | null = null;
  /** Which rung of the load plan the live worker started on. */
  private attempt = 0;
  private disposed = false;

  constructor(handlers: Handlers = {}) {
    this.handlers = handlers;
  }

  private spawn(): Worker {
    const worker = new Worker("/transcribe.worker.js", { type: "module" });
    worker.addEventListener("message", (e: MessageEvent) => {
      const d = e.data || {};
      switch (d.status) {
        case "device":
          this.handlers.onDevice?.(d.device, { device: d.device, label: d.label, model: d.model, runtime: d.runtime });
          break;
        case "progress":
          this.handlers.onProgress?.(d.file, d.progress);
          break;
        case "result": {
          const p = this.pending.get(d.id);
          if (p) { this.pending.delete(d.id); p.resolve(d.text || ""); }
          break;
        }
        case "error": {
          const p = d.id != null ? this.pending.get(d.id) : undefined;
          if (p) { this.pending.delete(d.id); p.reject(new Error(d.message)); }
          break;
        }
      }
    });
    return worker;
  }

  /**
   * Load the model, walking the plan until one rung starts. Resolves once a
   * pipeline is live; rejects with a human-readable message when every rung
   * failed. Repeated calls for the same language share one load.
   */
  private ensureLoaded(lang: string): Promise<void> {
    if (this.loading && this.loading.lang === lang) return this.loading.promise;
    // Switching language: start over from the best rung with a clean worker.
    this.teardown();

    const promise = new Promise<void>((resolve, reject) => {
      this.abortLoad = reject;
      const tryAttempt = (attempt: number) => {
        if (this.disposed) return reject(new Error("Transcriber disposed."));
        const worker = this.spawn();
        this.worker = worker;
        const onMessage = (e: MessageEvent) => {
          const d = e.data || {};
          if (d.status === "ready") {
            worker.removeEventListener("message", onMessage);
            this.attempt = attempt;
            this.abortLoad = null;
            this.handlers.onReady?.();
            resolve();
          } else if (d.status === "load-error") {
            worker.removeEventListener("message", onMessage);
            worker.terminate();
            if (this.worker === worker) this.worker = null;
            if (d.hasNext) tryAttempt(attempt + 1);
            else reject(new Error(d.friendly || d.message));
          }
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", (ev) => {
          // The worker script itself failed to load/parse — no rung can help.
          worker.removeEventListener("message", onMessage);
          reject(new Error(`Could not start the transcription worker. (${(ev as ErrorEvent).message || "unknown error"})`));
        }, { once: true });
        worker.postMessage({ type: "load", lang, attempt });
      };
      tryAttempt(0);
    });

    // A failed load must not be cached — the user can retry (e.g. after
    // reconnecting) and we should walk the plan again from the top.
    promise.catch(() => { if (this.loading?.promise === promise) this.loading = null; });
    this.loading = { lang, promise };
    return promise;
  }

  /** Begin downloading + warming the model. lang: "en" | "en-hq" | "multi". */
  preload(lang: string = "en"): Promise<void> {
    return this.ensureLoaded(lang);
  }

  /** Transcribe a 16 kHz mono Float32 buffer; resolves with the text. */
  async transcribe(audio: Float32Array, lang: string = "en"): Promise<string> {
    // Wait for a live pipeline before handing over the audio: posting into a
    // worker that is about to be discarded would lose the buffer (it is
    // transferred, not copied).
    await this.ensureLoaded(lang);
    const worker = this.worker;
    if (!worker) throw new Error("Transcriber is not running.");
    const id = ++counter;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Transfer the buffer to avoid a copy.
      worker.postMessage({ type: "transcribe", id, audio, lang, attempt: this.attempt }, [audio.buffer]);
    });
  }

  private teardown() {
    // Settle the in-flight load first: its worker is about to be terminated, so
    // its listeners would never fire and anything awaiting it would hang.
    this.abortLoad?.(new Error("Transcription cancelled."));
    this.abortLoad = null;
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    this.pending.forEach((p) => p.reject(new Error("Transcription cancelled.")));
    this.pending.clear();
  }

  dispose() {
    this.disposed = true;
    this.teardown();
  }
}
