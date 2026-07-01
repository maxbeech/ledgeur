// Database row shapes (snake_case, as returned by Supabase) and mappers to the
// camelCase domain entities. Keeping mapping in one place means the app and the
// MCP server read the database identically.

import type { Meeting, MeetingNote, ActionItem, Speaker, TranscriptSegment } from "../domain/entities.ts";

export interface MeetingRow {
  id: string; org_id: string; owner_id: string; title: string;
  status: Meeting["status"]; visibility: Meeting["visibility"];
  calendar_event_id: string | null; started_at: string | null; ended_at: string | null;
  lang: string; created_at: string;
}
export const toMeeting = (r: MeetingRow): Meeting => ({
  id: r.id, orgId: r.org_id, ownerId: r.owner_id, title: r.title, status: r.status,
  visibility: r.visibility, calendarEventId: r.calendar_event_id, startedAt: r.started_at,
  endedAt: r.ended_at, lang: r.lang, createdAt: r.created_at,
});

export interface NoteRow {
  meeting_id: string; summary: string[]; decisions: string[]; questions: string[];
  markdown: string; generator: string; word_count: number; updated_at: string;
}
export const toNote = (r: NoteRow): MeetingNote => ({
  meetingId: r.meeting_id, summary: r.summary, decisions: r.decisions, questions: r.questions,
  markdown: r.markdown, generator: r.generator, wordCount: r.word_count, updatedAt: r.updated_at,
});

export interface ActionItemRow {
  id: string; org_id: string; meeting_id: string | null; title: string;
  status: ActionItem["status"]; assignee_id: string | null; due_date: string | null; created_at: string;
}
export const toActionItem = (r: ActionItemRow): ActionItem => ({
  id: r.id, orgId: r.org_id, meetingId: r.meeting_id, title: r.title, status: r.status,
  assigneeId: r.assignee_id, dueDate: r.due_date, createdAt: r.created_at,
});

export interface SpeakerRow {
  id: string; meeting_id: string; label: string; identified_profile_id: string | null;
  identified_name: string | null; identity_confidence: number | null;
}
export const toSpeaker = (r: SpeakerRow): Speaker => ({
  id: r.id, meetingId: r.meeting_id, label: r.label, identifiedProfileId: r.identified_profile_id,
  identifiedName: r.identified_name, identityConfidence: r.identity_confidence,
});

export interface SegmentRow {
  id: string; meeting_id: string; speaker_id: string | null;
  start_ms: number; end_ms: number; text: string; confidence: number | null;
}
export const toSegment = (r: SegmentRow): TranscriptSegment => ({
  id: r.id, meetingId: r.meeting_id, speakerId: r.speaker_id, startMs: r.start_ms,
  endMs: r.end_ms, text: r.text, confidence: r.confidence,
});
