// Grounding for a question asked *during* a meeting.
//
// The in-meeting copilot used to be handed exactly one thing:
//
//     [{ source: "Live transcript", text: segments.map(s => s.text).join(" ") }]
//
// — an unpunctuated, unattributed, untimed wall of text, and nothing else. So
// it could not answer "what did Priya commit to?" (no speakers), "what did we
// just decide?" (no order), or anything at all about what the company already
// knows, which is the entire point of having Contextely connected. Every
// question that needed a fact from outside the room got "I don't have that
// information yet" while the fact sat one API call away.
//
// Now a mid-meeting question is grounded in both halves:
//
//   the room  — the live transcript, speaker-labelled and time-stamped, with
//               the recent tail always intact and earlier passages retrieved
//               against the question; who has spoken; the user's typed notes.
//   the company — Contextely memory, Notion, the org's indexed meetings, the
//               user's own past recordings, and today's calendar.
//
// The remote half is fetched in parallel and on a deadline: an answer that
// arrives after the moment has passed is worth nothing in a live meeting, so a
// slow source is dropped and *named* rather than waited on.

import {
  selectTranscriptContext, speakerRoster, type ContextBlock, type TranscriptLine,
} from "@ledgeur/core";
import {
  calendarSource, contextelySource, localMeetingsSource, notionSource, semanticSource,
  combine, type GatheredContext, type SourceResult,
} from "./contextSources.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("meeting-context");

/**
 * How long the copilot waits for company memory before answering without it.
 *
 * Chosen against the thing it competes with: the person is in a conversation.
 * Past roughly five seconds they have either stopped waiting or missed what was
 * said while they waited, and an answer grounded only in the room now beats a
 * fully grounded one later. Sources that miss the deadline are reported, not
 * hidden — see `slow` on the result.
 */
const REMOTE_DEADLINE_MS = 5_000;

/** Characters of transcript the copilot gets. The rest of the budget is for
 *  everything the company knows, which is what the room does not have. */
const TRANSCRIPT_BUDGET = 11_000;

export interface MeetingContextInput {
  question: string;
  title: string;
  lines: readonly TranscriptLine[];
  /** What the user has typed into the notes panel so far. */
  notes: string;
  elapsedMs: number;
}

export interface MeetingContext extends GatheredContext {
  /** Framing for the user turn: what meeting this is and how far in. */
  situation: string;
  /** Sources still running when the deadline passed. */
  slow: string[];
  /** True when the transcript had to be windowed to fit. */
  transcriptElided: boolean;
}

/** Race a source against the deadline; a straggler resolves as "slow". */
function onDeadline(p: Promise<SourceResult>, id: string, label: string): Promise<SourceResult & { slow?: boolean }> {
  return Promise.race([
    p,
    new Promise<SourceResult & { slow: boolean }>((resolve) =>
      setTimeout(() => resolve({ id, label, blocks: [], slow: true }), REMOTE_DEADLINE_MS),
    ),
  ]);
}

/**
 * Everything a mid-meeting answer is allowed to see.
 *
 * Never throws: a question asked in a live meeting must always get an answer
 * attempt, even if every remote source is down.
 */
export async function gatherMeetingContext(input: MeetingContextInput): Promise<MeetingContext> {
  const { question, title, lines, notes, elapsedMs } = input;

  // ── The room ──────────────────────────────────────────────────────────────
  const transcript = selectTranscriptContext(lines, question, { budget: TRANSCRIPT_BUDGET });
  const room: ContextBlock[] = [];
  if (transcript.text) {
    room.push({
      source: "Live transcript (this meeting, in progress)",
      // Pinned: a question asked inside a meeting is about that meeting even
      // when it shares no vocabulary with it.
      pinned: true,
      text: transcript.elided
        ? `${transcript.text}\n\n(Showing ${transcript.includedLines} of ${transcript.totalLines} lines: the most recent, plus earlier parts relevant to the question.)`
        : transcript.text,
    });
    const roster = speakerRoster(lines);
    if (roster) room.push({ source: "Who is speaking in this meeting", pinned: true, text: roster });
  }
  if (notes.trim()) {
    room.push({ source: "Your notes in this meeting", pinned: true, text: notes.trim() });
  }

  // ── The company ───────────────────────────────────────────────────────────
  // All five in parallel: they are independent, and in a live meeting the total
  // wait is what matters, not the total work.
  const remote = await Promise.all([
    onDeadline(contextelySource(question), "contextely", "Contextely company memory"),
    onDeadline(notionSource(question), "notion", "Notion"),
    onDeadline(semanticSource(question), "semantic", "Org knowledge base"),
    onDeadline(localMeetingsSource(question, { limit: 6 }), "meetings", "Your meetings"),
    onDeadline(calendarSource(), "calendar", "Calendar"),
  ]);

  const slow = remote.filter((r) => r.slow).map((r) => r.label);
  if (slow.length) log.warn("answered without slow context sources", { slow, deadlineMs: REMOTE_DEADLINE_MS });

  const results: SourceResult[] = [
    { id: "room", label: "This meeting", blocks: room },
    ...remote.map(({ slow: _slow, ...r }) => r),
  ];
  const gathered = combine(results);

  const minutes = Math.floor(elapsedMs / 60000);
  const situation =
    `You are in a meeting titled "${title || "Untitled meeting"}", ` +
    `${minutes < 1 ? "which has just started" : `about ${minutes} minute${minutes === 1 ? "" : "s"} in`}. ` +
    `The user is asking you this while it is still going on.`;

  return { ...gathered, situation, slow, transcriptElided: transcript.elided };
}

/** Segments as the shape the transcript formatter wants. Identity in practice —
 *  it exists so a change to LocalSegment can't silently break the copilot. */
export function toTranscriptLines(
  segments: readonly { speakerLabel: string; startMs: number; text: string }[],
): TranscriptLine[] {
  return segments.map((s) => ({ speakerLabel: s.speakerLabel, startMs: s.startMs, text: s.text }));
}
