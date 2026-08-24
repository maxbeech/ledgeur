// Controller tests — the retry ladder and the diarization pipeline, driven by a
// fake Worker so they run in Node with no browser and no model download.
//
// The ladder is worth testing precisely because it caused a production outage:
// every non-WebGPU user hit a session error, and a retry *in the same worker*
// fails identically because onnxruntime is poisoned. These assert that a
// fallback really does get a fresh worker.

import { TranscriberController } from "../src/browser/transcriber.ts";
import { DiarizerController } from "../src/browser/diarizer.ts";
import type { AsrChunk } from "../src/diarize/types.ts";

type Listener = (e: { data: any }) => void;

/** A Worker stand-in. `script` decides how it answers each message. */
class FakeWorker {
  static spawned: FakeWorker[] = [];
  listeners: Record<string, Listener[]> = {};
  terminated = false;
  posted: any[] = [];
  constructor(public behaviour: (w: FakeWorker, msg: any) => void) {
    FakeWorker.spawned.push(this);
  }
  addEventListener(type: string, fn: Listener) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== fn);
  }
  postMessage(msg: any, _transfer?: unknown[]) {
    this.posted.push(msg);
    // Asynchronous, like a real worker — a synchronous reply would hide
    // ordering bugs the real thing would expose.
    queueMicrotask(() => { if (!this.terminated) this.behaviour(this, msg); });
  }
  terminate() { this.terminated = true; }
  emit(data: any) { for (const l of this.listeners.message ?? []) l({ data }); }
  emitError(message: string) {
    for (const l of this.listeners.error ?? []) l({ data: null, message } as any);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

export async function runBrowserTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- the load ladder ----------
  {
    FakeWorker.spawned = [];
    // Rung 0 fails with hasNext, rung 1 succeeds.
    const controller = new TranscriberController({}, {
      spawn: () => new FakeWorker((w, msg) => {
        if (msg.type !== "load") return;
        if (msg.attempt === 0) w.emit({ status: "load-error", attempt: 0, hasNext: true, message: "poisoned", friendly: "retrying" });
        else w.emit({ status: "ready", attempt: msg.attempt });
      }) as unknown as Worker,
    });
    await controller.preload("en");
    ok("a failed rung is retried", FakeWorker.spawned.length === 2, `${FakeWorker.spawned.length} workers`);
    ok("the failed rung's worker is terminated, not reused", FakeWorker.spawned[0].terminated === true);
    ok("the retry runs in a fresh worker", FakeWorker.spawned[1].terminated === false);
    ok("the retry asks for the next rung", FakeWorker.spawned[1].posted[0].attempt === 1, JSON.stringify(FakeWorker.spawned[1].posted[0]));
    controller.dispose();
  }

  {
    FakeWorker.spawned = [];
    const controller = new TranscriberController({}, {
      spawn: () => new FakeWorker((w, msg) => {
        if (msg.type === "load") w.emit({ status: "load-error", attempt: msg.attempt, hasNext: false, message: "raw", friendly: "Please update your browser." });
      }) as unknown as Worker,
    });
    let rejected = "";
    await controller.preload("en").catch((e: Error) => { rejected = e.message; });
    ok("an exhausted ladder rejects with the friendly message", rejected === "Please update your browser.", rejected);
    controller.dispose();
  }

  {
    FakeWorker.spawned = [];
    const controller = new TranscriberController({}, {
      spawn: () => new FakeWorker(() => {}) as unknown as Worker,
    });
    const promise = controller.preload("en").catch((e: Error) => e.message);
    await flush();
    FakeWorker.spawned[0].emitError("SyntaxError");
    const msg = await promise;
    ok("a worker that will not even start is reported", /Could not start/.test(String(msg)), String(msg));
    controller.dispose();
  }

  {
    // A load that never settles must not leave callers hanging when disposed.
    FakeWorker.spawned = [];
    const controller = new TranscriberController({}, {
      spawn: () => new FakeWorker(() => {}) as unknown as Worker,
    });
    const promise = controller.preload("en").then(() => "resolved").catch((e: Error) => e.message);
    await flush();
    controller.dispose();
    ok("disposing settles an in-flight load", /cancelled/i.test(String(await promise)), String(await promise));
  }

  {
    // Reporting device + progress is how the UI stops looking frozen during a
    // 40 MB download.
    FakeWorker.spawned = [];
    let device = "", label = "", progress = -1, ready = false;
    const controller = new TranscriberController({
      onDevice: (d, info) => { device = d; label = info.label; },
      onProgress: (_f, p) => { progress = p; },
      onReady: () => { ready = true; },
    }, {
      spawn: () => new FakeWorker((w, msg) => {
        if (msg.type !== "load") return;
        w.emit({ status: "device", device: "wasm", label: "CPU", runtime: "3.8.1" });
        w.emit({ status: "progress", file: "model.onnx", progress: 42 });
        w.emit({ status: "ready", attempt: 0 });
      }) as unknown as Worker,
    });
    await controller.preload("en");
    ok("the device that started is reported", device === "wasm" && label === "CPU", `${device}/${label}`);
    ok("download progress is reported", progress === 42, `${progress}`);
    ok("readiness is reported", ready);
    controller.dispose();
  }

  // ---------- transcription results ----------
  {
    FakeWorker.spawned = [];
    const controller = new TranscriberController({}, {
      spawn: () => new FakeWorker((w, msg) => {
        if (msg.type === "load") return w.emit({ status: "ready", attempt: 0 });
        if (msg.type === "transcribe") {
          w.emit({
            status: "result", id: msg.id, text: "hello world",
            chunks: [{ text: "hello world", start: 0, end: 1.5 }],
          });
        }
      }) as unknown as Worker,
    });
    const result = await controller.transcribe(new Float32Array(16000), "en");
    ok("transcription returns the text", result.text === "hello world");
    ok("transcription returns timed chunks", result.chunks.length === 1 && result.chunks[0].end === 1.5);
    ok("the clip offset is passed to the worker", FakeWorker.spawned[0].posted.at(-1).offsetSeconds === 0);

    await controller.transcribe(new Float32Array(16000), "en", 20);
    ok("a live slice carries its offset", FakeWorker.spawned[0].posted.at(-1).offsetSeconds === 20);

    ok("transcribeText returns just the words", (await controller.transcribeText(new Float32Array(16000))) === "hello world");
    controller.dispose();
  }

  {
    FakeWorker.spawned = [];
    const controller = new TranscriberController({}, {
      spawn: () => new FakeWorker((w, msg) => {
        if (msg.type === "load") return w.emit({ status: "ready", attempt: 0 });
        if (msg.type === "transcribe") w.emit({ status: "error", id: msg.id, message: "model exploded" });
      }) as unknown as Worker,
    });
    let err = "";
    await controller.transcribe(new Float32Array(16000)).catch((e: Error) => { err = e.message; });
    ok("a transcription error reaches the caller", err === "model exploded", err);
    controller.dispose();
  }

  {
    // An in-flight transcription must not hang forever when the app navigates.
    FakeWorker.spawned = [];
    const controller = new TranscriberController({}, {
      spawn: () => new FakeWorker((w, msg) => {
        if (msg.type === "load") w.emit({ status: "ready", attempt: 0 });
      }) as unknown as Worker,
    });
    const promise = controller.transcribe(new Float32Array(16000)).catch((e: Error) => e.message);
    await flush();
    controller.dispose();
    ok("disposing settles an in-flight transcription", /cancelled/i.test(String(await promise)), String(await promise));
  }

  // ---------- diarization ----------
  const chunks: AsrChunk[] = [
    { text: "Good morning everyone", start: 0, end: 3 },
    { text: "Morning, shall we start", start: 6, end: 9 },
  ];

  {
    FakeWorker.spawned = [];
    // Two clearly different voices, one turn each.
    const controller = new DiarizerController({}, {
      spawn: () => new FakeWorker((w, msg) => {
        if (msg.type === "load") return w.emit({ status: "ready", attempt: 0 });
        if (msg.type === "diarize") {
          w.emit({ status: "stage", id: msg.id, stage: "segmenting", done: 1, total: 1 });
          w.emit({
            status: "result", id: msg.id,
            turns: [
              { start: 0, end: 3, speaker: 0, confidence: 0.9 },
              { start: 6, end: 9, speaker: 1, confidence: 0.9 },
            ],
            embeddings: [[1, 0, 0], [0, 1, 0]],
            embeddedIndices: [0, 1],
            durationSeconds: 9,
          });
        }
      }) as unknown as Worker,
    });

    const stages: string[] = [];
    const result = await controller.diarize(new Float32Array(16000 * 9), chunks, {
      onProgress: (p) => stages.push(`${p.stage} ${p.done}/${p.total}`),
    });
    ok("diarization finds two speakers", result.speakers.length === 2, JSON.stringify(result.speakers.map((s) => s.label)));
    ok("speakers are labelled Speaker 1 and 2 when unknown",
      result.speakers.map((s) => s.label).join() === "Speaker 1,Speaker 2",
      JSON.stringify(result.speakers.map((s) => s.label)));
    ok("each line of the transcript gets a speaker",
      result.segments.length === 2 && result.segments[0].speaker === 0 && result.segments[1].speaker === 1,
      JSON.stringify(result.segments));
    ok("speaking time is measured", result.speakers[0].speakingSeconds === 3);
    ok("a successful run carries no warning", result.warning === null);
    ok("progress is reported to the caller", stages.includes("segmenting 1/1"), JSON.stringify(stages));
    controller.dispose();
  }

  {
    // The headline feature: a voice named last week is named again this week.
    FakeWorker.spawned = [];
    const controller = new DiarizerController({}, {
      spawn: () => new FakeWorker((w, msg) => {
        if (msg.type === "load") return w.emit({ status: "ready", attempt: 0 });
        if (msg.type === "diarize") {
          w.emit({
            status: "result", id: msg.id,
            turns: [
              { start: 0, end: 3, speaker: 0, confidence: 0.9 },
              { start: 6, end: 9, speaker: 1, confidence: 0.9 },
            ],
            embeddings: [[1, 0, 0], [0, 1, 0]],
            embeddedIndices: [0, 1],
            durationSeconds: 9,
          });
        }
      }) as unknown as Worker,
    });
    const result = await controller.diarize(new Float32Array(16000 * 9), chunks, {
      profiles: [{
        id: "vp_priya", name: "Priya", embedding: [1, 0, 0], samples: 2,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    ok("a remembered voice is named automatically", result.speakers[0].label === "Priya",
      JSON.stringify(result.speakers.map((s) => s.label)));
    ok("the unknown voice stays a numbered speaker", result.speakers[1].label === "Speaker 2");
    ok("the recognised speaker carries a confidence", (result.speakers[0].confidence ?? 0) > 0.9);
    controller.dispose();
  }

  {
    // Diarization must degrade, never fail: the transcript is the valuable part.
    FakeWorker.spawned = [];
    const controller = new DiarizerController({}, {
      spawn: () => new FakeWorker((w, msg) => {
        if (msg.type === "load") w.emit({ status: "load-error", attempt: msg.attempt, hasNext: false, message: "no models", friendly: "Couldn't download the speaker models." });
      }) as unknown as Worker,
    });
    const result = await controller.diarize(new Float32Array(16000), chunks);
    ok("a diarization failure still returns the transcript", result.segments.length === 2, JSON.stringify(result.segments));
    ok("the failed transcript has no speakers rather than wrong ones",
      result.segments.every((s) => s.speaker === null));
    ok("the failure is reported as a warning, not thrown", /speaker models/i.test(result.warning ?? ""), String(result.warning));
    controller.dispose();
  }

  {
    FakeWorker.spawned = [];
    const controller = new DiarizerController({}, {
      spawn: () => new FakeWorker((w, msg) => {
        if (msg.type === "load") return w.emit({ status: "ready", attempt: 0 });
        if (msg.type === "diarize") {
          w.emit({ status: "result", id: msg.id, turns: [], embeddings: [], embeddedIndices: [], durationSeconds: 5 });
        }
      }) as unknown as Worker,
    });
    const result = await controller.diarize(new Float32Array(16000 * 5), chunks);
    ok("audio with no separable speech is not an error", result.warning === null);
    ok("audio with no separable speech still yields the transcript", result.segments.length === 2);
    controller.dispose();
  }

  {
    FakeWorker.spawned = [];
    const controller = new DiarizerController({}, {
      spawn: () => new FakeWorker(() => {}) as unknown as Worker,
    });
    const result = await controller.diarize(new Float32Array(16000), []);
    ok("an empty transcript needs no models at all", FakeWorker.spawned.length === 0 && result.segments.length === 0);
    controller.dispose();
  }

  {
    // The capture buffer has to be inspectable without being emptied.
    //
    // `drainNew` empties it, so "is there anything left?" cannot be answered by
    // draining — which is how the last few seconds of a meeting used to be
    // discarded on stop, silently, in a way nobody could reproduce.
    const { AudioCapture } = await import("../src/browser/capture.ts");
    const cap = new AudioCapture();
    ok("a fresh capture has nothing pending", cap.pendingSamples() === 0);

    // Reach into the private buffer the way the audio callback does.
    const buffer = (cap as unknown as { chunks: Float32Array[] }).chunks;
    buffer.push(new Float32Array(1000), new Float32Array(500));
    ok("pending samples counts every buffered chunk", cap.pendingSamples() === 1500, `${cap.pendingSamples()}`);
    ok("counting does not empty the buffer", cap.pendingSamples() === 1500);

    const drained = cap.drainNew();
    ok("draining returns everything that was pending", drained.length === 1500);
    ok("draining empties the buffer", cap.pendingSamples() === 0);
    ok("draining twice returns nothing the second time", cap.drainNew().length === 0);
  }

  {
    // Enrolment: "say a few words" → a vector we can save under a name.
    FakeWorker.spawned = [];
    const controller = new DiarizerController({}, {
      spawn: () => new FakeWorker((w, msg) => {
        if (msg.type === "load") return w.emit({ status: "ready", attempt: 0 });
        if (msg.type === "embed") w.emit({ status: "embedding", id: msg.id, embedding: [0.5, 0.5] });
      }) as unknown as Worker,
    });
    ok("enrolment returns a voice print",
      JSON.stringify(await controller.embed(new Float32Array(16000 * 4))) === "[0.5,0.5]");
    controller.dispose();
  }

  {
    FakeWorker.spawned = [];
    const controller = new DiarizerController({}, {
      spawn: () => new FakeWorker((w, msg) => {
        if (msg.type === "load") return w.emit({ status: "ready", attempt: 0 });
        if (msg.type === "diarize") {
          // Three turns, but the middle voice sits between the other two.
          w.emit({
            status: "result", id: msg.id,
            turns: [
              { start: 0, end: 3, speaker: 0, confidence: 0.9 },
              { start: 3.1, end: 3.4, speaker: 1, confidence: 0.4 }, // never embedded
              { start: 6, end: 9, speaker: 2, confidence: 0.9 },
            ],
            embeddings: [[1, 0, 0], [0, 1, 0]],
            embeddedIndices: [0, 2],
            durationSeconds: 9,
          });
        }
      }) as unknown as Worker,
    });
    const result = await controller.diarize(new Float32Array(16000 * 9), chunks);
    ok("a turn too short to embed still lands on a real speaker",
      result.turns.every((t) => t.speaker === 0 || t.speaker === 1), JSON.stringify(result.turns));
    ok("an unembeddable turn does not invent a third speaker", result.speakers.length === 2);
    controller.dispose();
  }
}
