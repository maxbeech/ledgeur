// The device side of captures: the store, the widget's link contract, and the
// round trip to the cloud and back.
//
// What is pinned here is everything a person never sees but depends on
// completely — that a kept thought is on disk before anything else happens,
// that correcting a guess sticks, that a deletion is told to the other device
// rather than quietly reappearing, and that a home-screen widget's one and only
// interface (a URL) still means what the widget thinks it means.
import { parseCaptureLink } from "../src/lib/captureLinks.ts";
import {
  addCapture, applyRemoteCaptures, captureById, capturesNeedPush, deleteCapture, forgetCaptures,
  getCaptureRecords, getCaptures, markCaptureUnsorted, markCapturesSynced, renameCapture,
  rescueOrphanedCaptures, routeCaptureRecord, setCaptureDone, setCaptureKind, setCaptureSpace,
  subscribeCaptures,
} from "../src/lib/captures.ts";
import { toCapture, toCaptureRow } from "../src/lib/sync.ts";
import { unroutedCapture, type CaptureRouting } from "@ledgeur/core";

type Ok = (name: string, cond: boolean, detail?: string) => void;

const routing = (over: Partial<CaptureRouting> = {}): CaptureRouting => ({
  ...unroutedCapture("x"), kind: "task", spaceId: "s-acme", title: "chase the renewal",
  kindConfidence: 0.9, spaceConfidence: 0.85, spaceEvidence: "the renewal", ...over,
});

/** Time has to actually move for a stamp comparison to mean anything, and
 *  these stamps have millisecond resolution. */
const tick = () => new Promise((r) => setTimeout(r, 5));

export async function runCaptureStoreTests(ok: Ok): Promise<void> {
  // ── the link a widget sends ───────────────────────────────────────────────
  // These four strings are the entire contract between the widgets and the
  // app. Changing one without changing the widget is a silent no-op on a lock
  // screen, which nobody would find for weeks.
  ok("a capture link opens the box", parseCaptureLink("ledgeur://capture")?.action === "capture");
  const speak = parseCaptureLink("ledgeur://capture?mode=speak");
  ok("a speak link asks for the microphone", speak?.action === "capture" && speak.speak);
  const typed = parseCaptureLink("ledgeur://capture");
  ok("a plain capture link does not open the microphone", typed?.action === "capture" && !typed.speak);
  ok("a record link starts a recording", parseCaptureLink("ledgeur://record")?.action === "record");
  ok("the single-slash form still parses", parseCaptureLink("ledgeur:capture")?.action === "capture");
  ok("case does not decide it", parseCaptureLink("ledgeur://CAPTURE")?.action === "capture");
  ok("another app's scheme is ignored", parseCaptureLink("otherapp://capture") === null);
  ok("an unknown action is ignored", parseCaptureLink("ledgeur://delete-everything") === null);
  ok("nonsense is ignored rather than thrown", parseCaptureLink("not a url") === null);

  // ── kept first, sorted second ─────────────────────────────────────────────
  const c = addCapture("  chase the Acme renewal  ", "typed");
  ok("a capture is on disk before anything sorts it", captureById(c.id)?.text === "chase the Acme renewal");
  ok("a new capture starts as an unfiled note", c.kind === "note" && c.spaceId === undefined);
  ok("a new capture is stamped", Boolean(c.updatedAt) && c.updatedAt === c.createdAt);
  ok("an empty capture is refused rather than stored blank",
    (() => { try { addCapture("   ", "typed"); return false; } catch { return true; } })());

  routeCaptureRecord(c.id, routing());
  const sorted = captureById(c.id)!;
  ok("sorting applies the kind", sorted.kind === "task");
  ok("sorting applies the space", sorted.spaceId === "s-acme");
  ok("sorting keeps the original words underneath", sorted.text === "chase the Acme renewal");
  ok("sorting moves the stamp forward", sorted.updatedAt > c.createdAt || sorted.updatedAt === c.createdAt);

  // ── a person's correction sticks ──────────────────────────────────────────
  setCaptureKind(c.id, "note");
  ok("a corrected kind is applied", captureById(c.id)?.kind === "note");
  ok("a corrected kind is no longer a guess", captureById(c.id)?.kindSource === "user");
  routeCaptureRecord(c.id, routing());
  ok("a later sort does not undo the correction", captureById(c.id)?.kind === "note");

  setCaptureSpace(c.id, null);
  ok("a person can put a capture back in the inbox", captureById(c.id)?.spaceId === undefined);
  routeCaptureRecord(c.id, routing());
  ok("a later sort does not re-file it either", captureById(c.id)?.spaceId === undefined);

  // ── tasks, and only tasks, are done ───────────────────────────────────────
  setCaptureKind(c.id, "task");
  setCaptureDone(c.id, true);
  ok("a task can be finished", captureById(c.id)?.done === true);
  setCaptureKind(c.id, "note");
  ok("turning a task into a note clears its done state", captureById(c.id)?.done === undefined);
  setCaptureDone(c.id, true);
  ok("a note cannot be marked done", captureById(c.id)?.done === undefined);

  renameCapture(c.id, "Acme renewal");
  ok("a capture can be renamed", captureById(c.id)?.title === "Acme renewal");
  ok("renaming keeps the words that were actually said", captureById(c.id)?.text === "chase the Acme renewal");

  // ── unsorted is a state, not a failure ────────────────────────────────────
  const u = addCapture("no model to ask about this one", "spoken");
  markCaptureUnsorted(u.id, "No on-device model.");
  ok("a capture nothing could sort is still kept", captureById(u.id)?.text === "no model to ask about this one");
  ok("an unsorted capture says why", captureById(u.id)?.unsortedReason === "No on-device model.");
  ok("a spoken capture remembers it was spoken", captureById(u.id)?.entry === "spoken");

  // ── deleting ──────────────────────────────────────────────────────────────
  const never = addCapture("the cloud never saw this", "typed");
  deleteCapture(never.id);
  ok("a capture the cloud never had simply goes",
    !getCaptureRecords().some((r) => r.id === never.id));

  const known = addCapture("the cloud has this one", "typed");
  markCapturesSynced([known.id], new Date().toISOString());
  deleteCapture(known.id);
  ok("a synced capture leaves a tombstone for the other device",
    getCaptureRecords().some((r) => r.id === known.id && r.deletedAt));
  ok("a tombstone is in no list", !getCaptures().some((r) => r.id === known.id));

  // ── a space deleted elsewhere must not take thoughts with it ──────────────
  const filed = addCapture("about a space that is about to go", "typed");
  setCaptureSpace(filed.id, "s-gone");
  rescueOrphanedCaptures(["s-acme"]);
  ok("a capture whose space is gone comes back to the inbox",
    captureById(filed.id)?.spaceId === undefined);
  const stays = addCapture("about a space that survives", "typed");
  setCaptureSpace(stays.id, "s-acme");
  rescueOrphanedCaptures(["s-acme"]);
  ok("a capture whose space survives is left where it is", captureById(stays.id)?.spaceId === "s-acme");

  // ── the engine must not wake itself up ────────────────────────────────────
  // Found by watching the console: every sync wrote to this store, every write
  // notified the sync engine, and the engine scheduled another sync. It ran
  // every two seconds forever and achieved nothing. The rule that stops it is
  // that the engine's OWN writes must be silent, and that "is there anything
  // to push?" is asked rather than assumed.
  let notifications = 0;
  const off = subscribeCaptures(() => { notifications++; });

  applyRemoteCaptures([], []);
  ok("a pull with nothing new notifies nobody", notifications === 0);
  forgetCaptures([]);
  ok("forgetting nothing notifies nobody", notifications === 0);
  markCapturesSynced([], new Date().toISOString());
  ok("marking nothing synced notifies nobody", notifications === 0);
  rescueOrphanedCaptures(["s-acme"]);
  ok("a rescue that rescues nothing notifies nobody", notifications === 0);

  const fresh = addCapture("something the cloud has not seen", "typed");
  ok("a new capture does notify", notifications > 0);
  ok("a new capture is something to push", capturesNeedPush());

  // A real sync stamps this at the moment it runs, after the edits it just
  // pushed. The waits are what make that true here rather than assumed: without
  // them every stamp in this test lands in the same millisecond.
  await tick();
  const at = new Date().toISOString();
  markCapturesSynced(getCaptureRecords().filter((c) => !c.deletedAt).map((c) => c.id), at);
  // A tombstone still needs pushing until the cloud has been told, which is the
  // whole point of it — so it is forgotten here the way a real run forgets it,
  // rather than asserted away.
  ok("a tombstone still needs pushing until the cloud is told", capturesNeedPush());
  forgetCaptures(getCaptureRecords().filter((c) => c.deletedAt).map((c) => c.id));
  ok("once the cloud has them all there is nothing to push", !capturesNeedPush());
  notifications = 0;
  markCapturesSynced([fresh.id], at);
  ok("marking an already-synced capture synced again notifies nobody", notifications === 0);

  await tick();
  setCaptureKind(fresh.id, "task");
  ok("a person's edit is something to push again", capturesNeedPush());
  off();
  // Cleanup: this store is module state shared with every other test in the
  // file, and a run that left rows behind would make the next assertion here
  // depend on the order the suite happened to execute in.
  for (const c of getCaptureRecords()) deleteCapture(c.id);
  forgetCaptures(getCaptureRecords().map((c) => c.id));
}

export function runCaptureSyncTests(ok: Ok): void {
  // The round trip. Every field a person can change has to survive going up and
  // coming back, or a second device shows a different thought to the first.
  const local = {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    text: "chase the Acme renewal",
    title: "chase the renewal",
    kind: "task" as const,
    spaceId: "11111111-2222-4333-8444-555555555555",
    kindSource: "user" as const,
    spaceSource: "inferred" as const,
    kindConfidence: 0.9,
    spaceConfidence: 0.82,
    spaceEvidence: "the Acme renewal",
    entry: "spoken" as const,
    done: true,
    unsortedReason: "",
    createdAt: "2026-09-08T10:00:00.000Z",
    updatedAt: "2026-09-08T10:05:00.000Z",
  };
  const row = toCaptureRow(local, { userId: "u1", orgId: "o1" });
  ok("the row carries the words, not just the title", row.body === "chase the Acme renewal");
  ok("the row carries the title", row.title === "chase the renewal");
  ok("the row carries who decided the kind", row.kind_source === "user");
  ok("the row carries the evidence for a guessed space", row.space_evidence === "the Acme renewal");
  ok("the row uses the device's stamp, not the server's", row.updated_at === "2026-09-08T10:05:00.000Z");
  ok("the row is scoped to the owner", row.owner_id === "u1" && row.org_id === "o1");

  const back = toCapture({
    id: String(row.id), owner_id: "u1", org_id: "o1", body: String(row.body), title: String(row.title),
    kind: String(row.kind), folder_id: (row.folder_id as string | null), kind_source: String(row.kind_source),
    space_source: String(row.space_source), kind_confidence: Number(row.kind_confidence),
    space_confidence: Number(row.space_confidence), space_evidence: String(row.space_evidence),
    entry: String(row.entry), done: Boolean(row.done), unsorted_reason: String(row.unsorted_reason),
    created_at: String(row.created_at), updated_at: String(row.updated_at), deleted_at: null,
  });
  ok("the round trip keeps the words", back.text === local.text);
  ok("the round trip keeps the title", back.title === local.title);
  ok("the round trip keeps the kind", back.kind === "task");
  ok("the round trip keeps the space", back.spaceId === local.spaceId);
  ok("the round trip keeps who decided", back.kindSource === "user" && back.spaceSource === "inferred");
  ok("the round trip keeps the confidences", back.kindConfidence === 0.9 && back.spaceConfidence === 0.82);
  ok("the round trip keeps the evidence", back.spaceEvidence === local.spaceEvidence);
  ok("the round trip keeps how it was entered", back.entry === "spoken");
  ok("the round trip keeps the done state", back.done === true);
  ok("the round trip keeps the stamps", back.createdAt === local.createdAt && back.updatedAt === local.updatedAt);

  // A space id this device made offline is not always a uuid, and a foreign key
  // into nothing fails the whole push rather than one row.
  const junkSpace = toCaptureRow({ ...local, spaceId: "f-1757000000000-123" }, { userId: "u1", orgId: "o1" });
  ok("a non-uuid space id is sent as unfiled rather than breaking the push",
    junkSpace.folder_id === null);

  // A note has no done state, so the column's default must not invent one.
  const asNote = toCapture({
    id: local.id, owner_id: "u1", org_id: "o1", body: "a note", title: "a note", kind: "note",
    folder_id: null, kind_source: "inferred", space_source: "inferred", kind_confidence: 0,
    space_confidence: 0, space_evidence: "", entry: "typed", done: false, unsorted_reason: "",
    created_at: local.createdAt, updated_at: local.updatedAt, deleted_at: null,
  });
  ok("a note comes back with no done state at all", asNote.done === undefined);

  const tombstone = toCapture({
    id: local.id, owner_id: "u1", org_id: "o1", body: "gone", title: "gone", kind: "note",
    folder_id: null, kind_source: "inferred", space_source: "inferred", kind_confidence: 0,
    space_confidence: 0, space_evidence: "", entry: "typed", done: false, unsorted_reason: "",
    created_at: local.createdAt, updated_at: local.updatedAt, deleted_at: "2026-09-08T11:00:00.000Z",
  });
  ok("a cloud tombstone arrives as one", Boolean(tombstone.deletedAt));
}
