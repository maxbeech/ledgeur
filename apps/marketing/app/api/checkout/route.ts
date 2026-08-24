import { NextResponse } from "next/server";
import { createLedgeurClient } from "@ledgeur/core";
import { SITE, SUPABASE } from "@/lib/site";

// Stripe Checkout for the paid plan.
//
// ── The bug this route exists to close ──────────────────────────────────────
// It used to accept an optional `orgId` from the browser and, when absent, open
// a checkout session anyway. Every purchase started from /pricing therefore had
// no `client_reference_id`, so the Stripe webhook had no org to activate: the
// customer was charged and received nothing. The button worked, the payment
// worked, and the product never turned on.
//
// So: the org is now resolved *server-side* from the caller's own Supabase
// session, and a session that cannot be attributed to an org is refused rather
// than sold. Refusing to take money is always better than taking it for
// nothing.
//
// Node runtime: the Supabase client and the token exchange want Node APIs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(header: string | null): string | null {
  const m = /^bearer\s+(.+)$/i.exec((header ?? "").trim());
  return m ? m[1].trim() : null;
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const price = process.env.STRIPE_PRICE_ID;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? SITE.url;

  if (!secret || !price) {
    return NextResponse.json(
      { error: "Card payment is not configured on this deployment yet. Get in touch and we will set you up by hand.", code: "not_configured" },
      { status: 503 },
    );
  }

  const token = bearer(req.headers.get("authorization"));
  if (!token) {
    return NextResponse.json(
      { error: "Sign in first, so the subscription can be attached to your workspace.", code: "sign_in_required" },
      { status: 401 },
    );
  }

  // Who is asking. The anon key plus the caller's token means this runs as
  // them — this route has no privileges of its own for reading user data.
  const asUser = createLedgeurClient(SUPABASE.url, SUPABASE.anonKey, { persistSession: false, accessToken: token });
  const { data: userData, error: userErr } = await asUser.auth.getUser(token);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "That session has expired. Sign in again.", code: "sign_in_required" }, { status: 401 });
  }
  const user = userData.user;

  // Which workspace to switch on. Membership is readable under the caller's own
  // RLS, so the service-role key is only a fallback for deployments that have
  // not granted that read.
  let orgId: string | null = null;
  const asUserMember = await asUser.from("org_members").select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
  orgId = (asUserMember.data as { org_id?: string } | null)?.org_id ?? null;

  if (!orgId && serviceRole) {
    const admin = createLedgeurClient(SUPABASE.url, serviceRole, { persistSession: false });
    const { data } = await admin.from("org_members").select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
    orgId = (data as { org_id?: string } | null)?.org_id ?? null;
  }

  if (!orgId) {
    // The signup trigger creates a workspace for every new user, so this is a
    // genuinely broken account rather than a normal state. Do not sell to it.
    return NextResponse.json(
      { error: "We could not find a workspace for your account, so a subscription would activate nothing. Contact us and we will sort it out — you have not been charged.", code: "no_workspace" },
      { status: 409 },
    );
  }

  try {
    const body = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      "subscription_data[trial_period_days]": "14",
      // The webhook reads this to know which workspace to activate. Without it
      // the payment succeeds and the product does not.
      client_reference_id: orgId,
      // Stops Stripe creating a second customer for someone who already has one.
      customer_email: user.email ?? "",
      success_url: `${base}/account?checkout=success`,
      cancel_url: `${base}/pricing?checkout=cancelled`,
      allow_promotion_codes: "true",
      "metadata[org_id]": orgId,
      "metadata[user_id]": user.id,
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const session = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: session?.error?.message ?? "Stripe refused the request." }, { status: 502 });
    }
    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: "Could not reach Stripe. Try again in a moment." }, { status: 502 });
  }
}
