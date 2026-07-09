import { NextResponse } from "next/server";
import { SITE } from "@/lib/site";

// Stripe Checkout session for the Team plan. Keys are injected as Vercel env
// vars (STRIPE_SECRET_KEY, STRIPE_PRICE_ID). When absent (before Stripe is
// wired) the endpoint fails gracefully — the paid tier is "contact us" rather
// than a 500. The free product never touches this route.
//
// `orgId` (optional) comes from the app's "Upgrade" deep link (?org=<uuid>) and
// is set as client_reference_id so the stripe-webhook Supabase function knows
// which org to activate when the checkout completes. Without it the payment
// still succeeds but nothing auto-activates the paid plan.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const price = process.env.STRIPE_PRICE_ID;
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? SITE.url;
  const { orgId }: { orgId?: string } = await req.json().catch(() => ({}));

  if (!secret || !price) {
    return NextResponse.json(
      { error: "Team checkout is launching shortly — use the contact link below for early access or a company license." },
      { status: 503 },
    );
  }

  try {
    const body = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      "subscription_data[trial_period_days]": "14",
      success_url: `${base}/pricing?status=success`,
      cancel_url: `${base}/pricing?status=cancel`,
      allow_promotion_codes: "true",
      ...(orgId ? { client_reference_id: orgId } : {}),
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const session = await res.json();
    if (!res.ok) return NextResponse.json({ error: session?.error?.message ?? "Stripe error" }, { status: 502 });
    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: "Could not reach Stripe." }, { status: 502 });
  }
}
