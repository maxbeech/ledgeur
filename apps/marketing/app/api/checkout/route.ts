import { NextResponse } from "next/server";
import { SITE } from "@/lib/site";

// Stripe Checkout session for the Team plan. Keys are injected as Vercel env
// vars (STRIPE_SECRET_KEY, STRIPE_PRICE_ID). When absent (before Stripe is
// wired) the endpoint fails gracefully — the paid tier is "contact us" rather
// than a 500. The free product never touches this route.
export async function POST() {
  const secret = process.env.STRIPE_SECRET_KEY;
  const price = process.env.STRIPE_PRICE_ID;
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? SITE.url;

  if (!secret || !price) {
    return NextResponse.json(
      { error: `Team checkout is launching shortly. Email ${SITE.contactEmail} for early access or a company license.` },
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
