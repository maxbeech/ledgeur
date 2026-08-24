// Main-thread controller around the Whisper worker. One transcription at a
// time (the worker owns one pipeline), and a load that walks the plan in fresh
// workers when a rung cannot start — see WorkerLadder for why.
//
// This is the single copy. Both the web app and the native webview use it; the
// native whisper.cpp sidecar implements the same interface for the shells that
// have it.

import { WorkerLadder, type LadderHandlers } from "./worker-ladder.ts";
import type { AsrChunk } from "../diarize/types.ts";

export interface TranscriptionResult {
  /** The whole passage, as Whisper wrote it. */
  text: string;
  /** Timed pieces, when the model returned them. Empty is valid — the caller
   *  degrades to an unlabelled transcript rather than failing. */
  chunks: AsrChunk[];
}

let counter = 0;

export class TranscriberController extends WorkerLadder {
  private pending = new Map<number, {
    resolve: (r: TranscriptionResult) => void;
    reject: (e: Error) => void;
  }>();

  constructor(handlers: LadderHandlers = {}, options: { scriptUrl?: string; spawn?: (u: string) => Worker } = {}) {
    super({
      scriptUrl: options.scriptUrl ?? "/transcribe.worker.js",
      subject: "the transcription worker",
      handlers,
      spawn: options.spawn,
    });
    this.listen((e) => {
      const d = e.data || {};
      if (d.status === "result") {
        const p = this.pending.get(d.id);
        if (p) { this.pending.delete(d.id); p.resolve({ text: d.text || "", chunks: d.chunks || [] }); }
      } else if (d.status === "error" && d.id != null) {
        const p = this.pending.get(d.id);
        if (p) { this.pending.delete(d.id); p.reject(new Error(d.message)); }
      }
    });
  }

  /** Begin downloading + warming the model. lang: "en" | "en-hq" | "multi". */
  preload(lang: string = "en"): Promise<void> {
    return this.ensureLoaded(lang, { lang });
  }

  /** Preload and resolve once a model is live (rejects if none can start). */
  preloadAndWait(lang: string = "en"): Promise<void> {
    return this.preload(lang);
  }

  /**
   * Transcribe a 16 kHz mono Float32 buffer.
   *
   * `offsetSeconds` places this buffer on the meeting's clock — live capture
   * hands over 20-second slices, and without the offset every slice's
   * timestamps would restart at zero and no speaker label could line up.
   *
   * The buffer is *transferred*, not copied, so the caller must not touch it
   * afterwards.
   */
  async transcribe(
    audio: Float32Array,
    lang: string = "en",
    offsetSeconds = 0,
  ): Promise<TranscriptionResult> {
    // Wait for a live pipeline before handing over the audio: posting into a
    // worker that is about to be discarded would lose the transferred buffer.
    await this.ensureLoaded(lang, { lang });
    const worker = this.live;
    if (!worker) throw new Error("Transcriber is not running.");
    const id = ++counter;
    return new Promise<TranscriptionResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(
        { type: "transcribe", id, audio, lang, attempt: this.attempt, offsetSeconds },
        [audio.buffer],
      );
    });
  }

  /** Text only — for callers that do not care about timings. */
  async transcribeText(audio: Float32Array, lang: string = "en"): Promise<string> {
    return (await this.transcribe(audio, lang)).text;
  }

  protected override onTeardown(): void {
    this.pending.forEach((p) => p.reject(new Error("Transcription cancelled.")));
    this.pending.clear();
  }
}
