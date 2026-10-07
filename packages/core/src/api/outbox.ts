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

/**
 * Strict dotted-quad IPv4: four decimal parts, 0 to 255, no leading zeros.
 * Anything else (2130706433, 0x7f.1, 017.0.0.1, 1.2.3) is NOT an address here,
 * and `isPrivateAddress` treats what it cannot parse as blocked, so the
 * alternative spellings that some resolvers read as 127.0.0.1 never pass.
 */
function parseV4(ip: string): number[] | null {
  const m = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.exec(ip);
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

/** IPv4 ranges a webhook must never reach, as [address, prefix length]. */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],        // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],    // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],   // link local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],     // IETF protocol assignments
  ["192.0.2.0", 24],     // documentation
  ["192.88.99.0", 24],   // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],    // benchmarking
  ["198.51.100.0", 24],  // documentation
  ["203.0.113.0", 24],   // documentation
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4],      // reserved, incl. 255.255.255.255
];
const v4num = (o: number[]) => ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
const BLOCKED_V4_NUM = BLOCKED_V4.map(([a, bits]) => ({ base: v4num(a.split(".").map(Number)), size: 2 ** (32 - bits) }));
function privateV4(o: number[]): boolean {
  const n = v4num(o);
  return BLOCKED_V4_NUM.some((r) => n >= r.base && n < r.base + r.size);
}

/** IPv6 ranges blocked outright, as [first hextets, prefix length]. */
const BLOCKED_V6: [number[], number][] = [
  [[0, 0, 0, 0, 0, 0, 0, 0], 128],      // ::
  [[0, 0, 0, 0, 0, 0, 0, 1], 128],      // ::1
  [[0, 0, 0, 0, 0, 0, 0, 0], 96],       // ::/96 IPv4-compatible (deprecated)
  [[0x64, 0xff9b, 0, 0, 0, 0, 0, 0], 96], // NAT64
  [[0x64, 0xff9b, 1, 0, 0, 0, 0, 0], 48], // local-use NAT64
  [[0x100, 0, 0, 0, 0, 0, 0, 0], 64],   // discard-only
  [[0x2001, 0, 0, 0, 0, 0, 0, 0], 32],  // Teredo
  [[0x2001, 0x0db8, 0, 0, 0, 0, 0, 0], 32], // documentation
  [[0xfc00, 0, 0, 0, 0, 0, 0, 0], 7],   // unique local
  [[0xfe80, 0, 0, 0, 0, 0, 0, 0], 10],  // link local
  [[0xfec0, 0, 0, 0, 0, 0, 0, 0], 10],  // site local (deprecated)
  [[0xff00, 0, 0, 0, 0, 0, 0, 0], 8],   // multicast
];
function inV6(g: number[], base: number[], bits: number): boolean {
  for (let i = 0; i < 8 && bits > 0; i++, bits -= 16) {
    const n = Math.min(bits, 16);
    const mask = (0xffff << (16 - n)) & 0xffff;
    if ((g[i] & mask) !== (base[i] & mask)) return false;
  }
  return true;
}

/**
 * Whether an IP address (v4 or v6 text) is somewhere a webhook must never be
 * sent. IPv6 forms that carry an IPv4 address (IPv4-mapped ::ffff:0:0/96 and
 * 6to4 2002::/16) are judged by the address they carry. Anything that is not a
 * canonical address (decimal, octal or hex IPv4, junk) counts as blocked.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseV4(ip);
  if (v4) return privateV4(v4);
  const g = parseV6(ip);
  if (!g) return true;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return privateV4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
  if (g[0] === 0x2002) return privateV4([g[1] >> 8, g[1] & 255, g[2] >> 8, g[2] & 255]);
  return BLOCKED_V6.some(([base, bits]) => inV6(g, base, bits));
}

/**
 * True when the URL spells a numeric host in a non-canonical way (2130706433,
 * 0x7f.1, 017.0.0.1). The WHATWG parser quietly rewrites those to dotted form,
 * and `017.0.0.1` becomes 15.0.0.1, which is a different machine from the one
 * the writer, or a lenient resolver, would reach. We refuse the ambiguity.
 */
export function nonCanonicalNumericHost(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec(url.trim());
  if (!m) return false;
  const raw = normaliseHost(m[1]);
  const parsed = normaliseHost(u.hostname);
  if (raw === parsed) return false;
  return /^[0-9a-fx.]+$/i.test(raw) && /^(0x[0-9a-f]*|\d+)$/i.test(raw.slice(raw.lastIndexOf(".") + 1));
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
  if (nonCanonicalNumericHost(url)) return "non-canonical address";
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return "internal host";
  // `new URL` has already rewritten decimal/octal/hex IPv4 to dotted form. A
  // host whose last label is numeric but is not a canonical address is refused.
  const lastLabel = h.slice(h.lastIndexOf(".") + 1);
  if ((/^(0x[0-9a-f]*|\d+)$/i.test(lastLabel) || h.includes(":")) && isPrivateAddress(h)) return "private address";
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
