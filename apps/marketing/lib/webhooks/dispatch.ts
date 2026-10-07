// The webhook dispatcher: turns due outbox rows into deliveries, and sends the
// deliveries that are due. Run once a minute by a Helm7 scheduled job calling
// app/api/cron/webhooks. All the decisions (what event, who gets it, when to
// retry) are pure functions in @ledgeur/core/api; this file is the I/O.
//
// Runs with the service role: the webhook tables have no RLS policies.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decideEvent, retryDelaySeconds, subscribersFor, webhookHeaders, webhookTargetBlocked,
  type ApiEvent, type ApiMeetingRow, type MeetingEventState, type OutboxRow,
} from "@ledgeur/core";

export interface DispatchDeps {
  admin: SupabaseClient;
  fetch?: typeof globalThis.fetch;
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

async function attempt(
  { fetch: doFetch = globalThis.fetch, now = Date.now, allowLocalTargets = false, timeoutMs = 10_000 }: DispatchDeps,
  sub: { url: string; secret: string },
  d: Row,
): Promise<{ ok: boolean; code: number | null; error?: string }> {
  const blocked = webhookTargetBlocked(sub.url, allowLocalTargets);
  if (blocked) return { ok: false, code: null, error: `target not allowed: ${blocked}` };
  const body = JSON.stringify(d.payload);
  const headers = await webhookHeaders(body, new Date(now()).toISOString(), sub.secret, d.event_type as string, d.id as string);
  try {
    const res = await doFetch(sub.url, {
      method: "POST", headers, body,
      redirect: "manual", // a redirect is a way to reach somewhere we refused to post to
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status >= 200 && res.status < 300
      ? { ok: true, code: res.status }
      : { ok: false, code: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, code: null, error: e instanceof Error ? e.message : String(e) };
  }
}
