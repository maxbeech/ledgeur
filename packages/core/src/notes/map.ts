// Bridges the transcript-derived MeetingNotes (from summarize.ts / an LLM) into
// the persisted domain shapes: a MeetingNote record and its ActionItem rows.

import type { MeetingNotes } from "./summarize.ts";
import { notesToMarkdown } from "./summarize.ts";
import type { MeetingNote } from "../domain/entities.ts";

/** Assemble a persistable MeetingNote from generated notes + a transcript. */
export function toMeetingNote(opts: {
  meetingId: string;
  title: string;
  dateISO: string;
  notes: MeetingNotes;
  transcript: string;
  generator: string;
  updatedAt: string;
}): MeetingNote {
  const { meetingId, title, dateISO, notes, transcript, generator, updatedAt } = opts;
  return {
    meetingId,
    summary: notes.summary,
    decisions: notes.decisions,
    questions: notes.questions,
    markdown: notesToMarkdown(title, dateISO, notes, transcript),
    generator,
    wordCount: notes.wordCount,
    updatedAt,
  };
}

/** The raw fields for inserting ActionItem rows for a meeting's action items.
 *  ids/timestamps are assigned by the database, so they are omitted here. */
export interface NewActionItem {
  title: string;
  meetingId: string;
}

export function actionItemsFromNotes(meetingId: string, notes: MeetingNotes): NewActionItem[] {
  return notes.actionItems.map((title) => ({ title, meetingId }));
}
