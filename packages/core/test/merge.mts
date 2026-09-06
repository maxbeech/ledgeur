// The rules of sync, pinned. These are the cases a person would predict; the
// engine that moves rows is a thin loop over them.
import { newerOf, planMerge, isSchemaError, isLegacyTwin } from "../src/data/merge.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;

export function runMergeTests(ok: Ok): void {
  const t0 = "2026-09-06T10:00:00.000Z";
  const t1 = "2026-09-06T10:05:00.000Z";
  const t2 = "2026-09-06T10:10:00.000Z";

  ok("the later edit wins", newerOf({ id: "a", updatedAt: t1 }, { id: "a", updatedAt: t2 }) === "remote");
  ok("the later local edit wins too", newerOf({ id: "a", updatedAt: t2 }, { id: "a", updatedAt: t1 }) === "local");
  ok("equal stamps are the same", newerOf({ id: "a", updatedAt: t1 }, { id: "a", updatedAt: t1 }) === "same");
  ok("a record with no stamp loses to one with a stamp", newerOf({ id: "a" }, { id: "a", updatedAt: t0 }) === "remote");
  ok("two unstamped records are the same", newerOf({ id: "a" }, { id: "a" }) === "same");

  const plan = planMerge(
    [
      { id: "only-local", updatedAt: t0 },
      { id: "local-newer", updatedAt: t2 },
      { id: "remote-newer", updatedAt: t0 },
      { id: "remote-deleted", updatedAt: t0 },
      { id: "local-deleted", updatedAt: t2, deletedAt: t2 },
      { id: "same", updatedAt: t1 },
    ],
    [
      { id: "only-remote", updatedAt: t0 },
      { id: "only-remote-deleted", updatedAt: t0, deletedAt: t0 },
      { id: "local-newer", updatedAt: t1 },
      { id: "remote-newer", updatedAt: t1 },
      { id: "remote-deleted", updatedAt: t1, deletedAt: t1 },
      { id: "local-deleted", updatedAt: t0 },
      { id: "same", updatedAt: t1 },
    ],
  );
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort().join(",");
  ok("a record only this device has is pushed", plan.push.some((p) => p.id === "only-local"));
  ok("a record only the cloud has is pulled", plan.pull.some((p) => p.id === "only-remote"));
  ok("a cloud tombstone this device never had is ignored", !plan.pull.some((p) => p.id === "only-remote-deleted") && !plan.removeLocally.includes("only-remote-deleted"));
  ok("a newer local edit is pushed", plan.push.some((p) => p.id === "local-newer"));
  ok("a newer remote edit is pulled", plan.pull.some((p) => p.id === "remote-newer"));
  ok("a newer remote tombstone removes the local copy", plan.removeLocally.includes("remote-deleted"));
  ok("a newer local tombstone is pushed, so the other device learns", plan.push.some((p) => p.id === "local-deleted" && p.deletedAt));
  ok("an unchanged record goes nowhere",
    !plan.push.some((p) => p.id === "same") && !plan.pull.some((p) => p.id === "same"),
    `push=${ids(plan.push)} pull=${ids(plan.pull)}`);
  ok("nothing is pulled and pushed at once", plan.push.every((p) => !plan.pull.some((q) => q.id === p.id)));
  ok("empty sides plan nothing", (() => { const p = planMerge([], []); return p.push.length + p.pull.length + p.removeLocally.length === 0; })());

  ok("a missing column is recognised as an unapplied migration",
    isSchemaError('column meetings.updated_at does not exist'));
  ok("a missing table is recognised as an unapplied migration",
    isSchemaError('relation "public.folders" does not exist'));
  ok("PostgREST's schema-cache wording is recognised",
    isSchemaError("Could not find the 'manual_notes' column of 'meeting_notes' in the schema cache"));
  ok("an ordinary failure is not mistaken for a migration", !isSchemaError("JWT expired") && !isSchemaError("Failed to fetch"));

  const local = { title: "Pricing", startedAt: "2026-09-01T10:00:00.000Z", createdAt: "2026-09-01T10:30:00.000Z" };
  ok("the same title at the same start is the same meeting",
    isLegacyTwin(local, { title: "Pricing", startedAt: "2026-09-01T10:00:20.000Z", createdAt: "2026-09-01T10:30:00.000Z" }));
  ok("a different title is a different meeting",
    !isLegacyTwin(local, { title: "Hiring", startedAt: "2026-09-01T10:00:00.000Z", createdAt: "2026-09-01T10:30:00.000Z" }));
  ok("the same title an hour apart is a different meeting",
    !isLegacyTwin(local, { title: "Pricing", startedAt: "2026-09-01T11:00:00.000Z", createdAt: "2026-09-01T11:30:00.000Z" }));
  ok("a meeting with no start time falls back to when it was created",
    isLegacyTwin({ ...local, startedAt: null }, { title: "Pricing", startedAt: null, createdAt: "2026-09-01T10:30:10.000Z" }));
}
