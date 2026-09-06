// The device-side stores the sync engine drives: spaces and recipes.
//
// What is pinned here is the bookkeeping a person never sees but the other
// device depends on — every edit is stamped, a deletion leaves a tombstone
// until the cloud has it, and what the cloud sends back is written without
// being mistaken for a new edit.
import { createFolder, renameFolder, getFolders, getFolderRecords, applyRemoteFolders, forgetFolders, nextFolderTone, normaliseTone } from "../src/lib/folders.ts";
import { saveRecipe, deleteRecipe, getRecipes, getRecipeRecords, applyRemoteRecipes, forgetRecipes, templateFor } from "../src/lib/recipes.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;

export function runSyncStoreTests(ok: Ok): void {
  // ── spaces ────────────────────────────────────────────────────────────────
  const a = createFolder("Customers");
  ok("a new space is stamped", Boolean(a.updatedAt) && a.updatedAt === a.createdAt);
  ok("a new space takes a pastel family", ["sky", "rose", "mint", "butter", "peach", "iris"].includes(a.tone));
  ok("the second space takes the next family", createFolder("Hiring").tone !== a.tone);
  ok("duplicate names are refused", (() => { try { createFolder("customers"); return false; } catch { return true; } })());
  const before = a.updatedAt;
  renameFolder(a.id, "Key accounts");
  const renamed = getFolders().find((f) => f.id === a.id)!;
  ok("a rename keeps the id", renamed.name === "Key accounts");
  ok("a rename moves the stamp forward", renamed.updatedAt >= before);

  const remote = { id: "11111111-2222-4333-8444-555555555555", name: "Board", tone: "iris" as const, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  applyRemoteFolders([remote], []);
  ok("a space pulled from the cloud appears", getFolders().some((f) => f.id === remote.id && f.name === "Board"));
  ok("a pulled space keeps the cloud's stamp, not now", getFolderRecords().find((f) => f.id === remote.id)?.updatedAt === remote.updatedAt);
  applyRemoteFolders([], [remote.id]);
  ok("a cloud deletion removes the space here", !getFolders().some((f) => f.id === remote.id));

  const tomb = { ...remote, id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", deletedAt: "2026-09-02T00:00:00.000Z" };
  applyRemoteFolders([tomb], []);
  ok("a tombstone is not a live space", !getFolders().some((f) => f.id === tomb.id) && getFolderRecords().some((f) => f.id === tomb.id));
  forgetFolders([tomb.id]);
  ok("an acknowledged tombstone is forgotten", !getFolderRecords().some((f) => f.id === tomb.id));

  ok("the tone ladder wraps", nextFolderTone(new Array(7).fill({ tone: "sky" })) === "rose");
  ok("an old-theme tone maps onto a family", normaliseTone("glow") === "sky" && normaliseTone("mint") === "mint");

  // ── recipes ───────────────────────────────────────────────────────────────
  const qbr = saveRecipe({ name: "Customer QBR", focus: "A quarterly review.", looksFor: ["anything not working for them"] });
  ok("a recipe gets a custom id", qbr.id.startsWith("custom:"));
  ok("a saved recipe is stamped", Boolean(getRecipeRecords().find((r) => r.id === qbr.id)?.updatedAt));
  ok("a recipe resolves for note generation", templateFor(qbr.id).name === "Customer QBR");
  deleteRecipe(qbr.id);
  ok("a deleted recipe is gone from the picker", !getRecipes().some((r) => r.id === qbr.id));
  ok("a deleted recipe leaves a tombstone for the cloud", Boolean(getRecipeRecords().find((r) => r.id === qbr.id)?.deletedAt));
  ok("a deleted recipe resolves to the general template", templateFor(qbr.id).id !== qbr.id);
  forgetRecipes([qbr.id]);
  ok("an acknowledged recipe tombstone is forgotten", !getRecipeRecords().some((r) => r.id === qbr.id));

  const pulled = { id: "custom:design-crit", name: "Design crit", description: "", focus: "", looksFor: ["what changed since last time"], updatedAt: "2026-09-03T00:00:00.000Z" };
  applyRemoteRecipes([pulled], []);
  ok("a recipe pulled from the cloud is pickable", getRecipes().some((r) => r.id === pulled.id));
  ok("a pulled recipe keeps the cloud's stamp", getRecipeRecords().find((r) => r.id === pulled.id)?.updatedAt === pulled.updatedAt);
  applyRemoteRecipes([], [pulled.id]);
  ok("a cloud deletion removes the recipe here", !getRecipes().some((r) => r.id === pulled.id));
}

// ── pulling a meeting ────────────────────────────────────────────────────────
// PostgREST returns a one-to-one embed (meeting_notes is keyed by meeting_id)
// as an object, not a one-element array. The engine read `[0]` and every
// pulled meeting arrived with its notes missing — found by pulling a real
// meeting between two devices. Both shapes are accepted now, and pinned.
import { toLocal, type RemoteFull } from "../src/lib/sync.ts";

export function runPullMappingTests(ok: Ok): void {
  const base: RemoteFull = {
    id: "cf2221f8-0954-4d79-b306-c17f69faf593", org_id: "o", owner_id: "u", title: "Sync check", status: "complete", visibility: "private",
    started_at: "2026-09-06T15:46:49.000Z", ended_at: "2026-09-06T15:46:51.000Z", lang: "en-hq", created_at: "2026-09-06T15:46:49.979+00:00",
    meeting_notes: null, speakers: [{ id: "s1", label: "Speaker 1", identified_name: "Priya", identity_confidence: 0.8 }],
    transcript_segments: [
      { id: "t2", speaker_id: "s1", start_ms: 2000, end_ms: 4000, text: "second", confidence: 0.9 },
      { id: "t1", speaker_id: "s1", start_ms: 0, end_ms: 2000, text: "first", confidence: 0.9 },
    ],
    action_items: [{ id: "a1", title: "Check device A", status: "open" }, { id: "a2", title: "Dropped", status: "cancelled" }],
  };
  const note = { summary: ["A recording on one device reaches another."], decisions: [], questions: ["Really?"], markdown: "# Sync check", word_count: 12, manual_notes: "typed" };

  const asObject = toLocal({ ...base, meeting_notes: note as unknown as RemoteFull["meeting_notes"] }, undefined);
  ok("notes embedded as an object are read", asObject.summary.length === 1 && asObject.noteMarkdown === "# Sync check" && asObject.wordCount === 12);
  ok("manual notes come through", asObject.manualNotes === "typed");
  const asArray = toLocal({ ...base, meeting_notes: [note] }, undefined);
  ok("notes embedded as an array are read too", asArray.summary.length === 1 && asArray.questions[0] === "Really?");
  const none = toLocal(base, undefined);
  ok("a meeting with no notes yet maps to empty notes, not a crash", none.summary.length === 0 && none.noteMarkdown === "");

  ok("segments are sorted by time", asObject.segments.map((s) => s.text).join(",") === "first,second");
  ok("a segment carries the identified name, not the label", asObject.segments[0].speakerLabel === "Priya");
  ok("speaking time is recomputed from the lines", asObject.speakers?.[0].speakingSeconds === 4);
  ok("cancelled tasks are left out", asObject.actionItems.join(",") === "Check device A");
  ok("a pulled meeting is marked synced and owned", asObject.synced && asObject.ownerId === "u" && asObject.orgId === "o");
  ok("a pulled meeting is not dirty", asObject.dirty === undefined);
  ok("a stamp falls back to created_at on a backend without updated_at", asObject.updatedAt === base.created_at);

  // What only this device had survives a pull: the voice print and the chat.
  const previous = { ...asObject, speakers: [{ label: "Priya", confidence: null, speakingSeconds: 1, embedding: [0.1, 0.2] }], messages: [{ id: "m", role: "user" as const, text: "hi", atMs: 1 }], manualNotes: "local typed" };
  // A backend without migration 0007 has no manual_notes column at all, so
  // what was typed here is the only copy and must survive the pull.
  const { manual_notes: _dropped, ...legacyNote } = note;
  const merged = toLocal({ ...base, meeting_notes: legacyNote as unknown as RemoteFull["meeting_notes"] }, previous);
  ok("the voice print this device held is kept", merged.speakers?.[0].embedding?.length === 2);
  ok("the copilot thread this device held is kept", merged.messages?.length === 1);
  ok("a backend with no manual notes column does not erase notes typed here", merged.manualNotes === "local typed");
  // With the column present, the cloud's value is the truth — an empty string
  // means they were cleared on another device, not that they were never sent.
  const cleared = toLocal({ ...base, meeting_notes: { ...note, manual_notes: "" } as unknown as RemoteFull["meeting_notes"] }, previous);
  ok("an emptied manual note from the cloud is honoured", cleared.manualNotes === "");
}
