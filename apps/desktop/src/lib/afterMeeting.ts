// After a meeting is recorded locally: fire the outbound webhook, sync it to
// the account, index it for RAG, and optionally auto-save to Notion. Failures
// are logged, never fatal — the local copy is always saved first.

import { getMeeting, saveMeeting } from "./meetingsStore.ts";
import { deliverMeeting } from "./webhooks.ts";
import { pushMeetingTasks } from "./taskPush.ts";
import { syncNow, currentOrgId, isSynced } from "./sync.ts";
import { indexMeeting } from "./embeddings.ts";
import { saveMeetingToNotion } from "./notion.ts";
import { chooseMeetingSpace } from "./routeCapture.ts";
import { isPlaceholderLabel } from "@ledgeur/core";
import { createLogger } from "./logger.ts";

const log = createLogger("after-meeting");

/**
 * Put a finished meeting in the space it is about.
 *
 * Runs before the sync push below, so the filing travels with the meeting
 * rather than as a second edit a moment later.
 *
 * Three things it will not do: file a meeting somebody has already filed
 * themselves, invent a space, or file anything the model was not sure about.
 * A meeting in the library is where every meeting was before this existed;
 * a meeting in the wrong space is one its owner will not find.
 */
async function fileMeeting(localId: string): Promise<void> {
  const m = await getMeeting(localId);
  if (!m || m.folderId) return;
  const people = (m.speakers ?? [])
    .map((s) => s.label)
    .filter((label) => label && !isPlaceholderLabel(label));
  const filed = await chooseMeetingSpace({
    title: m.title,
    summary: m.summary,
    decisions: m.decisions,
    people,
  });
  if (!filed) return;
  // Re-read: the notes pass and a person renaming the meeting both write here,
  // and saving the copy from before the model call would undo them.
  const latest = await getMeeting(localId);
  if (!latest || latest.folderId) return;
  await saveMeeting({ ...latest, folderId: filed.spaceId });
  log.info("meeting filed automatically", {
    spaceId: filed.spaceId, confidence: filed.confidence,
  });
}

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

  // Same rules as the webhook: local, off by default, and never fatal. A task
  // manager being down must not affect a meeting that is already on disk.
  await pushMeetingTasks(m).catch((e) => log.error("pushing action items threw", e));

  // Filed before the push, so the space travels with the meeting instead of
  // arriving as a second edit. Never fatal: an unfiled meeting is a normal
  // meeting, and one that failed to sync would not be.
  await fileMeeting(localId).catch((e) => log.error("filing the meeting threw", e));

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
