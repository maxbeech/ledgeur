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
/** One person across every meeting the caller can see. */
export interface DirectoryEntry {
  /** The name they are known by — an identified name where there is one, else
   *  the speaker label from the transcript. */
  name: string;
  /** True when the name came from voice identification rather than a label. */
  identified: boolean;
  meetingCount: number;
  meetings: { id: string; title: string; createdAt: string }[];
}

/**
 * Who appears across the caller's meetings, aggregated.
 *
 * Named speakers only. A bare "Speaker 2" is an unnamed voice, not a person,
 * and listing them would fill any consumer's directory with numbered strangers
 * who are mostly the same handful of people nobody has named yet.
 *
 * One query with an embedded meeting rather than N+1: a directory is read
 * whole, and the alternative is a round trip per speaker.
 */
export async function listPeople(db: SupabaseClient, limit = 200): Promise<DirectoryEntry[]> {
  const rows = unwrap(
    await db
      .from("speakers")
      .select("*, meetings(id, title, created_at)")
      .limit(limit),
  ) as (SpeakerRow & { meetings: { id: string; title: string; created_at: string } | null })[];

  const unnamed = /^speaker\s*\d+$/i;
  const byName = new Map<string, DirectoryEntry>();
  for (const r of rows) {
    const name = (r.identified_name ?? r.label ?? "").trim();
    if (!name || unnamed.test(name)) continue;
    const entry = byName.get(name) ?? {
      name, identified: Boolean(r.identified_name), meetingCount: 0, meetings: [],
    };
    entry.identified = entry.identified || Boolean(r.identified_name);
    entry.meetingCount++;
    if (r.meetings) {
      entry.meetings.push({ id: r.meetings.id, title: r.meetings.title, createdAt: r.meetings.created_at });
    }
    byName.set(name, entry);
  }
  return [...byName.values()]
    .map((e) => ({ ...e, meetings: e.meetings.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) }))
    .sort((a, b) => b.meetingCount - a.meetingCount);
}

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

export interface ActionItemWithMeeting extends ActionItem {
  meetingTitle: string;
}

/** Action items joined with their meeting's title — powers the Tasks screen
 *  cross-device (RLS scopes rows to what the caller can see). */
export async function listActionItemsWithMeeting(
  db: SupabaseClient,
  limit = 200,
): Promise<ActionItemWithMeeting[]> {
  const rows = unwrap(
    await db
      .from("action_items")
      .select("*, meetings(title)")
      .order("created_at", { ascending: false })
      .limit(limit),
  ) as (ActionItemRow & { meetings: { title: string } | null })[];
  return rows.map((r) => ({ ...toActionItem(r), meetingTitle: r.meetings?.title ?? "Untitled meeting" }));
}

/** Flip a task between open/done. RLS restricts writes to permitted rows. */
export async function setActionItemStatus(
  db: SupabaseClient,
  id: string,
  status: ActionItem["status"],
): Promise<void> {
  const { error } = await db.from("action_items").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
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
