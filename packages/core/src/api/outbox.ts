// The webhook outbox, as pure functions.
//
// The database does the real work: triggers on meetings, speakers,
// transcript_segments, meeting_notes and action_items upsert ONE pending row
// per meeting into `webhook_outbox`, and push its due time two minutes out each
// time. A device sync deletes and reinserts every segment, so a burst of
// thousands of row changes is one outbox row that comes due two minutes after
// the last of them.
//
// `coalesce` is the TypeScript statement of that SQL upsert (kept in step by a
// test), and `decideEvent` is what the dispatcher does with a row once it is
// due. Both are pure so the semantics are tested without a database.

import type { WebhookEventType } from "./contract.ts";
import { toApiSummary, type ApiMeetingRow } from "./mappers.ts";
import type { ApiMeetingSummary } from "./contract.ts";

/** How long a meeting must be quiet before its event fires. */
export const DEBOUNCE_MS = 2 * 60 * 1000;

export type OutboxKind = "change" | "deleted";

export interface OutboxRow {
  meeting_id: string;
  kind: OutboxKind;
  due_at: string;
}

/**
 * What a new change does to the pending row for its meeting.
 *
 *   - No pending row: a new one, due after the debounce window.
 *   - A pending row: it is pushed out to a fresh window, so a burst coalesces.
 *   - `deleted` wins over `change` and is due immediately: there is nothing to
 *     wait for once the meeting is gone, and a later change cannot undo it.
 */
export function coalesce(pending: OutboxRow | null, meetingId: string, kind: OutboxKind, now: number): OutboxRow {
  if (kind === "deleted" || pending?.kind === "deleted") {
    return { meeting_id: meetingId, kind: "deleted", due_at: new Date(pending?.kind === "deleted" ? Date.parse(pending.due_at) : now).toISOString() };
  }
  return { meeting_id: meetingId, kind: "change", due_at: new Date(now + DEBOUNCE_MS).toISOString() };
}

export interface MeetingEventState {
  completed_at: string | null;
  deleted_notified_at: string | null;
}

export interface EventDecision {
  type: WebhookEventType;
  meeting: ApiMeetingSummary;
}

/**
 * What event, if any, a due outbox row becomes.
 *
 * `meeting` is the meeting as it is now (null when it has been hard deleted),
 * `snapshot` the summary the delete trigger saved for exactly that case.
 */
export function decideEvent(
  kind: OutboxKind,
  meeting: ApiMeetingRow | null,
  snapshot: ApiMeetingRow | null,
  state: MeetingEventState | null,
  now: number,
): EventDecision | null {
  const gone = kind === "deleted" || !meeting || meeting.deleted_at != null;
  if (gone) {
    if (state?.deleted_notified_at) return null;
    const base = meeting ?? snapshot;
    if (!base) return null;
    const row: ApiMeetingRow = { ...base, deleted_at: base.deleted_at ?? new Date(now).toISOString() };
    return { type: "meeting.deleted", meeting: toApiSummary(row) };
  }
  // Not finished yet. Nothing is sent; the row that makes it `complete` will
  // touch the meeting again and produce its own outbox row.
  if (meeting.status !== "complete") return null;
  return {
    type: state?.completed_at ? "meeting.updated" : "meeting.completed",
    meeting: toApiSummary(meeting),
  };
}

/** Retry delays after the 1st..5th failed attempt, in seconds: 1m, 5m, 30m, 2h, 12h. */
export const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 43200] as const;

/** Seconds until the next attempt after `attempts` failures, or null to give up. */
export function retryDelaySeconds(attempts: number): number | null {
  return RETRY_DELAYS_SECONDS[attempts - 1] ?? null;
}

/**
 * Whether a webhook target may be called from our servers. Writing to a
 * private network address from a multi-tenant host is a server-side request
 * forgery, so literal private addresses and internal names are refused, except
 * where `allowLocal` is set for development. (DNS names that resolve to a
 * private address are not caught here.)
 */
export function webhookTargetBlocked(url: string, allowLocal: boolean): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return "invalid url"; }
  if (allowLocal) return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (u.protocol !== "https:") return "https required";
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return "internal host";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
      return "private address";
    }
  }
  if (h.includes(":") && (h === "::1" || h === "::" || /^f[cd]/.test(h) || h.startsWith("fe80") || h.startsWith("::ffff:"))) return "private address";
  return null;
}

/** Subscriptions that should receive an event for a meeting. */
export function subscribersFor<S extends { user_id: string; events: string[] }>(
  type: WebhookEventType,
  meeting: { owner_id: string; visibility: string },
  subs: S[],
  orgMemberIds: Set<string>,
): S[] {
  return subs.filter(
    (s) =>
      s.events.includes(type) &&
      (s.user_id === meeting.owner_id || (meeting.visibility === "org" && orgMemberIds.has(s.user_id))),
  );
}
