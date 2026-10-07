// The webhook dispatcher: turns due outbox rows into deliveries, and sends the
// deliveries that are due. Run once a minute by a Helm7 scheduled job calling
// app/api/cron/webhooks. All the decisions (what event, who gets it, when to
// retry) are pure functions in @ledgeur/core/api; this file is the I/O.
//
// Runs with the service role: the webhook tables have no RLS policies.

import type { SupabaseClient } from "@supabase/supabase-js";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import {
  decideEvent, isPrivateAddress, normaliseHost, retryDelaySeconds, subscribersFor, webhookHeaders, webhookTargetBlocked,
  type ApiEvent, type ApiMeetingRow, type MeetingEventState, type OutboxRow,
} from "@ledgeur/core";

export interface DispatchDeps {
  admin: SupabaseClient;
  /** Sends the request to an address we already validated. Default: node https pinned to that address. */
  send?: SendFn;
  /** Resolves a hostname to all its addresses. Default: dns.lookup(host, { all: true }). */
  lookup?: (host: string) => Promise<{ address: string }[]>;
  now?: () => number;
  /** Allow http/localhost/private targets. Development only. */
  allowLocalTargets?: boolean;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  report?: (e: unknown, scope: string) => void;
}

export interface DispatchResult {
  events: number;
  deliveries_created: number;
  attempted: number;
  delivered: number;
  retrying: number;
  failed: number;
}

type Row = Record<string, unknown>;
const PAID = ["team", "company"];
const MEETING_COLS = "id,title,status,started_at,ended_at,lang,updated_at,deleted_at,owner_id,org_id,visibility";

export async function runDispatch(deps: DispatchDeps): Promise<DispatchResult> {
  const result: DispatchResult = { events: 0, deliveries_created: 0, attempted: 0, delivered: 0, retrying: 0, failed: 0 };
  await createDeliveries(deps, result);
  await sendDeliveries(deps, result);
  // Housekeeping: keep a month of finished deliveries.
  const cutoff = new Date((deps.now?.() ?? Date.now()) - 30 * 86_400_000).toISOString();
  await deps.admin.from("webhook_deliveries").delete().neq("status", "pending").lt("created_at", cutoff);
  return result;
}

async function createDeliveries({ admin, now = Date.now, report }: DispatchDeps, result: DispatchResult) {
  const claimed = await admin.rpc("webhook_claim_outbox", { p_limit: 200 });
  if (claimed.error) throw new Error(`claim outbox: ${claimed.error.message}`);
  const rows = (claimed.data ?? []) as (OutboxRow & { owner_id: string | null; org_id: string | null; visibility: string | null; snapshot: ApiMeetingRow | null })[];

  for (const row of rows) {
    try {
      const { data: meeting } = await admin.from("meetings").select(MEETING_COLS).eq("id", row.meeting_id).maybeSingle();
      const m = meeting as (ApiMeetingRow & { owner_id: string; org_id: string; visibility: string }) | null;
      const { data: st } = await admin.from("webhook_meeting_state").select("completed_at,deleted_notified_at").eq("meeting_id", row.meeting_id).maybeSingle();
      const state = (st as MeetingEventState | null) ?? null;

      const decision = decideEvent(row.kind, m, row.snapshot, state, now());
      if (!decision) continue;

      // Record the milestone whether or not anyone is subscribed, so a webhook
      // created later still sees "updated" for a meeting that already completed.
      const patch: Row = { meeting_id: row.meeting_id };
      if (decision.type === "meeting.deleted") patch.deleted_notified_at = new Date(now()).toISOString();
      else {
        patch.deleted_notified_at = null;
        if (decision.type === "meeting.completed") patch.completed_at = new Date(now()).toISOString();
      }
      await admin.from("webhook_meeting_state").upsert(patch);

      const who = m ?? { owner_id: row.owner_id, org_id: row.org_id, visibility: row.visibility };
      if (!who.owner_id) continue;
      const { data: subRows } = await admin.from("webhook_subscriptions").select("id,user_id,events").contains("events", [decision.type]);
      const subs = (subRows ?? []) as { id: string; user_id: string; events: string[] }[];
      if (subs.length === 0) continue;

      let members = new Set<string>();
      if (who.visibility === "org" && who.org_id) {
        const { data } = await admin.from("org_members").select("user_id").eq("org_id", who.org_id);
        members = new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
      }
      let targets = subscribersFor(decision.type, { owner_id: who.owner_id, visibility: who.visibility ?? "private" }, subs, members);
      if (targets.length === 0) continue;

      // A lapsed plan stops deliveries, the way it stops the API.
      const { data: paidRows } = await admin.from("org_members").select("user_id, orgs!inner(plan)")
        .in("user_id", [...new Set(targets.map((t) => t.user_id))]).in("orgs.plan", PAID);
      const paid = new Set(((paidRows ?? []) as { user_id: string }[]).map((r) => r.user_id));
      targets = targets.filter((t) => paid.has(t.user_id));

      for (const t of targets) {
        const id = crypto.randomUUID();
        const payload: ApiEvent = {
          id, type: decision.type, created_at: new Date(now()).toISOString(),
          data: { meeting_id: row.meeting_id, meeting: decision.meeting },
        };
        const { error } = await admin.from("webhook_deliveries").insert({
          id, subscription_id: t.id, event_type: decision.type, meeting_id: row.meeting_id, payload,
        });
        if (error) throw new Error(`insert delivery: ${error.message}`);
        result.deliveries_created++;
      }
      result.events++;
    } catch (e) {
      report?.(e, "webhooks.create");
    }
  }
}

async function sendDeliveries(deps: DispatchDeps, result: DispatchResult) {
  const { admin, now = Date.now, report } = deps;
  const claimed = await admin.rpc("webhook_claim_deliveries", { p_limit: 100 });
  if (claimed.error) throw new Error(`claim deliveries: ${claimed.error.message}`);
  const deliveries = (claimed.data ?? []) as Row[];
  if (deliveries.length === 0) return;

  const ids = [...new Set(deliveries.map((d) => d.subscription_id as string))];
  const { data: subRows } = await admin.from("webhook_subscriptions").select("id,url,secret").in("id", ids);
  const subs = new Map(((subRows ?? []) as { id: string; url: string; secret: string }[]).map((s) => [s.id, s]));

  // Sequential per run: a slow receiver should not fan out into 100 sockets,
  // and a batch is bounded by the timeout times the claim limit.
  for (const d of deliveries) {
    const sub = subs.get(d.subscription_id as string);
    if (!sub) continue; // deleted meanwhile; the cascade removes the delivery
    result.attempted++;
    const outcome = await attempt(deps, sub, d);
    const attempts = (d.attempts as number) + 1;
    const at = new Date(now()).toISOString();
    try {
      if (outcome.ok) {
        result.delivered++;
        await admin.from("webhook_deliveries").update({ status: "delivered", attempts, delivered_at: at, last_status_code: outcome.code, last_error: null }).eq("id", d.id);
        await admin.from("webhook_subscriptions").update({ last_delivery_at: at, last_status: "delivered", last_status_code: outcome.code }).eq("id", sub.id);
      } else {
        const delay = retryDelaySeconds(attempts);
        const status = delay === null ? "failed" : "pending";
        if (delay === null) result.failed++; else result.retrying++;
        await admin.from("webhook_deliveries").update({
          status, attempts, last_status_code: outcome.code, last_error: outcome.error?.slice(0, 500) ?? null,
          next_attempt_at: new Date(now() + (delay ?? 0) * 1000).toISOString(),
        }).eq("id", d.id);
        await admin.from("webhook_subscriptions").update({
          last_delivery_at: at, last_status: delay === null ? "failed" : "retrying", last_status_code: outcome.code,
        }).eq("id", sub.id);
      }
    } catch (e) {
      report?.(e, "webhooks.record");
    }
  }
}

export type SendFn = (req: {
  url: string; headers: Record<string, string>; body: string; address: string; timeoutMs: number;
}) => Promise<{ status: number }>;

/**
 * POST to `url`, but connect to `address` (already checked) rather than letting
 * the socket resolve the name again, which is what closes the DNS rebinding gap.
 * The URL's hostname is still used for SNI and certificate verification. No
 * redirects are followed: the status is returned as is.
 */
export const pinnedSend: SendFn = ({ url, headers, body, address, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        method: "POST", hostname: u.hostname.replace(/^\[|\]$/g, ""), port: u.port || undefined, path: `${u.pathname}${u.search}`,
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        timeout: timeoutMs,
        lookup: (_h, _o, cb) => {
          // Node may ask for either family or for all addresses.
          const family = isIP(address) === 6 ? 6 : 4;
          (cb as (e: null, a: unknown, f?: number) => void)(null, _o && (_o as { all?: boolean }).all ? [{ address, family }] : address, family);
        },
      },
      (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode ?? 0 })); res.on("error", reject); },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });

/**
 * Resolve the target and pick an address that is safe to connect to. Every
 * address the name resolves to must be public: a name with one public and one
 * private record would otherwise be a coin flip for an attacker.
 */
export async function safeAddress(
  url: string,
  allowLocal: boolean,
  lookup: NonNullable<DispatchDeps["lookup"]>,
): Promise<{ address: string } | { blocked: true }> {
  const host = normaliseHost(new URL(url).hostname);
  if (allowLocal) return { address: (isIP(host) ? host : (await lookup(host))[0]?.address) ?? host };
  if (isIP(host)) return isPrivateAddress(host) ? { blocked: true } : { address: host };
  let addrs: { address: string }[];
  try { addrs = await lookup(host); } catch { return { blocked: true }; }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) return { blocked: true };
  return { address: addrs[0].address };
}

async function attempt(
  { send = pinnedSend, lookup = (h) => dnsLookup(h, { all: true }), now = Date.now, allowLocalTargets = false, timeoutMs = 10_000 }: DispatchDeps,
  sub: { url: string; secret: string },
  d: Row,
): Promise<{ ok: boolean; code: number | null; error?: string }> {
  // Deliberately generic: say nothing about what the name resolved to.
  const refused = { ok: false, code: null, error: "target not allowed" };
  if (webhookTargetBlocked(sub.url, allowLocalTargets)) return refused;
  const target = await safeAddress(sub.url, allowLocalTargets, lookup);
  if ("blocked" in target) return refused;
  const body = JSON.stringify(d.payload);
  const headers = await webhookHeaders(body, new Date(now()).toISOString(), sub.secret, d.event_type as string, d.id as string);
  try {
    const res = await send({ url: sub.url, headers, body, address: target.address, timeoutMs });
    return res.status >= 200 && res.status < 300
      ? { ok: true, code: res.status }
      : { ok: false, code: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, code: null, error: e instanceof Error ? e.message : String(e) };
  }
}
