// Turning raw model output into named speakers.
//
// Pulled out of the worker controller so it is a pure function: given the turns
// and voice vectors the models produced, plus the transcript, decide who is who.
// That makes the hardest part of diarization testable without a browser, and it
// makes the live and imported paths share one implementation.
//
// ── Why the live path needs this shape ──────────────────────────────────────
// A one-hour meeting at 16 kHz mono is ~230 MB of Float32. Holding the whole
// recording in a browser tab just so it can be diarized at the end is not
// reasonable, so live capture analyses each 20-second slice as it arrives and
// keeps only what is small: the turns (four numbers each) and one 256-number
// vector per turn. Clustering then happens once, at the end, over everything —
// which is essential, because deciding who "Speaker 1" is cannot be done a
// slice at a time.

import { centroid, clusterEmbeddings } from "./cluster.ts";
import { applyClusters, attributeChunks, mergeAdjacentTurns, offsetTurns } from "./turns.ts";
import { identifySpeakers } from "./voiceprints.ts";
import type {
  AsrChunk, AttributedSegment, RawTurn, SpeakerSummary, SpeakerTurn, VoiceProfile,
} from "./types.ts";

/** What one pass of the models produced over one slice of audio. */
export interface AnalysedSlice {
  turns: RawTurn[];
  embeddings: number[][];
  /** Indices into `turns` for the entries `embeddings` describes, in order. */
  embeddedIndices: number[];
}

export interface AssembleOptions {
  profiles?: readonly VoiceProfile[];
  /** Force a speaker count when the user knows how many people were present. */
  speakers?: number;
}

export interface DiarizationResult {
  /** Transcript text with a speaker index on each piece. */
  segments: AttributedSegment[];
  /** One entry per distinct voice, named where we recognised it. */
  speakers: SpeakerSummary[];
  /** Turns with stable speaker indices — for a waveform or a timeline. */
  turns: SpeakerTurn[];
  /** Set when diarization could not run. The segments are still correct; they
   *  simply have `speaker: null`. Never thrown — always reported. */
  warning: string | null;
}

/** A transcript with no speaker information. The honest fallback. */
export function unattributed(chunks: readonly AsrChunk[], warning: string | null = null): DiarizationResult {
  return { segments: attributeChunks(chunks, []), speakers: [], turns: [], warning };
}

/** Shift one slice's output onto the meeting clock. */
export function offsetSlice(slice: AnalysedSlice, offsetSeconds: number): AnalysedSlice {
  return offsetSeconds === 0
    ? slice
    : { ...slice, turns: offsetTurns(slice.turns, offsetSeconds) };
}

/**
 * Merge every analysed slice into one timeline, renumbering the embedded
 * indices so they still point at the right turns.
 */
export function concatSlices(slices: readonly AnalysedSlice[]): AnalysedSlice {
  const turns: RawTurn[] = [];
  const embeddings: number[][] = [];
  const embeddedIndices: number[] = [];
  for (const slice of slices) {
    const base = turns.length;
    turns.push(...slice.turns);
    slice.embeddedIndices.forEach((index, i) => {
      const vector = slice.embeddings[i];
      if (!vector?.length) return;
      embeddedIndices.push(base + index);
      embeddings.push(vector);
    });
  }
  return { turns, embeddings, embeddedIndices };
}

/**
 * Decide who spoke, and what they are called.
 *
 * Order matters here and is the easiest thing to get wrong. `embeddedIndices`
 * points into the *untidied* turn list, so clustering must run against that
 * list. Only once every turn carries a global speaker is it safe to merge
 * neighbours — merging earlier would join two turns that happen to share a
 * window-local id but belong to different people.
 */
export function assembleDiarization(
  chunks: readonly AsrChunk[],
  analysed: AnalysedSlice,
  options: AssembleOptions = {},
): DiarizationResult {
  if (chunks.length === 0) return unattributed(chunks);
  if (analysed.turns.length === 0 || analysed.embeddings.length === 0) {
    // No separable speech: one person on a clean microphone, or silence. Not an
    // error, and not something to warn about.
    return unattributed(chunks);
  }

  const assignments = clusterEmbeddings(analysed.embeddings, { speakers: options.speakers });
  const withSpeakers = applyClusters(analysed.turns, analysed.embeddedIndices, assignments);
  const turns = mergeAdjacentTurns(withSpeakers) as SpeakerTurn[];

  // A speaker's voice print is the mean of the turns that made up their
  // cluster — a steadier vector than any single turn, and the one saved when
  // the user gives them a name.
  const byCluster = new Map<number, { vectors: number[][]; seconds: number }>();
  analysed.embeddedIndices.forEach((turnIndex, i) => {
    const cluster = assignments[i];
    const turn = analysed.turns[turnIndex];
    if (cluster === undefined || !turn) return;
    const entry = byCluster.get(cluster) ?? { vectors: [], seconds: 0 };
    entry.vectors.push(analysed.embeddings[i]);
    entry.seconds += Math.max(0, turn.end - turn.start);
    byCluster.set(cluster, entry);
  });

  const speakers = identifySpeakers(
    [...byCluster.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([speaker, v]) => ({ speaker, embedding: centroid(v.vectors), speakingSeconds: v.seconds })),
    options.profiles ?? [],
  );

  return { segments: attributeChunks(chunks, turns), speakers, turns, warning: null };
}
