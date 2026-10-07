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

/** Hostname as the network will see it: lowercase, no brackets, no trailing dot. */
export function normaliseHost(host: string): string {
  return host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

function parseV4(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

/** IPv6 text to 8 hextets, or null. Handles `::`, an embedded IPv4 tail and a zone id. */
function parseV6(raw: string): number[] | null {
  let ip = raw.split("%")[0];
  if (!ip.includes(":")) return null;
  const tail = ip.slice(ip.lastIndexOf(":") + 1);
  if (tail.includes(".")) {
    const v4 = parseV4(tail);
    if (!v4) return null;
    ip = ip.slice(0, ip.lastIndexOf(":") + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function privateV4(o: number[]): boolean {
  const [a, b, c] = o;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||          // CGNAT
    (a === 169 && b === 254) ||                    // link local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/**
 * Whether an IP address (v4 or v6 text) is somewhere a webhook must never be
 * sent: private, loopback, link local, CGNAT, unique local, multicast,
 * documentation, unspecified, and the IPv6 forms that smuggle an IPv4 address
 * (IPv4-mapped, NAT64, 6to4). Anything unparseable counts as blocked.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseV4(ip);
  if (v4) return privateV4(v4);
  const g = parseV6(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true;                        // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return true; // ::ffff:a.b.c.d (mapped)
  if (g.slice(0, 6).every((x) => x === 0)) return true;            // ::a.b.c.d (deprecated compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;               // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64)
  if ((g[0] & 0xfe00) === 0xfc00) return true;                     // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link local, site local
  if ((g[0] & 0xff00) === 0xff00) return true;                     // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;             // documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard
  if (g[0] === 0x2002) return privateV4([g[1] >> 8, g[1] & 255, g[2] >> 8, g[2] & 255]); // 6to4
  return false;
}

/**
 * A first, cheap check on the URL alone. This does NOT make a target safe: a
 * public-looking name can resolve to a private address. The dispatcher also
 * resolves the name, checks every address with `isPrivateAddress`, and connects
 * to the address it checked.
 */
export function webhookTargetBlocked(url: string, allowLocal: boolean): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return "invalid url"; }
  if (allowLocal) return null;
  const h = normaliseHost(u.hostname);
  if (u.protocol !== "https:") return "https required";
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return "internal host";
  if ((parseV4(h) || h.includes(":")) && isPrivateAddress(h)) return "private address";
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
