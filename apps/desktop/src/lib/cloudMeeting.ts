// Load/delete a meeting from the cloud and map it into the LocalMeeting shape the
// meeting view already renders — so workspace meetings open on any device without
// a separate UI. Returns null if not signed in or not found.

import { getMeeting as getCloud } from "@parleynotes/core";
import { getSupabase } from "./supabase.ts";
import type { LocalMeeting, LocalSegment } from "./meetingsStore.ts";

export async function getCloudMeeting(id: string): Promise<LocalMeeting | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;

  const full = await getCloud(sb, id);
  if (!full) return null;

  const bySpeaker = new Map(full.speakers.map((s) => [s.id, s]));
  const segments: LocalSegment[] = full.segments.map((s) => {
    const spk = s.speakerId ? bySpeaker.get(s.speakerId) : undefined;
    return {
      id: s.id,
      speakerLabel: spk?.identifiedName || spk?.label || "Speaker 1",
      speakerConfidence: spk?.identityConfidence ?? null,
      startMs: s.startMs, endMs: s.endMs, text: s.text, confidence: s.confidence,
    };
  });

  // Action items for this meeting (cloud rows), if any.
  const { data: items } = await sb.from("action_items").select("title").eq("meeting_id", id);
  const actionItems = (items ?? []).map((r: { title: string }) => r.title);

  const note = full.note;
  return {
    id: full.meeting.id,
    title: full.meeting.title,
    createdAt: full.meeting.createdAt,
    startedAt: full.meeting.startedAt,
    endedAt: full.meeting.endedAt,
    status: "complete",
    lang: full.meeting.lang,
    segments,
    summary: note?.summary ?? [],
    decisions: note?.decisions ?? [],
    questions: note?.questions ?? [],
    actionItems,
    noteMarkdown: note?.markdown ?? "",
    wordCount: note?.wordCount ?? 0,
    synced: true,
  };
}

export async function deleteCloudMeeting(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");
  const { error } = await sb.from("meetings").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
