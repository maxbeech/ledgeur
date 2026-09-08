// Captures — the thought you had on the way out of the meeting.
//
// The store, and only the store. What a capture *is*, how a model's guess is
// folded into one, and every rule about what may be believed all live in
// @ledgeur/core (capture/) and are unit-tested there. This file keeps them on
// the device and tells the sync engine what has changed.
//
// ── Saved first, sorted second ──────────────────────────────────────────────
// `addCapture` writes to disk and returns. Classification happens afterwards,
// against the saved row, and can only change where the thought is filed —
// never whether it survived. That ordering is the whole reliability story of
// the feature: the box has to be as safe as a piece of paper, or people go
// back to the piece of paper.
//
// Kept in localStorage rather than IndexedDB, like spaces and recipes: a
// capture is a line of text, the whole set is measured in kilobytes, and the
// meetings store's async transactions would make the one operation that has to
// feel instant — type, hit enter, gone — asynchronous for no benefit.

import { useSyncExternalStore } from "react";
import {
  applyRouting, capturesInSpace, markUnsorted, newCapture, setKind, setSpace, unfileOrphans,
  type CaptureEntry, type CaptureKind, type CaptureRecord, type CaptureRouting,
} from "@ledgeur/core";

const KEY = "ledgeur.captures";

const uid = (): string =>
  crypto?.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

function load(): CaptureRecord[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    // Defensive: a hand-edited or half-written store must not stop the capture
    // box from working — that would lose new thoughts over old ones.
    return parsed
      .filter((c): c is CaptureRecord =>
        Boolean(c) && typeof c === "object"
        && typeof (c as CaptureRecord).id === "string"
        && typeof (c as CaptureRecord).text === "string")
      .map((c) => ({
        ...c,
        title: c.title || c.text,
        kind: c.kind === "task" ? "task" : "note",
        kindSource: c.kindSource === "user" ? "user" : "inferred",
        spaceSource: c.spaceSource === "user" ? "user" : "inferred",
        kindConfidence: Number.isFinite(c.kindConfidence) ? c.kindConfidence : 0,
        spaceConfidence: Number.isFinite(c.spaceConfidence) ? c.spaceConfidence : 0,
        entry: c.entry === "spoken" ? "spoken" : "typed",
        updatedAt: c.updatedAt ?? c.createdAt ?? "1970-01-01T00:00:00.000Z",
      }));
  } catch {
    return [];
  }
}

let records: CaptureRecord[] = load();
let live: CaptureRecord[] = records.filter((c) => !c.deletedAt);
const listeners = new Set<() => void>();

function commit(next: CaptureRecord[]): void {
  records = next;
  live = records.filter((c) => !c.deletedAt);
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* storage unavailable — keep the in-memory value rather than lose the thought */
  }
  for (const l of listeners) l();
}

/** Everything not deleted, newest first. */
export function getCaptures(): CaptureRecord[] {
  return live;
}

/** Everything, tombstones included — the sync engine's view. */
export function getCaptureRecords(): CaptureRecord[] {
  return records;
}

export function captureById(id: string): CaptureRecord | undefined {
  return live.find((c) => c.id === id);
}

/**
 * Keep a thought. Synchronous, and the only step that is allowed to matter.
 *
 * Returns the saved record so the caller can hand it straight to the sorter
 * without reading it back — and so a caller that cannot reach a model still has
 * a complete, saved capture in its hands.
 */
export function addCapture(text: string, entry: CaptureEntry): CaptureRecord {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Nothing to keep.");
  const record = newCapture({ id: uid(), text: trimmed, entry });
  commit([...records, record]);
  return record;
}

/** Fold a model's routing into a saved capture. */
export function routeCaptureRecord(id: string, routing: CaptureRouting): void {
  commit(records.map((c) => (c.id === id ? applyRouting(c, routing) : c)));
}

/** Record that nothing could sort this one, and why. */
export function markCaptureUnsorted(id: string, reason: string): void {
  commit(records.map((c) => (c.id === id ? markUnsorted(c, reason) : c)));
}

/** A person says what this is. Clears the guess with it — see core's setKind. */
export function setCaptureKind(id: string, kind: CaptureKind): void {
  commit(records.map((c) => (c.id === id ? setKind(c, kind) : c)));
}

/** A person files it, or takes it back out to the inbox. */
export function setCaptureSpace(id: string, spaceId: string | null): void {
  commit(records.map((c) => (c.id === id ? setSpace(c, spaceId) : c)));
}

/** Tasks only. A note has nothing to finish. */
export function setCaptureDone(id: string, done: boolean): void {
  const now = new Date().toISOString();
  commit(records.map((c) => (c.id === id && c.kind === "task" ? { ...c, done, updatedAt: now } : c)));
}

/** Rename a capture. The original text is kept underneath, always. */
export function renameCapture(id: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Give it a name, or leave it as it was.");
  const now = new Date().toISOString();
  commit(records.map((c) => (c.id === id ? { ...c, title: trimmed, updatedAt: now } : c)));
}

/**
 * Delete a capture.
 *
 * One the cloud knows about becomes a tombstone until the engine has passed the
 * deletion on; one it never knew about simply goes. Same rule as a meeting: a
 * deletion that is not told to the cloud comes back on the next pull.
 */
export function deleteCapture(id: string): void {
  const existing = records.find((c) => c.id === id);
  if (!existing) return;
  const now = new Date().toISOString();
  commit(
    existing.syncedAt
      ? records.map((c) => (c.id === id ? { ...c, deletedAt: now, updatedAt: now } : c))
      : records.filter((c) => c.id !== id),
  );
}

/**
 * Write what the cloud has, without stamping: it is not a new edit.
 *
 * Returns without touching anything when the cloud had nothing new, which is
 * the common case — every sync calls this, and every sync agreeing with the
 * last one must be silent. Committing regardless notified the subscribers,
 * one of which is the sync engine, which scheduled another sync, which called
 * this again: a loop that ran every two seconds forever and did nothing.
 */
export function applyRemoteCaptures(pulled: readonly CaptureRecord[], removed: readonly string[]): void {
  if (pulled.length === 0 && removed.length === 0) return;
  const byId = new Map(records.map((c) => [c.id, c]));
  for (const c of pulled) byId.set(c.id, c);
  for (const id of removed) byId.delete(id);
  commit([...byId.values()]);
}

/** A tombstone the cloud has acknowledged can go. */
export function forgetCaptures(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const wanted = new Set(ids);
  if (!records.some((c) => wanted.has(c.id))) return;
  commit(records.filter((c) => !wanted.has(c.id)));
}

/** Mark which captures the cloud now holds, so a later delete leaves a tombstone. */
export function markCapturesSynced(ids: readonly string[], at: string): void {
  if (ids.length === 0) return;
  const wanted = new Set(ids);
  if (!records.some((c) => wanted.has(c.id) && c.syncedAt !== at)) return;
  commit(records.map((c) => (wanted.has(c.id) ? { ...c, syncedAt: at } : c)));
}

/**
 * Is there a capture the cloud has not seen this version of?
 *
 * The sync engine asks before scheduling a run, exactly as it does for
 * meetings. Without it, the engine's own writes (marking rows synced) look
 * like edits and it syncs itself in a circle.
 */
export function capturesNeedPush(): boolean {
  return records.some((c) => {
    // A tombstone is pushed until the cloud has been told; being told is what
    // `forgetCaptures` records. One the cloud never saw needs no telling.
    if (c.deletedAt) return Boolean(c.syncedAt);
    if (!c.syncedAt) return true;
    // `>=`, not `>`: these stamps have millisecond resolution, and an edit made
    // in the same millisecond the engine marked the row synced would otherwise
    // never be pushed at all. The cost of the equal case is one redundant push
    // that finds nothing; the cost of the other choice is a lost edit.
    return Date.parse(c.updatedAt) >= Date.parse(c.syncedAt);
  });
}

/**
 * Put captures whose space has gone back in the inbox.
 *
 * A space can be deleted on the laptop while the phone is in a tunnel. A
 * capture pointing at a space that no longer exists appears in no space and in
 * no inbox — in no list at all, which a person cannot tell apart from having
 * lost it. Called after anything that removes a space.
 *
 * Takes the surviving space ids rather than reading them, so this module never
 * imports the one that deletes spaces — the two would otherwise import each
 * other, and a cycle between two stores is a bad thing to leave lying around
 * for whoever adds the next top-level statement.
 */
export function rescueOrphanedCaptures(spaceIds: readonly string[]): void {
  const next = unfileOrphans(records, spaceIds);
  if (next.some((c, i) => c !== records[i])) commit(next);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useCaptures(): CaptureRecord[] {
  return useSyncExternalStore(subscribe, getCaptures, getCaptures);
}

/** The captures in one space, or the inbox with `null`. */
export function useCapturesInSpace(spaceId: string | null): CaptureRecord[] {
  const all = useCaptures();
  return capturesInSpace(all, spaceId);
}

/** For the sync engine: subscribe to any change worth pushing. */
export function subscribeCaptures(cb: () => void): () => void {
  return subscribe(cb);
}
