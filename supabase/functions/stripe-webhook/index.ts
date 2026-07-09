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

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2025-08-27.basil" });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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
        await admin
          .from("orgs")
          .update({ plan: "team", stripe_customer_id: customerId, stripe_subscription_id: subscriptionId ?? null })
          .eq("id", orgId);
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const plan = event.type === "customer.subscription.deleted" ? "free" : activeSubscriptionPlan(sub.status);
      await admin.from("orgs").update({ plan, stripe_subscription_id: sub.id }).eq("stripe_customer_id", customerId);
      break;
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
