// Choosing which of this device's meetings are worth putting in front of a
// question. Pure — no IndexedDB, no network — so it is unit-tested directly.
//
// Split out of contextSources.ts, which reaches Supabase, Notion and the
// embeddings endpoint the moment it is imported. Ranking is the part with the
// judgement in it and the part most likely to be wrong, so it should be
// testable without any of that.

import { documentFrequency, relevance, type ContextBlock } from "@ledgeur/core";
import type { LocalMeeting } from "./meetingsStore.ts";

const meetingText = (m: LocalMeeting) =>
  [m.title, m.summary.join(" "), m.decisions.join(" "), m.actionItems.join(" "), m.manualNotes ?? ""].join("\n");

/**
 * The `limit` meetings most relevant to a question, best first.
 *
 * Previously the newest twelve regardless of the question — so anything asked
 * about a meeting from three weeks ago was answered with "I don't have that
 * information" while the answer sat in IndexedDB. Recency still breaks ties,
 * because two equally relevant meetings should surface the newer one.
 */
export function rankMeetings(meetings: readonly LocalMeeting[], question: string, limit: number): LocalMeeting[] {
  if (meetings.length <= limit) return meetings.slice(0, limit);
  const corpus = meetings.map(meetingText);
  const df = documentFrequency(corpus);
  return meetings
    .map((m, i) => ({ m, i, score: relevance(question, corpus[i], df, meetings.length) }))
    // `i` ascends with recency because listMeetings sorts newest first.
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.i - b.i))
    .slice(0, limit)
    .map((x) => x.m);
}

/** A meeting as one context block: its notes, not its transcript. The
 *  transcript is what the meeting's own page is for; a block that carried it
 *  would crowd out every other source for a question about one of them. */
export function meetingToBlock(m: LocalMeeting): ContextBlock {
  const when = new Date(m.createdAt).toLocaleDateString();
  const parts = [
    m.summary.length ? m.summary.join("\n") : "",
    m.decisions.length ? `Decisions: ${m.decisions.join("; ")}` : "",
    m.actionItems.length ? `Action items: ${m.actionItems.join("; ")}` : "",
  ].filter(Boolean);
  return { source: `Meeting: ${m.title} (${when})`, text: parts.join("\n") };
}
