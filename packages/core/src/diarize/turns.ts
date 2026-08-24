// Turning model output into a readable transcript: tidy the segmentation
// model's turns, then decide which words belong to which voice.
//
// All pure. The worker does the tensor work; everything decided here is
// deterministic and unit-tested, because attribution mistakes are the kind of
// bug that is invisible in a demo and obvious to a customer.

import type { AsrChunk, AttributedSegment, RawTurn, SpeakerTurn } from "./types.ts";

/** Shift turns from window-relative to clip-relative seconds. */
export function offsetTurns<T extends RawTurn>(turns: readonly T[], offsetSeconds: number): T[] {
  return turns.map((t) => ({ ...t, start: t.start + offsetSeconds, end: t.end + offsetSeconds }));
}

/** A turn shorter than this is too little audio for a trustworthy speaker
 *  embedding — WeSpeaker needs roughly a second of voice to be stable. Shorter
 *  turns are kept in the transcript but inherit a neighbour's identity. */
export const MIN_EMBED_SECONDS = 0.9;

/**
 * Join runs of the same local speaker separated by less than `gapSeconds`.
 *
 * The segmentation model emits a turn per frame-run, so a single sentence with
 * a breath in it arrives as three turns. Left alone that inflates the number of
 * embeddings (slow) and makes short, unreliable ones (inaccurate).
 */
export function mergeAdjacentTurns(turns: readonly RawTurn[], gapSeconds = 0.5): RawTurn[] {
  const sorted = [...turns].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: RawTurn[] = [];
  for (const turn of sorted) {
    const last = out[out.length - 1];
    if (last && last.speaker === turn.speaker && turn.start - last.end <= gapSeconds) {
      // Confidence of the joined turn is the duration-weighted mean, so a long
      // confident run is not dragged down by a short uncertain tail.
      const lastDur = Math.max(0, last.end - last.start);
      const thisDur = Math.max(0, turn.end - turn.start);
      const total = lastDur + thisDur;
      last.confidence = total > 0
        ? (last.confidence * lastDur + turn.confidence * thisDur) / total
        : Math.max(last.confidence, turn.confidence);
      last.end = Math.max(last.end, turn.end);
      continue;
    }
    out.push({ ...turn });
  }
  return out;
}

/** Seconds of overlap between two intervals (0 when they do not touch). */
export function overlapSeconds(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Give every turn a speaker, including the ones too short to embed.
 *
 * `assignments` covers only the turns that were embedded (in order). A turn
 * that was skipped takes the speaker of whichever embedded turn is nearest in
 * time — in a real conversation a half-second "mm-hm" almost always belongs
 * beside the speech it interrupts.
 */
export function applyClusters(
  turns: readonly RawTurn[],
  embeddedIndices: readonly number[],
  assignments: readonly number[],
): SpeakerTurn[] {
  const speakerOf = new Map<number, number>();
  embeddedIndices.forEach((turnIndex, i) => {
    const cluster = assignments[i];
    if (cluster !== undefined) speakerOf.set(turnIndex, cluster);
  });

  return turns.map((turn, i) => {
    const known = speakerOf.get(i);
    if (known !== undefined) return { ...turn, speaker: known };

    // Nearest embedded turn by time-distance between interval midpoints.
    let best: number | null = null;
    let bestDistance = Infinity;
    const mid = (turn.start + turn.end) / 2;
    for (const j of embeddedIndices) {
      const other = turns[j];
      if (!other) continue;
      const distance = Math.abs((other.start + other.end) / 2 - mid);
      if (distance < bestDistance) { bestDistance = distance; best = speakerOf.get(j) ?? null; }
    }
    return { ...turn, speaker: best ?? 0 };
  });
}

/** Words with the whitespace that followed them, so a re-join is lossless. */
function words(text: string): string[] {
  return text.split(/(\s+)/).filter((w) => w.length > 0);
}

/**
 * Attach a speaker to every piece of transcribed text.
 *
 * A Whisper chunk is a sentence-ish run that can straddle a speaker change
 * ("…so we should ship it. — I disagree."). Rather than give the whole
 * sentence to whoever held the floor longest, a straddling chunk is cut at the
 * speaker boundary and its words dealt out in proportion to the time each
 * speaker held inside that chunk. It is an approximation — Whisper gives us
 * segment timings, not word timings — but it puts the disagreement in the right
 * person's mouth, which is the thing that matters.
 *
 * Text that overlaps no turn at all keeps `speaker: null` rather than being
 * guessed at or dropped.
 */
export function attributeChunks(
  chunks: readonly AsrChunk[],
  turns: readonly SpeakerTurn[],
  options: { minShareSeconds?: number } = {},
): AttributedSegment[] {
  const minShare = options.minShareSeconds ?? 0.6;
  const out: AttributedSegment[] = [];

  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (!text) continue;
    const start = chunk.start;
    const end = chunk.end ?? chunk.start;
    if (!(end > start)) {
      out.push({ startMs: Math.round(start * 1000), endMs: Math.round(start * 1000), text, speaker: null, confidence: null });
      continue;
    }

    // How long each speaker held the floor inside this chunk.
    const held = new Map<number, { seconds: number; confidence: number; first: number }>();
    for (const turn of turns) {
      const shared = overlapSeconds(start, end, turn.start, turn.end);
      if (shared <= 0) continue;
      const entry = held.get(turn.speaker);
      if (entry) {
        entry.confidence = (entry.confidence * entry.seconds + turn.confidence * shared) / (entry.seconds + shared);
        entry.seconds += shared;
        entry.first = Math.min(entry.first, Math.max(start, turn.start));
      } else {
        held.set(turn.speaker, { seconds: shared, confidence: turn.confidence, first: Math.max(start, turn.start) });
      }
    }

    if (held.size === 0) {
      out.push({ startMs: Math.round(start * 1000), endMs: Math.round(end * 1000), text, speaker: null, confidence: null });
      continue;
    }

    // Speakers with a real share, in the order they spoke.
    const shares = [...held.entries()]
      .filter(([, v]) => v.seconds >= minShare)
      .sort((a, b) => a[1].first - b[1].first);

    if (shares.length <= 1) {
      const [speaker, v] = shares[0] ?? [...held.entries()].sort((a, b) => b[1].seconds - a[1].seconds)[0];
      out.push({
        startMs: Math.round(start * 1000), endMs: Math.round(end * 1000),
        text, speaker, confidence: v.confidence,
      });
      continue;
    }

    // Straddling chunk: deal the words out by time share.
    const totalHeld = shares.reduce((sum, [, v]) => sum + v.seconds, 0);
    const tokens = words(text);
    // Only whitespace-separated words count towards the split, so the
    // proportions are about language rather than about spacing.
    const wordCount = tokens.filter((t) => t.trim().length > 0).length;
    let cursor = 0;
    let taken = 0;
    let clock = start;

    shares.forEach(([speaker, v], i) => {
      const last = i === shares.length - 1;
      const want = last ? wordCount - taken : Math.max(1, Math.round((v.seconds / totalHeld) * wordCount));
      let got = 0;
      const piece: string[] = [];
      while (cursor < tokens.length && (got < want || tokens[cursor].trim().length === 0)) {
        const token = tokens[cursor++];
        piece.push(token);
        if (token.trim().length > 0) got++;
      }
      taken += got;
      const slice = piece.join("").trim();
      if (!slice) return;
      const spanEnd = last ? end : Math.min(end, clock + v.seconds);
      out.push({
        startMs: Math.round(clock * 1000),
        endMs: Math.round(spanEnd * 1000),
        text: slice,
        speaker,
        confidence: v.confidence,
      });
      clock = spanEnd;
    });
  }

  return out;
}

/** Collapse consecutive segments from one speaker into a paragraph — how a
 *  transcript is read, as opposed to how it is stored. */
export function groupBySpeaker(segments: readonly AttributedSegment[]): AttributedSegment[] {
  const out: AttributedSegment[] = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.speaker === seg.speaker) {
      last.text = `${last.text} ${seg.text}`.replace(/\s+/g, " ").trim();
      last.endMs = Math.max(last.endMs, seg.endMs);
      if (last.confidence != null && seg.confidence != null) {
        last.confidence = Math.min(last.confidence, seg.confidence);
      }
      continue;
    }
    out.push({ ...seg });
  }
  return out;
}

/** mm:ss (or h:mm:ss past an hour) for a millisecond offset. */
export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
