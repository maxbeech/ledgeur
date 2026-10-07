// Database rows to the public API shapes. Pure, so the shapes are unit-tested
// without a database.

import type {
  ApiMeeting, ApiActionItem, ApiMeetingMetadata, ApiMeetingNotes, ApiMeetingStatus, ApiMeetingSummary,
  ApiParticipant, ApiTranscript, ApiTranscriptSegment,
} from "./contract.ts";

export const API_MEETING_URL_BASE = "https://www.ledgeur.com/app/meetings";

export interface ApiMeetingRow {
  id: string;
  title: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  lang: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ApiSpeakerRow {
  id: string;
  label: string;
  identified_name: string | null;
  identity_confidence: number | null;
}

export interface ApiSegmentRow {
  id: string;
  speaker_id: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number | null;
}

export interface ApiNoteRow {
  summary: string[] | null;
  decisions: string[] | null;
  questions: string[] | null;
  markdown: string | null;
  word_count: number | null;
}

export interface ApiActionItemRow {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  assignee?: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
}

/** PostgreSQL timestamptz text to ISO 8601 with milliseconds. */
export function iso(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function durationMs(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null;
  const d = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

const STATUSES: readonly string[] = ["scheduled", "recording", "processing", "complete", "failed"];

export function toApiSummary(m: ApiMeetingRow): ApiMeetingSummary {
  return {
    id: m.id,
    title: m.title,
    status: (STATUSES.includes(m.status) ? m.status : "failed") as ApiMeetingStatus,
    started_at: iso(m.started_at),
    ended_at: iso(m.ended_at),
    duration_ms: durationMs(m.started_at, m.ended_at),
    lang: m.lang,
    updated_at: iso(m.updated_at) ?? m.updated_at,
    deleted_at: iso(m.deleted_at),
    url: `${API_MEETING_URL_BASE}/${m.id}`,
  };
}

export function toApiMeeting(
  m: ApiMeetingRow,
  notes: ApiMeetingNotes | null,
  actionItems: ApiActionItem[],
  participants: ApiParticipant[],
): ApiMeeting {
  return { ...toApiSummary(m), notes, action_items: actionItems, participants };
}

export function toApiParticipant(s: ApiSpeakerRow): ApiParticipant {
  return {
    id: s.id,
    label: s.label,
    name: s.identified_name,
    identity_confidence: s.identity_confidence,
  };
}

export function toApiNotes(n: ApiNoteRow | null): ApiMeetingNotes | null {
  if (!n) return null;
  return {
    summary: n.summary ?? [],
    decisions: n.decisions ?? [],
    questions: n.questions ?? [],
    markdown: n.markdown ? n.markdown : null,
  };
}

/** Cancelled items are not part of the record a consumer cares about. */
export function toApiActionItems(rows: ApiActionItemRow[]): ApiActionItem[] {
  return rows
    .filter((r) => r.status !== "cancelled")
    .map((r) => {
      const a = Array.isArray(r.assignee) ? r.assignee[0] : r.assignee;
      return {
        id: r.id,
        text: r.title,
        owner: a ? a.full_name || a.email || null : null,
        done: r.status === "done",
        due: r.due_date,
      };
    });
}

export function speakerName(s: ApiSpeakerRow | undefined): string {
  return s ? s.identified_name || s.label : "Speaker";
}

export function toApiTranscript(
  meetingId: string,
  segments: ApiSegmentRow[],
  speakers: ApiSpeakerRow[],
): ApiTranscript {
  const bySpeaker = new Map(speakers.map((s) => [s.id, s]));
  const out: ApiTranscriptSegment[] = segments.map((g) => ({
    id: g.id,
    speaker_id: g.speaker_id,
    speaker: speakerName(g.speaker_id ? bySpeaker.get(g.speaker_id) : undefined),
    start_ms: g.start_ms,
    end_ms: g.end_ms,
    text: g.text,
    confidence: g.confidence,
  }));
  return { meeting_id: meetingId, segments: out, text: out.map((s) => `${s.speaker}: ${s.text}`).join("\n") };
}

export function toApiMetadata(
  m: ApiMeetingRow,
  wordCount: number | null,
  speakerCount: number,
  calendar: { title: string; starts_at: string; ends_at: string } | null,
): ApiMeetingMetadata {
  const s = toApiSummary(m);
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    started_at: s.started_at,
    ended_at: s.ended_at,
    duration_ms: s.duration_ms,
    lang: s.lang,
    word_count: wordCount,
    speaker_count: speakerCount,
    calendar_event: calendar
      ? { title: calendar.title, starts_at: iso(calendar.starts_at) ?? calendar.starts_at, ends_at: iso(calendar.ends_at) ?? calendar.ends_at }
      : null,
    updated_at: s.updated_at,
  };
}

/** Whitespace-separated words, for imported transcripts. */
export function countWords(texts: string[]): number {
  let n = 0;
  for (const t of texts) {
    const m = t.trim().match(/\S+/g);
    if (m) n += m.length;
  }
  return n;
}

// --- list cursor -------------------------------------------------------------

export interface ListCursor {
  /** updated_at of the last row returned, as the database printed it. */
  u: string;
  /** id of the last row, to break ties between equal timestamps. */
  i: string;
  /** Whether soft-deleted meetings are part of this listing. */
  d: boolean;
}

const b64 = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

export function encodeCursor(c: ListCursor): string {
  return b64(JSON.stringify(c));
}

export function decodeCursor(raw: string): ListCursor | null {
  try {
    const c = JSON.parse(unb64(raw)) as Partial<ListCursor>;
    if (typeof c.u === "string" && typeof c.i === "string" && typeof c.d === "boolean" && !Number.isNaN(Date.parse(c.u))) {
      return { u: c.u, i: c.i, d: c.d };
    }
  } catch { /* fall through */ }
  return null;
}
