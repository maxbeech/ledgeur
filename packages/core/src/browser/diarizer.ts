// Main-thread controller for speaker diarization.
//
// It owns the worker and nothing else: the deciding — clustering voices into
// people and matching them to names — is a pure function in
// ../diarize/assemble.ts, so it can be tested without a browser and shared
// between the live and imported paths.
//
// Two ways in:
//
//   diarize(audio, chunks)   one shot, for a file you already hold in memory.
//   analyse(audio, offset)   one slice at a time, for a meeting in progress.
//
// The second exists because a one-hour recording is ~230 MB of Float32 and
// holding it in a tab purely to diarize it at the end is not reasonable. Live
// capture analyses each slice as it arrives and keeps only the turns and their
// voice vectors, which are tiny. Clustering still happens once over everything
// at the end, because "which of these voices is the same person" is not a
// question you can answer twenty seconds at a time.
//
// Diarization is deliberately non-fatal. Every failure path returns a usable
// result with no speaker labels rather than throwing: a correct transcript with
// no names beats an error where a transcript should be, and the user has
// already spent the meeting recording it.

import { WorkerLadder, type LadderHandlers } from "./worker-ladder.ts";
import {
  assembleDiarization, concatSlices, offsetSlice, unattributed,
  type AnalysedSlice, type AssembleOptions, type DiarizationResult,
} from "../diarize/assemble.ts";
import type { AsrChunk } from "../diarize/types.ts";

export interface DiarizeProgress {
  /** "segmenting" while finding turns, "identifying" while embedding them. */
  stage: "segmenting" | "identifying";
  done: number;
  total: number;
}

export interface DiarizeOptions extends AssembleOptions {
  onProgress?: (p: DiarizeProgress) => void;
}

let counter = 0;

export class DiarizerController extends WorkerLadder {
  private pending = new Map<number, {
    resolve: (r: AnalysedSlice) => void;
    reject: (e: Error) => void;
    onProgress?: (p: DiarizeProgress) => void;
  }>();
  private embedPending = new Map<number, {
    resolve: (e: number[] | null) => void;
    reject: (e: Error) => void;
  }>();

  constructor(handlers: LadderHandlers = {}, options: { scriptUrl?: string; spawn?: (u: string) => Worker } = {}) {
    super({
      scriptUrl: options.scriptUrl ?? "/diarize.worker.js",
      subject: "the speaker models",
      handlers,
      spawn: options.spawn,
    });
    this.listen((e) => {
      const d = e.data || {};
      if (d.status === "result") {
        const p = this.pending.get(d.id);
        if (p) {
          this.pending.delete(d.id);
          p.resolve({
            turns: d.turns || [],
            embeddings: d.embeddings || [],
            embeddedIndices: d.embeddedIndices || [],
          });
        }
      } else if (d.status === "embedding") {
        const p = this.embedPending.get(d.id);
        if (p) { this.embedPending.delete(d.id); p.resolve(d.embedding ?? null); }
      } else if (d.status === "stage") {
        this.pending.get(d.id)?.onProgress?.({ stage: d.stage, done: d.done, total: d.total });
      } else if (d.status === "error" && d.id != null) {
        const p = this.pending.get(d.id) ?? this.embedPending.get(d.id);
        if (p) {
          this.pending.delete(d.id);
          this.embedPending.delete(d.id);
          p.reject(new Error(d.message));
        }
      }
    });
  }

  /** Begin downloading the speaker models. Worth calling as soon as a meeting
   *  starts, so the download overlaps the meeting rather than following it. */
  preload(): Promise<void> {
    return this.ensureLoaded("diarize");
  }

  /**
   * Find the turns in one slice of audio and give each a voice vector.
   *
   * `audio` must be 16 kHz mono and is *transferred* to the worker, so the
   * caller must not touch it afterwards. `offsetSeconds` places the slice on
   * the meeting clock.
   */
  async analyse(
    audio: Float32Array,
    offsetSeconds = 0,
    onProgress?: (p: DiarizeProgress) => void,
  ): Promise<AnalysedSlice> {
    await this.ensureLoaded("diarize");
    const worker = this.live;
    if (!worker) throw new Error("The speaker models are not running.");
    const id = ++counter;
    const slice = await new Promise<AnalysedSlice>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      worker.postMessage(
        { type: "diarize", id, audio, sampleRate: 16000, attempt: this.attempt },
        [audio.buffer],
      );
    });
    return offsetSlice(slice, offsetSeconds);
  }

  /**
   * Diarize a whole recording in one go — the imported-file path.
   *
   * Never rejects: a failure comes back as `warning` on an otherwise correct,
   * unlabelled transcript.
   */
  async diarize(
    audio: Float32Array,
    chunks: readonly AsrChunk[],
    options: DiarizeOptions = {},
  ): Promise<DiarizationResult> {
    if (chunks.length === 0) return unattributed(chunks);
    try {
      const analysed = await this.analyse(audio, 0, options.onProgress);
      return assembleDiarization(chunks, analysed, options);
    } catch (e) {
      return unattributed(chunks, (e as Error).message);
    }
  }

  /**
   * Finish a live meeting: cluster everything analysed during it.
   *
   * Pure once the slices are in hand, so a meeting whose models failed halfway
   * still assembles from the slices that did work.
   */
  static assemble(
    chunks: readonly AsrChunk[],
    slices: readonly AnalysedSlice[],
    options: AssembleOptions = {},
  ): DiarizationResult {
    return assembleDiarization(chunks, concatSlices(slices), options);
  }

  /**
   * Voice print for a deliberate enrolment recording — "say a few words so
   * Ledgeur can recognise you". Returns null when the models produced nothing.
   */
  async embed(audio: Float32Array): Promise<number[] | null> {
    await this.ensureLoaded("diarize");
    const worker = this.live;
    if (!worker) throw new Error("The speaker models are not running.");
    const id = ++counter;
    return new Promise<number[] | null>((resolve, reject) => {
      this.embedPending.set(id, { resolve, reject });
      worker.postMessage(
        { type: "embed", id, audio, sampleRate: 16000, attempt: this.attempt },
        [audio.buffer],
      );
    });
  }

  protected override onTeardown(): void {
    const cancelled = new Error("Speaker identification cancelled.");
    this.pending.forEach((p) => p.reject(cancelled));
    this.pending.clear();
    this.embedPending.forEach((p) => p.reject(cancelled));
    this.embedPending.clear();
  }
}

export type { AnalysedSlice, DiarizationResult };
