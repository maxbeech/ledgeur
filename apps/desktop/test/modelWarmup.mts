// modelWarmup's claim semantics — the fix for "Loading the on-device model"
// sitting at 100% despite the sidebar saying the model was already warm (see
// useRecorder.ts: it used to always build a fresh TranscriberController and
// redo session creation from scratch instead of reusing the one warmup
// already brought up).
//
// Runs under plain Node (no window/DOM), so `isTauri()` is naturally false
// and modelWarmup takes the webview path this exercises. A fake global
// `Worker` stands in for the real transformers.js worker, the same technique
// packages/core/test/browser.mts uses for the controllers themselves.
//
// Each scenario imports modelWarmup fresh (a `?case=` query string busts
// Node's ESM module cache) because `warmupModels()` is a module-level
// singleton — a second call in the same instance is a no-op by design.

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

async function freshModelWarmup(caseName: string) {
  return import(`../src/lib/modelWarmup.ts?case=${caseName}`);
}

export async function runModelWarmupTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  const prevWorker = (globalThis as any).Worker;

  // ---------- both models load successfully ----------
  {
    (globalThis as any).Worker = class extends FakeWorker {
      constructor() {
        super((w, msg) => {
          if (msg.type === "load") w.emit({ status: "ready", attempt: msg.attempt });
        });
      }
    };
    const mod = await freshModelWarmup("success");
    mod.warmupModels();
    for (let i = 0; i < 20 && mod.getWarmupStatus().phase !== "ready"; i++) await flush();

    ok("a successful warmup reports ready", mod.getWarmupStatus().phase === "ready", mod.getWarmupStatus().phase);
    const tr = mod.claimWarmTranscriber();
    ok("the warmed transcriber is claimable", tr != null);
    ok("claiming again returns null", mod.claimWarmTranscriber() === null);
    const dz = mod.claimWarmDiarizer();
    ok("the warmed diarizer is claimable", dz != null);
    ok("claiming the diarizer again returns null", mod.claimWarmDiarizer() === null);
    tr?.dispose();
    dz?.dispose();
  }

  // ---------- both models fail to load ----------
  {
    (globalThis as any).Worker = class extends FakeWorker {
      constructor() {
        super((w, msg) => {
          if (msg.type === "load") {
            w.emit({ status: "load-error", attempt: msg.attempt, hasNext: false, message: "boom", friendly: "boom" });
          }
        });
      }
    };
    const mod = await freshModelWarmup("failure");
    mod.warmupModels();
    for (let i = 0; i < 20 && mod.getWarmupStatus().phase !== "failed"; i++) await flush();

    ok("a failed warmup reports failed", mod.getWarmupStatus().phase === "failed", mod.getWarmupStatus().phase);
    ok("nothing is claimable after a failed warmup (transcriber)", mod.claimWarmTranscriber() === null);
    ok("nothing is claimable after a failed warmup (diarizer)", mod.claimWarmDiarizer() === null);
  }

  (globalThis as any).Worker = prevWorker;
}
