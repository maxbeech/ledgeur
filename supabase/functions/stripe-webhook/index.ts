// Stripe → Supabase billing sync. Without this, a completed checkout takes the
// user's money but never flips `orgs.plan`, so the paid MCP gate (`org_is_paid`)
// stays closed forever. Handles both live and test webhook endpoints (Stripe
// signs each with a different secret; we try both).
//
// Events handled:
//   checkout.session.completed   -> plan = 'team', store customer/subscription id
//   customer.subscription.updated -> plan follows subscription status
//   customer.subscription.deleted -> plan = 'free'

import Stripe from "npm:stripe@18";
import { createClient } from "npm:@supabase/supabase-js@2";
import { captureEdgeError } from "../_shared/sentry.ts";
import { trackEvent } from "../../../lib/openhelm-analytics-mp.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2025-08-27.basil" });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Best-effort product-analytics report of a confirmed billing-state change.
// This edge function has no browser and no Sentry wiring of its own (unlike
// the marketing app and desktop shell) — reporting through GA4's Measurement
// Protocol into the same property, and logging failures to the function's own
// console (Supabase's log surface for edge functions), is what this runtime
// actually has. `clientId` is an opaque org or Stripe customer id, never PII,
// and is already the identifier this function keys all billing state on.
function reportBillingEvent(name: string, clientId: string, params: Record<string, unknown> = {}) {
  const measurementId = Deno.env.get("NEXT_PUBLIC_GA_MEASUREMENT_ID") ?? Deno.env.get("GA_MEASUREMENT_ID");
  const apiSecret = Deno.env.get("GA_API_SECRET");
  if (!measurementId || !apiSecret) return;
  trackEvent({ measurementId, apiSecret, clientId, surface: "server" }, name, params)
    .then((result) => {
      if (!result.sent) console.error(`${name} not delivered`, result.reason);
    })
    .catch((e) => console.error(`${name} send threw`, e));
}

const webhookSecrets = [Deno.env.get("STRIPE_WEBHOOK_SECRET_LIVE"), Deno.env.get("STRIPE_WEBHOOK_SECRET_TEST")].filter(
  (s): s is string => Boolean(s),
);

async function verify(body: string, sig: string): Promise<Stripe.Event> {
  let lastErr: unknown;
  for (const secret of webhookSecrets) {
    try {
      return await stripe.webhooks.constructEventAsync(body, sig, secret);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("No webhook secret configured");
}

function activeSubscriptionPlan(status: Stripe.Subscription.Status): "team" | "free" {
  return status === "active" || status === "trialing" ? "team" : "free";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await verify(body, sig);
  } catch (e) {
    return new Response(`Signature verification failed: ${e instanceof Error ? e.message : String(e)}`, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.client_reference_id;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (orgId && customerId) {
        const { error } = await admin
          .from("orgs")
          .update({ plan: "team", stripe_customer_id: customerId, stripe_subscription_id: subscriptionId ?? null })
          .eq("id", orgId);
        // A payment that succeeded and an activation that silently failed is
        // exactly the bug /api/checkout's own comment describes avoiding —
        // except from the other end. Unchecked, this update's result was
        // simply discarded: Stripe got its 200, the org never got its plan,
        // and nothing anywhere said so.
        if (error) console.error("checkout.session.completed: org activation failed", { orgId, error });
        if (error) await captureEdgeError(new Error(`checkout.session.completed: org activation failed (${error.code ?? "unknown"})`), { scope: "stripe-webhook", orgId });
        else reportBillingEvent("trial_started", orgId, { org_id: orgId });
      } else {
        console.error("checkout.session.completed missing org or customer id", { orgId, customerId, sessionId: session.id });
        await captureEdgeError(new Error("checkout.session.completed missing org or customer id"), { scope: "stripe-webhook", sessionId: session.id });
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const plan = event.type === "customer.subscription.deleted" ? "free" : activeSubscriptionPlan(sub.status);
      const { error } = await admin.from("orgs").update({ plan, stripe_subscription_id: sub.id }).eq("stripe_customer_id", customerId);
      if (error) console.error(`${event.type}: org plan update failed`, { customerId, plan, error });
      if (error) await captureEdgeError(new Error(`${event.type}: org plan update failed (${error.code ?? "unknown"})`), { scope: "stripe-webhook", customerId });
      else if (event.type === "customer.subscription.deleted") {
        reportBillingEvent("subscription_canceled", customerId, { customer_id: customerId });
      }
      break;
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
