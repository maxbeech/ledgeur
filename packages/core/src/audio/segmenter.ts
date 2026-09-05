// Cutting a live capture into the pieces a speech model actually sees.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// The recorder used to hand Whisper a fixed slice every N seconds, cut on a
// wall clock. That is the wrong boundary in two expensive ways:
//
//   1. Accuracy. A clock cut lands wherever it lands — usually mid-word. Whisper
//      is an autoregressive model with no context beyond the buffer it is given,
//      so a half-word at each edge is not merely lost: it is *guessed*, and the
//      guess drags the rest of the decode with it. Cutting on a pause instead
//      hands the model whole utterances, which is the input it was trained on.
//
//   2. Latency. Whisper pads every input to a 30-second mel window, so a 3-second
//      slice costs almost exactly what an 18-second slice costs. Slicing more
//      often to "feel faster" therefore buys latency with a large multiple of
//      the compute per second of speech — and once the model can't keep up with
//      real time, the transcript falls behind permanently. Emitting on pauses
//      gets text out at the moment a thought ends (which is when a reader wants
//      it) without paying for a pass per few seconds of silence.
//
// So: accumulate, and emit when the speaker stops — bounded below so we don't
// pay a full model pass for one word, and bounded above so a monologue with no
// breath still produces text.
//
// Pure and frame-based (no Web Audio, no DOM): unit-tested, and shared by the
// live recorder and any other caller that needs the same boundaries.

import { WHISPER_SAMPLE_RATE } from "./pcm.ts";

export interface SegmenterOptions {
  /** Rate of the audio pushed in. Everything below is expressed in seconds. */
  sampleRate?: number;
  /** Never emit a chunk shorter than this except on `flush()`. */
  minSeconds?: number;
  /** Emit unconditionally once this much is buffered, pause or not. */
  maxSeconds?: number;
  /** Frame RMS at or below this counts as silence. */
  silenceRms?: number;
  /** Trailing quiet needed before a pause counts as the end of an utterance. */
  silenceHoldSeconds?: number;
  /** Analysis frame size. 20 ms is the usual granularity for speech energy. */
  frameSeconds?: number;
  /**
   * Silence kept on the end of an emitted chunk. Cutting flush against the last
   * sample of speech clips the decay of the final consonant, which Whisper
   * hears as a different word ("start" → "star"). A little room is free.
   */
  tailPadSeconds?: number;
}

/** One emitted piece, with its exact position on the meeting clock. */
export interface Utterance {
  audio: Float32Array;
  /** Sample index, from the first sample ever pushed, of `audio[0]`. */
  startSample: number;
  /** One past the last sample of `audio`, on the same scale. */
  endSample: number;
  /** Why this was emitted — `"pause"` is a real boundary, the others are not. */
  reason: "pause" | "max" | "flush";
}

const DEFAULTS = {
  sampleRate: WHISPER_SAMPLE_RATE,
  minSeconds: 3,
  maxSeconds: 18,
  // Matches the recorder's own SILENCE_RMS gate, so "quiet enough to cut on" and
  // "too quiet to bother transcribing" agree rather than fighting each other.
  silenceRms: 0.006,
  silenceHoldSeconds: 0.45,
  frameSeconds: 0.02,
  tailPadSeconds: 0.15,
} as const;

export class UtteranceSegmenter {
  private readonly opts: Required<SegmenterOptions>;
  private readonly minSamples: number;
  private readonly maxSamples: number;
  private readonly frameSamples: number;
  private readonly holdFrames: number;
  private readonly tailPadSamples: number;

  /** Undrained audio, oldest first. */
  private parts: Float32Array[] = [];
  private buffered = 0;
  /** Samples already emitted, so every chunk knows where it sits in time. */
  private consumed = 0;

  constructor(options: SegmenterOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
    const { sampleRate } = this.opts;
    this.minSamples = Math.round(this.opts.minSeconds * sampleRate);
    this.maxSamples = Math.round(this.opts.maxSeconds * sampleRate);
    this.frameSamples = Math.max(1, Math.round(this.opts.frameSeconds * sampleRate));
    this.holdFrames = Math.max(1, Math.round(this.opts.silenceHoldSeconds / this.opts.frameSeconds));
    this.tailPadSamples = Math.round(this.opts.tailPadSeconds * sampleRate);
  }

  push(samples: Float32Array): void {
    if (samples.length === 0) return;
    this.parts.push(samples);
    this.buffered += samples.length;
  }

  get pendingSamples(): number {
    return this.buffered;
  }

  get pendingSeconds(): number {
    return this.buffered / this.opts.sampleRate;
  }

  /** Samples consumed so far — the start of whatever is emitted next. */
  get consumedSamples(): number {
    return this.consumed;
  }

  /**
   * The next complete utterance, or null while the speaker is still going and
   * the buffer is under `maxSeconds`.
   *
   * Call in a loop: a long pause after a backlog can free several at once.
   */
  take(): Utterance | null {
    if (this.buffered < this.minSamples) return null;
    const buf = this.contiguous();

    if (this.buffered >= this.maxSamples) {
      // Over the ceiling with no pause offered. Cut at the quietest frame in the
      // eligible window rather than exactly on the limit: even mid-sentence, the
      // gap between two words is a much better seam than the middle of a vowel.
      const cut = this.quietestCut(buf, this.minSamples, this.maxSamples);
      return this.emit(buf, cut, "max");
    }

    const cut = this.pauseCut(buf);
    return cut === null ? null : this.emit(buf, cut, "pause");
  }

  /**
   * Everything buffered, boundaries ignored — for the end of a meeting, where
   * the alternative is silently dropping the last thing anybody said.
   */
  flush(): Utterance | null {
    if (this.buffered === 0) return null;
    const buf = this.contiguous();
    return this.emit(buf, buf.length, "flush");
  }

  /** Collapse the queue to one buffer, keeping it as the only part. */
  private contiguous(): Float32Array {
    if (this.parts.length === 1) return this.parts[0];
    const out = new Float32Array(this.buffered);
    let at = 0;
    for (const p of this.parts) { out.set(p, at); at += p.length; }
    this.parts = [out];
    return out;
  }

  private emit(buf: Float32Array, cutAt: number, reason: Utterance["reason"]): Utterance {
    const end = Math.min(Math.max(cutAt, 1), buf.length);
    // slice() copies, so the emitted buffer can be transferred to a worker
    // without taking the retained remainder's memory with it.
    const audio = buf.slice(0, end);
    const rest = buf.subarray(end);
    this.parts = rest.length ? [rest.slice()] : [];
    this.buffered = rest.length;
    const startSample = this.consumed;
    this.consumed += end;
    return { audio, startSample, endSample: this.consumed, reason };
  }

  /** RMS of the frame starting at `from`, clamped to the buffer's end. */
  private frameRms(buf: Float32Array, from: number): number {
    const to = Math.min(from + this.frameSamples, buf.length);
    if (to <= from) return 0;
    let sum = 0;
    for (let i = from; i < to; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / (to - from));
  }

  /**
   * Where to cut for a trailing pause, or null if the tail is still speech.
   *
   * Only the *end* of the buffer is considered. An earlier pause is deliberately
   * left in place: it is the gap between two sentences of the same turn, and
   * splitting there costs a whole extra model pass for no gain in either
   * latency or accuracy.
   */
  private pauseCut(buf: Float32Array): number | null {
    const frames = Math.floor(buf.length / this.frameSamples);
    if (frames < this.holdFrames) return null;

    let quiet = 0;
    for (let f = frames - 1; f >= 0; f--) {
      if (this.frameRms(buf, f * this.frameSamples) > this.opts.silenceRms) break;
      quiet++;
    }
    if (quiet < this.holdFrames) return null;

    // Speech ends where the quiet run begins; keep a little of the decay.
    const speechEnd = (frames - quiet) * this.frameSamples;
    if (speechEnd < this.minSamples) return null; // the "speech" was too short to be worth a pass
    return Math.min(speechEnd + this.tailPadSamples, buf.length);
  }

  /** Quietest frame boundary in [lo, hi] — the least-bad seam mid-sentence. */
  private quietestCut(buf: Float32Array, lo: number, hi: number): number {
    const start = Math.max(this.frameSamples, lo);
    const end = Math.min(hi, buf.length);
    let bestAt = end;
    let bestRms = Infinity;
    for (let at = start; at <= end - this.frameSamples; at += this.frameSamples) {
      const level = this.frameRms(buf, at);
      if (level < bestRms) { bestRms = level; bestAt = at; }
    }
    return bestAt;
  }
}
