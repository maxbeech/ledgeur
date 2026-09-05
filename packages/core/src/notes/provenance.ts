// Per-line provenance: which part of the meeting each note line came from.
//
// A summary bullet is a claim about what happened. Without a way back to the
// moment it came from, checking it means re-reading the whole transcript, so in
// practice nobody checks — which is the same as trusting a model's paraphrase
// unconditionally. Linking each line to its lines in the transcript turns
// "sounds right" into one click.
//
// ── Honesty rule ────────────────────────────────────────────────────────────
// A citation that points at the wrong line is worse than no citation, because
// it looks verified. So a line is attributed only when the evidence is strong
// enough (`MIN_SCORE`), and lines below that threshold come back with no
// citation at all rather than with the least-bad guess. Notes written by the
// heuristic summariser are lifted verbatim from sentences and match almost
// perfectly; notes written by a model are paraphrases and match loosely — the
// threshold is set for the second case, and the first clears it easily.
//
// Pure and deterministic, so it is unit-tested without a model.

import { contentTokens, documentFrequency, relevance } from "../text/tokens.ts";
import type { TranscriptLine } from "../context/transcript.ts";

/** A transcript line with a stable id, so a citation survives re-rendering. */
export interface AttributableLine extends TranscriptLine {
  id: string;
}

export interface Citation {
  /** Ids of the transcript lines this note line is drawn from, in order. */
  lineIds: string[];
  /** Where to jump to — the start of the earliest cited line. */
  startMs: number;
  /** 0..1 lexical support. Shown, not hidden: a weak-but-passing match should
   *  look weaker than a verbatim one. */
  confidence: number;
}

export interface AttributedNote {
  text: string;
  /** Absent when nothing in the transcript supports this line well enough. */
  citation?: Citation;
}

/**
 * Minimum support before a note line is linked to a transcript line.
 *
 * Measured against real notes rather than picked: a model paraphrase of a
 * transcript line typically retains a third to a half of its content words
 * ("we agreed to ship the pricing page on Friday" → "Decision: ship pricing
 * page Friday"), while an unrelated line of the same meeting shares roughly a
 * tenth, mostly project nouns that recur everywhere. 0.3 sits in that gap.
 */
const MIN_SCORE = 0.3;

/** How many adjacent transcript lines a single note line may cite. */
const MAX_SPAN = 3;

/**
 * Link each note line back to the transcript.
 *
 * Scores every note line against every transcript line, weighting rare words
 * (a shared "pricing" is evidence; a shared "meeting" is not), then extends the
 * best match to its neighbours while they keep adding support — a decision is
 * usually stated across two or three turns, not one.
 */
export function attributeNotes(
  noteLines: readonly string[],
  transcript: readonly AttributableLine[],
): AttributedNote[] {
  if (transcript.length === 0) return noteLines.map((text) => ({ text }));
  const texts = transcript.map((l) => l.text);
  const df = documentFrequency(texts);

  return noteLines.map((text) => {
    if (contentTokens(text).length === 0) return { text };

    const scores = texts.map((t) => relevance(text, t, df, texts.length));
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    if (scores[best] < MIN_SCORE) return { text };

    // Extend outwards while a neighbour still contributes real support. Half
    // the peak, so a strong match pulls in its context and a marginal one
    // stands alone.
    const floor = Math.max(MIN_SCORE / 2, scores[best] / 2);
    let start = best;
    let end = best;
    while (end - start + 1 < MAX_SPAN) {
      const before = start > 0 ? scores[start - 1] : -1;
      const after = end < scores.length - 1 ? scores[end + 1] : -1;
      if (before < floor && after < floor) break;
      if (after >= before) end++;
      else start--;
    }

    return {
      text,
      citation: {
        lineIds: transcript.slice(start, end + 1).map((l) => l.id),
        startMs: transcript[start].startMs,
        confidence: Number(scores[best].toFixed(3)),
      },
    };
  });
}

/** Every section of a meeting's notes, attributed in one pass. */
export interface AttributedNotes {
  summary: AttributedNote[];
  decisions: AttributedNote[];
  questions: AttributedNote[];
  actionItems: AttributedNote[];
  /** Note lines with no supporting transcript line, across all sections. It is
   *  worth surfacing: a summary bullet nothing in the meeting supports is
   *  either a model's invention or a transcription gap, and both matter. */
  unsupported: number;
}

export function attributeMeetingNotes(
  notes: { summary: string[]; decisions: string[]; questions: string[]; actionItems: string[] },
  transcript: readonly AttributableLine[],
): AttributedNotes {
  const summary = attributeNotes(notes.summary, transcript);
  const decisions = attributeNotes(notes.decisions, transcript);
  const questions = attributeNotes(notes.questions, transcript);
  const actionItems = attributeNotes(notes.actionItems, transcript);
  const all = [...summary, ...decisions, ...questions, ...actionItems];
  return { summary, decisions, questions, actionItems, unsupported: all.filter((a) => !a.citation).length };
}
