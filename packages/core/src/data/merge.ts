// The rules of sync, with no database in sight.
//
// Two devices edit the same record; one of them wins. The rule is the simplest
// one that a person can predict — the later edit wins — and it is applied the
// same way to meetings, spaces and recipes, from one function, so it cannot
// disagree with itself.
//
// Time comes from the devices. Every edit stamps `updatedAt` with the device's
// clock and that stamp travels to the cloud unchanged, so the comparison is
// always between two device clocks and never between a device and the server.
// Two laptops a minute apart will occasionally get this "wrong" in the sense
// that the earlier edit wins; that is a known, bounded cost, and far smaller
// than the alternative, where a server-side trigger makes every pull look newer
// than every local edit.

/** Anything that can be edited on more than one device. */
export interface Stamped {
  id: string;
  /** ISO-8601, set by the device that made the edit. */
  updatedAt?: string | null;
  /** ISO-8601 when the device deleted it; a tombstone other devices honour. */
  deletedAt?: string | null;
}

const stamp = (s: string | null | undefined): number => (s ? Date.parse(s) || 0 : 0);

/** Which side has the later edit. Equal stamps are "same" — nothing to do. */
export function newerOf(local: Stamped, remote: Stamped): "local" | "remote" | "same" {
  const l = stamp(local.updatedAt);
  const r = stamp(remote.updatedAt);
  if (l === r) return "same";
  return l > r ? "local" : "remote";
}

export interface MergePlan<T extends Stamped> {
  /** Local records to send up, including tombstones. */
  push: T[];
  /** Remote records to write into the local store (never tombstones). */
  pull: T[];
  /** Local ids whose remote copy is a tombstone — remove them here. */
  removeLocally: string[];
}

/**
 * Reconcile two sets of the same kind of record.
 *
 * A record that exists on one side only crosses over, tombstones included: a
 * device that deleted something must tell the others. When both sides have it,
 * the later `updatedAt` wins, and a winning tombstone deletes the other side.
 */
export function planMerge<T extends Stamped>(local: readonly T[], remote: readonly T[]): MergePlan<T> {
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const localById = new Map(local.map((l) => [l.id, l]));
  const plan: MergePlan<T> = { push: [], pull: [], removeLocally: [] };

  for (const l of local) {
    const r = remoteById.get(l.id);
    if (!r) {
      plan.push.push(l);
      continue;
    }
    const winner = newerOf(l, r);
    if (winner === "local") plan.push.push(l);
    else if (winner === "remote") {
      if (r.deletedAt) plan.removeLocally.push(l.id);
      else plan.pull.push(r);
    }
  }
  for (const r of remote) {
    if (localById.has(r.id) || r.deletedAt) continue;
    plan.pull.push(r);
  }
  return plan;
}

/**
 * Is this error the backend telling us it has not had a migration?
 *
 * PostgREST names the missing column or table, and the phrase is stable across
 * versions. Recognising it lets the app say "the backend needs migration 0007"
 * instead of "sync failed", which is the difference between a five-minute fix
 * and a support thread.
 */
export function isSchemaError(message: string): boolean {
  return /column .* does not exist|relation .* does not exist|could not find .* in the schema cache|schema cache/i.test(message);
}

/** The migration the current sync engine needs. Named so the message can say it. */
export const SYNC_MIGRATION = "0007_sync";

/**
 * Two records of the same meeting from before ids were shared.
 *
 * The old push gave the cloud row a fresh id, so a device that recorded a
 * meeting before this engine holds it under one id and the cloud under another.
 * They are the same meeting if they started at the same moment with the same
 * title; a minute's tolerance covers a clock that was a little off when the
 * device stamped it.
 */
export function isLegacyTwin(
  local: { title: string; startedAt: string | null; createdAt: string },
  remote: { title: string; startedAt: string | null; createdAt: string },
  toleranceMs = 60_000,
): boolean {
  if (local.title !== remote.title) return false;
  const l = stamp(local.startedAt ?? local.createdAt);
  const r = stamp(remote.startedAt ?? remote.createdAt);
  return l > 0 && r > 0 && Math.abs(l - r) <= toleranceMs;
}
