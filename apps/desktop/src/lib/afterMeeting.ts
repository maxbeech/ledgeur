// After a meeting is recorded locally: fire the outbound webhook, sync it to
// the account, index it for RAG, and optionally auto-save to Notion. Failures
// are logged, never fatal — the local copy is always saved first.

import { getMeeting } from "./meetingsStore.ts";
import { deliverMeeting } from "./webhooks.ts";
import { syncNow, currentOrgId, isSynced } from "./sync.ts";
import { indexMeeting } from "./embeddings.ts";
import { saveMeetingToNotion } from "./notion.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("after-meeting");

const AUTOSAVE_KEY = "ledgeur.notion.autosave";
export const notionAutoSaveEnabled = (): boolean => localStorage.getItem(AUTOSAVE_KEY) === "1";
export const setNotionAutoSave = (v: boolean): void => localStorage.setItem(AUTOSAVE_KEY, v ? "1" : "0");

export async function finalizeMeeting(localId: string): Promise<void> {
  const m = await getMeeting(localId);
  if (!m) return;

  // The webhook is a local feature and runs first: it must not depend on being
  // signed in, and it is the one step whose whole point is that another system
  // hears about the meeting promptly.
  await deliverMeeting(m).catch((e) => log.error("webhook delivery threw", e));

  // The engine pushes this meeting (and anything else waiting) under the same
  // id it has here, so the phone sees it under that id too.
  const status = await syncNow("meeting-finished");
  if (status.phase === "signed-out") return;
  const orgId = currentOrgId();
  if (!orgId || !(await isSynced(localId))) return;

  // RAG indexing needs the local model; don't block the flow if it's off.
  await indexMeeting(orgId, localId, {
    title: m.title, summary: m.summary, transcript: m.segments.map((s) => s.text).join(" "),
  }).catch((e) => log.error("indexMeeting failed", e));
  if (notionAutoSaveEnabled()) {
    await saveMeetingToNotion(m.title, m.noteMarkdown).catch((e) => log.error("notion autosave failed", e));
  }
}
