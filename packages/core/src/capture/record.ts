// A capture, as it is stored.
//
// One row per thought, holding both kinds. A task and a note are the same
// object with a different `kind`, because the commonest correction a person
// makes is "no, that's a task" — and if the two lived in different tables that
// tap would be a move between them, with two ids, two sync paths and a window
// where the thought is in neither. One row, one mutable field.
//
// Meeting action items are NOT captures and stay where they are (`action_items`,
// derived from the meeting's notes). The Tasks screen shows both; that is a
// question of what a screen lists, not of where a thought lives.

import type { CaptureKind, CaptureRouting, CaptureSource } from "./classify.ts";

/** How the thought got in. Kept because it changes what the text is: a spoken
 *  capture is a transcript, with a transcript's mistakes, and the UI says so
 *  rather than presenting it as something the person typed. */
export type CaptureEntry = "typed" | "spoken";

export interface CaptureRecord {
  id: string;
  /** Exactly what was typed, or what the speech model heard. Never rewritten —
   *  a tidied version lives in `title`, and the original stays recoverable. */
  text: string;
  /** The short label shown in lists. The model's, if it survived validation
   *  (words from `text` only); otherwise `text` itself. */
  title: string;
  kind: CaptureKind;
  /** The space this is filed in. Absent = the inbox, which is a fine place to
   *  be and the correct one whenever nothing was sure. */
  spaceId?: string;
  /** Whether a person or the model decided the kind. A person's decision is
   *  never re-guessed and never shown as a guess. */
  kindSource: CaptureSource;
  spaceSource: CaptureSource;
  kindConfidence: number;
  spaceConfidence: number;
  /** The words that led to a guessed space — shown so "why is this in Acme?"
   *  is answerable without asking the model again. */
  spaceEvidence?: string;
  entry: CaptureEntry;
  /** Tasks only. Notes are never "done". */
  done?: boolean;
  /** Set when the model could not be asked at all (no model, an error, a reply
   *  that ignored the contract). The capture is kept and sits in the inbox; this
   *  is why, so the UI can offer to sort it rather than looking like it forgot. */
  unsortedReason?: string;
  createdAt: string;
  updatedAt: string;
  /** When the cloud last agreed about this capture. Absent means the cloud has
   *  never seen it, which is what makes deleting it a plain removal rather than
   *  a tombstone nobody is waiting for. */
  syncedAt?: string;
  /** A tombstone: deleted here, not yet acknowledged by the cloud. */
  deletedAt?: string;
}

/**
 * A capture the moment it is made — before any model has seen it.
 *
 * Deliberately complete and saveable on its own: the thought is on disk before
 * classification starts, so a model that is slow, missing or wrong can only
 * change where it ends up, never whether it survives.
 */
export function newCapture(input: {
  id: string;
  text: string;
  entry: CaptureEntry;
  now?: string;
}): CaptureRecord {
  const now = input.now ?? new Date().toISOString();
  const text = input.text.trim();
  return {
    id: input.id, text, title: text, kind: "note",
    kindSource: "inferred", spaceSource: "inferred",
    kindConfidence: 0, spaceConfidence: 0,
    entry: input.entry, createdAt: now, updatedAt: now,
  };
}

/**
 * Fold a model's routing into a capture.
 *
 * A decision a person already made wins: once somebody has said "this is a
 * note" or moved it to Hiring, a later pass must not quietly undo them. In
 * practice this matters when a capture is re-sorted after spaces change.
 */
export function applyRouting(
  capture: CaptureRecord,
  routing: CaptureRouting,
  now: string = new Date().toISOString(),
): CaptureRecord {
  const next: CaptureRecord = { ...capture, updatedAt: now, unsortedReason: undefined };
  if (capture.kindSource !== "user") {
    next.kind = routing.kind;
    next.kindConfidence = routing.kindConfidence;
  }
  if (capture.spaceSource !== "user") {
    next.spaceId = routing.spaceId ?? undefined;
    next.spaceConfidence = routing.spaceConfidence;
    next.spaceEvidence = routing.spaceEvidence || undefined;
  }
  // The tidied title is only ever taken while the text is still the title —
  // i.e. nobody has renamed it themselves.
  if (capture.title === capture.text && routing.title) next.title = routing.title;
  return next;
}

/** Mark a capture as one nothing could sort. Kept, unfiled, and honest. */
export function markUnsorted(
  capture: CaptureRecord,
  reason: string,
  now: string = new Date().toISOString(),
): CaptureRecord {
  return { ...capture, unsortedReason: reason, updatedAt: now };
}

/**
 * A person says what this is.
 *
 * Flipping the kind clears the guess with it: a corrected capture that kept its
 * old confidence would go on being shown as "guessed — 82%", which is both
 * wrong and the sort of thing that stops people correcting anything.
 */
export function setKind(
  capture: CaptureRecord,
  kind: CaptureKind,
  now: string = new Date().toISOString(),
): CaptureRecord {
  return {
    ...capture, kind, kindSource: "user", kindConfidence: 0,
    // A note is never done; carrying a stale done-state back into a task later
    // would silently tick something nobody finished.
    done: kind === "task" ? capture.done : undefined,
    unsortedReason: undefined, updatedAt: now,
  };
}

/** A person files this somewhere, or takes it back out to the inbox. */
export function setSpace(
  capture: CaptureRecord,
  spaceId: string | null,
  now: string = new Date().toISOString(),
): CaptureRecord {
  return {
    ...capture,
    spaceId: spaceId ?? undefined,
    spaceSource: "user", spaceConfidence: 0, spaceEvidence: undefined,
    unsortedReason: undefined, updatedAt: now,
  };
}

/** Whether the UI should present this capture's filing as a guess. */
export const spaceIsGuess = (c: CaptureRecord): boolean =>
  c.spaceSource === "inferred" && Boolean(c.spaceId);

/** Whether the UI should present this capture's kind as a guess. */
export const kindIsGuess = (c: CaptureRecord): boolean =>
  c.kindSource === "inferred" && c.kindConfidence > 0;

/**
 * The captures a space contains, newest first.
 *
 * `null` means the inbox: everything filed nowhere. Tombstones are never
 * included — a deleted capture is gone from every view, including this one.
 */
export function capturesInSpace(
  captures: readonly CaptureRecord[],
  spaceId: string | null,
): CaptureRecord[] {
  return captures
    .filter((c) => !c.deletedAt && (spaceId === null ? !c.spaceId : c.spaceId === spaceId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Captures whose space no longer exists, put back in the inbox.
 *
 * A space can be deleted on another device while this one is offline. A capture
 * pointing at a space that is gone would be in no space and in no inbox — it
 * would appear in no list at all, which is indistinguishable from having lost
 * it. Deleting a space must never be a way to lose a thought.
 */
export function unfileOrphans(
  captures: readonly CaptureRecord[],
  spaceIds: readonly string[],
  now: string = new Date().toISOString(),
): CaptureRecord[] {
  const known = new Set(spaceIds);
  return captures.map((c) =>
    c.spaceId && !known.has(c.spaceId)
      ? { ...c, spaceId: undefined, spaceConfidence: 0, spaceEvidence: undefined, updatedAt: now }
      : c);
}
