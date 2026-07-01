// After a meeting is recorded locally, best-effort push it to the cloud (source
// of truth), index it for RAG, and optionally auto-save to Notion. Failures are
// logged, never fatal — the local copy is always saved first.

import { getMeeting } from "./meetingsStore.ts";
import { getSupabase } from "./supabase.ts";
import { pushMeeting } from "./sync.ts";
import { indexMeeting } from "./embeddings.ts";
import { saveMeetingToNotion } from "./notion.ts";

const AUTOSAVE_KEY = "parleynotes.notion.autosave";
export const notionAutoSaveEnabled = (): boolean => localStorage.getItem(AUTOSAVE_KEY) === "1";
export const setNotionAutoSave = (v: boolean): void => localStorage.setItem(AUTOSAVE_KEY, v ? "1" : "0");

export async function finalizeMeeting(localId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return; // local-only mode — nothing to sync
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;

  const m = await getMeeting(localId);
  if (!m) return;
  // The org's admin-set default decides whether new meetings join the hive mind.
  const { data: org } = await sb.from("orgs").select("id, default_meeting_visibility").limit(1).maybeSingle();
  if (!org) return;
  const visibility = org.default_meeting_visibility === "org" ? "org" : "private";

  try {
    const remoteId = await pushMeeting(org.id, session.user.id, m, visibility);
    // RAG indexing needs the local model; don't block the flow if it's off.
    await indexMeeting(org.id, remoteId, {
      title: m.title, summary: m.summary, transcript: m.segments.map((s) => s.text).join(" "),
    }).catch((e) => console.error("indexMeeting:", e));
    if (notionAutoSaveEnabled()) {
      await saveMeetingToNotion(m.title, m.noteMarkdown).catch((e) => console.error("notion autosave:", e));
    }
  } catch (e) {
    console.error("finalizeMeeting sync failed:", e);
  }
}
