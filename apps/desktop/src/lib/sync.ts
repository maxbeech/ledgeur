// Sync between the local IndexedDB cache and Supabase (cloud is the source of
// truth). Pull recent meetings for the signed-in user; push a locally-recorded
// meeting (its notes, transcript and action items) up to the org.

import { listMeetings as remoteList } from "@parleynotes/core";
import type { Meeting } from "@parleynotes/core";
import { getSupabase } from "./supabase.ts";
import type { LocalMeeting } from "./meetingsStore.ts";
import { saveMeeting } from "./meetingsStore.ts";

/** Meetings visible to the signed-in user (own + org-shared, via RLS). */
export async function pullMeetings(): Promise<Meeting[]> {
  const sb = getSupabase();
  if (!sb) return [];
  return remoteList(sb, 100);
}

/** Push a completed local meeting to Supabase. Requires an org + auth session.
 *  `visibility` controls whether it joins the org hive mind. Marks the local copy
 *  synced on success. Returns the remote meeting id. */
export async function pushMeeting(
  orgId: string,
  ownerId: string,
  m: LocalMeeting,
  visibility: "private" | "org" = "private",
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Backend not configured — cannot sync.");

  const { data: meeting, error: mErr } = await sb
    .from("meetings")
    .insert({
      org_id: orgId, owner_id: ownerId, title: m.title, status: "complete", visibility,
      started_at: m.startedAt, ended_at: m.endedAt, lang: m.lang,
    })
    .select("id")
    .single();
  if (mErr) throw new Error(mErr.message);
  const meetingId = (meeting as { id: string }).id;

  if (m.segments.length) {
    // Create speaker rows first so who-said-what (and identity confidence)
    // survives the trip to the cloud and back to other devices.
    const labels = [...new Set(m.segments.map((s) => s.speakerLabel))];
    const speakerIdByLabel = new Map<string, string>();
    if (labels.length) {
      const { data: speakerRows, error: sErr } = await sb
        .from("speakers")
        .insert(labels.map((label) => {
          const identified = !/^Speaker \d+$/i.test(label);
          const conf = m.segments.find((s) => s.speakerLabel === label && s.speakerConfidence != null)?.speakerConfidence ?? null;
          return {
            meeting_id: meetingId, label,
            identified_name: identified ? label : null,
            identity_confidence: identified ? conf : null,
          };
        }))
        .select("id, label");
      if (sErr) throw new Error(sErr.message);
      for (const r of (speakerRows ?? []) as { id: string; label: string }[]) speakerIdByLabel.set(r.label, r.id);
    }

    const { error } = await sb.from("transcript_segments").insert(
      m.segments.map((s) => ({
        meeting_id: meetingId, speaker_id: speakerIdByLabel.get(s.speakerLabel) ?? null,
        start_ms: s.startMs, end_ms: s.endMs, text: s.text, confidence: s.confidence,
      })),
    );
    if (error) throw new Error(error.message);
  }

  const { error: nErr } = await sb.from("meeting_notes").insert({
    meeting_id: meetingId, summary: m.summary, decisions: m.decisions, questions: m.questions,
    markdown: m.noteMarkdown, generator: "local", word_count: m.wordCount,
  });
  if (nErr) throw new Error(nErr.message);

  if (m.actionItems.length) {
    const { error } = await sb.from("action_items").insert(
      m.actionItems.map((title) => ({ org_id: orgId, meeting_id: meetingId, title })),
    );
    if (error) throw new Error(error.message);
  }

  await saveMeeting({ ...m, synced: true });
  return meetingId;
}
