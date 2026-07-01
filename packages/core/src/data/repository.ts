// Shared data-access layer over Supabase. RLS enforces visibility, so these
// queries return exactly what the authenticated user/org is allowed to see —
// the same code powers the app's sync and the paid MCP server.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Meeting, MeetingNote, ActionItem, Speaker, TranscriptSegment } from "../domain/entities.ts";
import {
  toMeeting, toNote, toActionItem, toSpeaker, toSegment,
  type MeetingRow, type NoteRow, type ActionItemRow, type SpeakerRow, type SegmentRow,
} from "./rows.ts";

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** Most recent meetings the caller can see. */
export async function listMeetings(db: SupabaseClient, limit = 50): Promise<Meeting[]> {
  const rows = unwrap(await db.from("meetings").select("*").order("created_at", { ascending: false }).limit(limit));
  return (rows as MeetingRow[]).map(toMeeting);
}

export interface MeetingSummary {
  meeting: Meeting;
  wordCount: number;
  actionItemCount: number;
}

/** Meetings with lightweight counts for list views (single round-trip via
 *  PostgREST embedding). Used by the app to show workspace meetings from any device. */
export async function listMeetingSummaries(db: SupabaseClient, limit = 50): Promise<MeetingSummary[]> {
  const rows = unwrap(
    await db
      .from("meetings")
      .select("*, meeting_notes(word_count), action_items(id)")
      .order("created_at", { ascending: false })
      .limit(limit),
  ) as (MeetingRow & { meeting_notes: { word_count: number }[]; action_items: { id: string }[] })[];
  return rows.map((r) => ({
    meeting: toMeeting(r),
    wordCount: r.meeting_notes?.[0]?.word_count ?? 0,
    actionItemCount: r.action_items?.length ?? 0,
  }));
}

export interface FullMeeting {
  meeting: Meeting;
  note: MeetingNote | null;
  speakers: Speaker[];
  segments: TranscriptSegment[];
}

/** A meeting with its notes, speakers and transcript (visibility-checked by RLS). */
export async function getMeeting(db: SupabaseClient, id: string): Promise<FullMeeting | null> {
  const m = unwrap(await db.from("meetings").select("*").eq("id", id).maybeSingle()) as MeetingRow | null;
  if (!m) return null;
  const [noteRes, spkRes, segRes] = await Promise.all([
    db.from("meeting_notes").select("*").eq("meeting_id", id).maybeSingle(),
    db.from("speakers").select("*").eq("meeting_id", id),
    db.from("transcript_segments").select("*").eq("meeting_id", id).order("start_ms", { ascending: true }),
  ]);
  return {
    meeting: toMeeting(m),
    note: noteRes.data ? toNote(noteRes.data as NoteRow) : null,
    speakers: ((spkRes.data ?? []) as SpeakerRow[]).map(toSpeaker),
    segments: ((segRes.data ?? []) as SegmentRow[]).map(toSegment),
  };
}

/** Keyword search over meeting titles and note summaries the caller can see.
 *  (Vector RAG via match_embeddings is layered on once embeddings are populated.) */
export async function searchMeetings(db: SupabaseClient, query: string, limit = 20): Promise<Meeting[]> {
  const q = query.trim();
  if (!q) return listMeetings(db, limit);
  const rows = unwrap(
    await db.from("meetings").select("*").ilike("title", `%${q}%`).order("created_at", { ascending: false }).limit(limit),
  );
  return (rows as MeetingRow[]).map(toMeeting);
}

/** Action items (tasks), optionally filtered by status. */
export async function listActionItems(
  db: SupabaseClient,
  opts: { status?: ActionItem["status"]; limit?: number } = {},
): Promise<ActionItem[]> {
  let q = db.from("action_items").select("*").order("created_at", { ascending: false }).limit(opts.limit ?? 100);
  if (opts.status) q = q.eq("status", opts.status);
  return ((unwrap(await q)) as ActionItemRow[]).map(toActionItem);
}

/** Semantic search via the RLS-aware RPC. `queryEmbedding` must match the schema
 *  vector dimension (768). Returns matched chunks with similarity scores. */
export async function semanticSearch(
  db: SupabaseClient,
  orgId: string,
  queryEmbedding: number[],
  matchCount = 8,
): Promise<{ content: string; meetingId: string | null; similarity: number }[]> {
  const rows = unwrap(
    await db.rpc("match_embeddings", { p_org: orgId, query: queryEmbedding, match_count: matchCount }),
  ) as { content: string; meeting_id: string | null; similarity: number }[];
  return rows.map((r) => ({ content: r.content, meetingId: r.meeting_id, similarity: r.similarity }));
}
