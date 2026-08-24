// Starting a model worker, and retrying in a *fresh* one when a rung fails.
//
// Both the transcription worker and the diarization worker load models through
// onnxruntime-web, and both inherit the same hard constraint: a failed session
// creation poisons the runtime for the whole worker. Retrying a different model
// in the same worker fails with the same stale error, so a fallback has to be
// attempted in a new worker with the old one terminated.
//
// That logic used to be copy-pasted into each app's transcriber controller —
// and the two copies had already drifted. It lives here once.

export interface WorkerDeviceInfo {
  device: string;
  label: string;
  model?: string;
  runtime: string;
}

export interface LadderHandlers {
  /** Which backend actually started — the label changes if a rung was skipped. */
  onDevice?: (device: string, info: WorkerDeviceInfo) => void;
  /** Model download progress, 0–100, per file. */
  onProgress?: (file: string, progress: number) => void;
  /** A pipeline is live. */
  onReady?: () => void;
}

export interface LadderOptions {
  /** Worker script URL, served from the app's public/ directory. */
  scriptUrl: string;
  /** Extra fields sent with the `load` message (e.g. `{ lang }`). */
  loadPayload?: Record<string, unknown>;
  /** Human name used in the "could not start" message. */
  subject: string;
  handlers?: LadderHandlers;
  /** Injectable for tests; defaults to the global Worker. */
  spawn?: (url: string) => Worker;
}

/**
 * Owns one worker at a time and the walk down the load plan.
 *
 * `key` distinguishes configurations that need a clean start — the ASR
 * controller passes the language, because switching from English to
 * multilingual means a different model.
 */
export class WorkerLadder {
  protected worker: Worker | null = null;
  protected attempt = 0;
  private loading: { key: string; promise: Promise<void> } | null = null;
  private abortLoad: ((e: Error) => void) | null = null;
  private disposed = false;
  private readonly options: LadderOptions;
  /** Listeners the subclass wants on every worker this ladder spawns. */
  private readonly listeners: ((event: MessageEvent) => void)[] = [];

  constructor(options: LadderOptions) {
    this.options = options;
  }

  /** Route every worker message through `handler`, for this and future workers. */
  protected listen(handler: (event: MessageEvent) => void): void {
    this.listeners.push(handler);
    this.worker?.addEventListener("message", handler as EventListener);
  }

  private spawnWorker(): Worker {
    const worker = this.options.spawn
      ? this.options.spawn(this.options.scriptUrl)
      : new Worker(this.options.scriptUrl, { type: "module" });

    worker.addEventListener("message", (e: MessageEvent) => {
      const d = e.data || {};
      if (d.status === "device") {
        this.options.handlers?.onDevice?.(d.device, {
          device: d.device, label: d.label, model: d.model, runtime: d.runtime,
        });
      } else if (d.status === "progress") {
        this.options.handlers?.onProgress?.(d.file, d.progress);
      }
    });
    for (const l of this.listeners) worker.addEventListener("message", l as EventListener);
    return worker;
  }

  /**
   * Start a worker, walking the plan until a rung reports `ready`. Resolves
   * once a pipeline is live; rejects with a message a person can act on when
   * every rung has failed. Concurrent calls for the same key share one load.
   */
  protected ensureLoaded(key: string, payload: Record<string, unknown> = {}): Promise<void> {
    if (this.loading && this.loading.key === key) return this.loading.promise;
    this.teardown();

    const promise = new Promise<void>((resolve, reject) => {
      this.abortLoad = reject;
      const tryAttempt = (attempt: number) => {
        if (this.disposed) return reject(new Error(`${this.options.subject} was disposed.`));
        const worker = this.spawnWorker();
        this.worker = worker;

        const onMessage = (e: MessageEvent) => {
          const d = e.data || {};
          if (d.status === "ready") {
            worker.removeEventListener("message", onMessage as EventListener);
            this.attempt = attempt;
            this.abortLoad = null;
            this.options.handlers?.onReady?.();
            resolve();
          } else if (d.status === "load-error") {
            worker.removeEventListener("message", onMessage as EventListener);
            worker.terminate();
            if (this.worker === worker) this.worker = null;
            if (d.hasNext) tryAttempt(attempt + 1);
            else reject(new Error(d.friendly || d.message));
          }
        };
        worker.addEventListener("message", onMessage as EventListener);
        worker.addEventListener("error", (ev) => {
          // The worker script itself failed to load or parse — no rung helps.
          worker.removeEventListener("message", onMessage as EventListener);
          reject(new Error(
            `Could not start ${this.options.subject}. (${(ev as ErrorEvent).message || "unknown error"})`,
          ));
        }, { once: true });

        worker.postMessage({ type: "load", attempt, ...this.options.loadPayload, ...payload });
      };
      tryAttempt(0);
    });

    // A failed load is never cached: the user may fix the cause (reconnect,
    // close tabs) and retry, and that retry should start from the best rung.
    promise.catch(() => { if (this.loading?.promise === promise) this.loading = null; });
    this.loading = { key, promise };
    return promise;
  }

  /** The live worker, or null before a successful load. */
  protected get live(): Worker | null {
    return this.worker;
  }

  protected teardown(): void {
    // Settle the in-flight load first: its worker is about to be terminated, so
    // its listeners would never fire and anything awaiting it would hang.
    this.abortLoad?.(new Error(`${this.options.subject} was cancelled.`));
    this.abortLoad = null;
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    this.onTeardown();
  }

  /** Hook for subclasses to reject their in-flight requests. */
  protected onTeardown(): void {}

  dispose(): void {
    this.disposed = true;
    this.teardown();
  }
}
