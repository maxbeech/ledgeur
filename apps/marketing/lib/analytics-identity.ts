// Who a signed-in visitor is to Google Analytics, and which plan they are on.
//
// Pure on purpose so it can be tested without Supabase. The hash itself is
// computed on the server (see app/api/analytics/identity/route.ts): the raw
// Supabase user id never reaches the browser's analytics calls.

import type { AnalyticsPlan } from "../../../lib/openhelm-analytics-mp.ts";

export interface AnalyticsIdentity {
  userRef: string;
  plan: AnalyticsPlan;
}

/**
 * `orgs.plan` is "free", "team" or "company". The Stripe webhook sets "team"
 * for an active OR trialing subscription (checkout starts a 14 day trial), so
 * "paid" here means a completed checkout with a live subscription, trial
 * included. A signed-in user whose workspace is unknown is "free".
 */
export function planFor(orgPlan: string | null | undefined): AnalyticsPlan {
  return orgPlan === "team" || orgPlan === "company" ? "paid" : "free";
}

export function isAnalyticsIdentity(v: unknown): v is AnalyticsIdentity {
  if (!v || typeof v !== "object") return false;
  const { userRef, plan } = v as Record<string, unknown>;
  return typeof userRef === "string" && /^[0-9a-f]{16}$/.test(userRef)
    && (plan === "free" || plan === "paid");
}

/** A short, non-identifying code for a failure, safe to send as an event param. */
export function reasonCode(err: unknown): string {
  const raw = err && typeof err === "object"
    ? (err as { code?: unknown; status?: unknown }).code ?? (err as { status?: unknown }).status
    : undefined;
  const code = typeof raw === "string" || typeof raw === "number" ? String(raw) : "unknown";
  const clean = code.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
  return clean || "unknown";
}
