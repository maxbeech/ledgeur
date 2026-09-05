// The shared speech pipeline (asrEngine) and the warmup that starts it.
//
// These cover the contract that "Loading the on-device model…" depended on, and
// that the original fix got wrong: the pipeline has to SURVIVE, for the life of
// the process and across any number of recordings. The first attempt handed the
// warmed controller over with a one-shot claim and then disposed it on stop, so
// only the first recording of a session ever benefited and every one after it
// rebuilt the ONNX session from scratch — which is exactly what the user still
// saw. What's asserted here is that a second (and third) caller gets the same
// live controller back, instantly, with no reload.
//
// Runs under plain Node (no window/DOM), so `isTauri()` is naturally false and
// modelWarmup takes the webview path this exercises. A fake global `Worker`
// stands in for the real transformers.js worker, the same technique
// packages/core/test/browser.mts uses for the controllers themselves.
//
// Each scenario imports fresh (a `?case=` query string busts Node's ESM module
// cache) because both modules hold process-wide singletons by design.

type Listener = (e: { data: any }) => void;

class FakeWorker {
  listeners: Record<string, Listener[]> = {};
  terminated = false;
  constructor(public behaviour: (w: FakeWorker, msg: any) => void) {}
  addEventListener(type: string, fn: Listener) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== fn);
  }
  postMessage(msg: any) {
    queueMicrotask(() => { if (!this.terminated) this.behaviour(this, msg); });
  }
  terminate() { this.terminated = true; }
  emit(data: any) { for (const l of this.listeners.message ?? []) l({ data }); }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Counts every worker ever spawned, so "did this reload?" is directly testable. */
function installWorker(behaviour: (w: FakeWorker, msg: any) => void): { spawned: () => number } {
  let spawned = 0;
  (globalThis as any).Worker = class extends FakeWorker {
    constructor() {
      spawned++;
      super(behaviour);
    }
  };
  return { spawned: () => spawned };
}

const readyWorker = (w: FakeWorker, msg: any) => {
  if (msg.type === "load") w.emit({ status: "ready", attempt: msg.attempt });
};
const failingWorker = (w: FakeWorker, msg: any) => {
  if (msg.type === "load") {
    w.emit({ status: "load-error", attempt: msg.attempt, hasNext: false, message: "boom", friendly: "boom" });
  }
};

export async function runModelWarmupTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  const prevWorker = (globalThis as any).Worker;

  // ---------- the engine hands the same live pipeline to every caller ----------
  {
    const worker = installWorker(readyWorker);
    const engine = await import(`../src/lib/asrEngine.ts?case=reuse`);

    const first = await engine.ensureTranscriber("en-hq");
    const afterFirst = worker.spawned();
    ok("the engine loads a pipeline", first != null);
    ok("loading reports ready", engine.getEngineStatus().phase === "ready", engine.getEngineStatus().phase);

    const second = await engine.ensureTranscriber("en-hq");
    const third = await engine.ensureTranscriber("en-hq");
    ok("a second recording gets the same controller", second === first);
    ok("a third recording gets the same controller", third === first);
    ok(
      "reusing the pipeline spawns no new worker",
      worker.spawned() === afterFirst,
      `spawned ${worker.spawned()}, expected ${afterFirst}`,
    );

    // Concurrent callers (warmup still running when Record is pressed) must
    // share one load rather than racing to build two competing ONNX sessions.
    const engine2 = await import(`../src/lib/asrEngine.ts?case=concurrent`);
    const before = worker.spawned();
    const [a, b] = await Promise.all([engine2.ensureTranscriber("en-hq"), engine2.ensureTranscriber("en-hq")]);
    ok("concurrent callers share one controller", a === b);
    ok(
      "concurrent callers share one worker",
      worker.spawned() === before + 1,
      `spawned ${worker.spawned() - before}, expected 1`,
    );

    engine.disposeEngine();
    engine2.disposeEngine();
  }

  // ---------- a different language genuinely needs a different model ----------
  {
    const worker = installWorker(readyWorker);
    const engine = await import(`../src/lib/asrEngine.ts?case=lang`);
    await engine.ensureTranscriber("en-hq");
    const afterFirst = worker.spawned();
    await engine.ensureTranscriber("multi");
    ok(
      "switching language reloads the pipeline",
      worker.spawned() > afterFirst,
      "expected a new worker for a different model",
    );
    ok("the engine tracks the loaded language", engine.getEngineStatus().lang === "multi", String(engine.getEngineStatus().lang));
    engine.disposeEngine();
  }

  // ---------- a failed load is not cached ----------
  {
    installWorker(failingWorker);
    const engine = await import(`../src/lib/asrEngine.ts?case=fail`);
    let threw = false;
    await engine.ensureTranscriber("en-hq").catch(() => { threw = true; });
    ok("a failing load rejects", threw);
    ok("a failing load reports failed", engine.getEngineStatus().phase === "failed", engine.getEngineStatus().phase);
    ok("the failure message is kept", engine.getEngineStatus().error === "boom", engine.getEngineStatus().error);

    // The cause is usually fixable (a dropped connection, a busy GPU), so the
    // next attempt has to actually retry rather than resolve the cached failure.
    const worker = installWorker(readyWorker);
    const recovered = await engine.ensureTranscriber("en-hq");
    ok("a retry after failure loads", recovered != null);
    ok("a retry spawns a fresh worker", worker.spawned() === 1, `spawned ${worker.spawned()}`);
    ok("a recovered engine reports ready", engine.getEngineStatus().phase === "ready");
    engine.disposeEngine();
  }

  // ---------- warmup drives the engine, and the sidebar reflects it ----------
  {
    installWorker(readyWorker);
    const mod = await import(`../src/lib/modelWarmup.ts?case=success`);
    mod.warmupModels();
    for (let i = 0; i < 40 && mod.getWarmupStatus().phase !== "ready"; i++) await flush();
    ok("a successful warmup reports ready", mod.getWarmupStatus().phase === "ready", mod.getWarmupStatus().phase);
    ok("a ready warmup reports 100%", mod.getWarmupStatus().progress === 100, String(mod.getWarmupStatus().progress));
    // useSyncExternalStore re-renders on any snapshot that isn't Object.is-equal
    // to the last, so an unchanged status must return the identical object or
    // the sidebar spins forever.
    ok("an unchanged status is identity-stable", mod.getWarmupStatus() === mod.getWarmupStatus());
  }

  {
    installWorker(failingWorker);
    // Both warmup cases import the *unqueried* asrEngine, so they share one
    // engine — which is the point of it, but it means the success case above
    // left a live pipeline behind that this one would otherwise reuse and
    // report as ready. Reset it so the failure path is genuinely exercised.
    const sharedEngine = await import(`../src/lib/asrEngine.ts`);
    sharedEngine.disposeEngine();
    const mod = await import(`../src/lib/modelWarmup.ts?case=failure`);
    mod.warmupModels();
    for (let i = 0; i < 40 && mod.getWarmupStatus().phase !== "failed"; i++) await flush();
    ok("a failed warmup reports failed", mod.getWarmupStatus().phase === "failed", mod.getWarmupStatus().phase);
  }

  (globalThis as any).Worker = prevWorker;
}
