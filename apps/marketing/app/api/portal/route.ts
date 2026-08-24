import { NextResponse } from "next/server";
import { createLedgeurClient } from "@ledgeur/core";
import { SITE, SUPABASE } from "@/lib/site";

// The Stripe billing portal: change the card, see invoices, cancel.
//
// A subscription that can be started in two clicks and only cancelled by
// emailing support is a dark pattern. This route is the other half of
// /api/checkout, and it is deliberately as easy to reach.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(header: string | null): string | null {
  const m = /^bearer\s+(.+)$/i.exec((header ?? "").trim());
  return m ? m[1].trim() : null;
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? SITE.url;
  if (!secret) {
    return NextResponse.json({ error: "Billing is not configured on this deployment." }, { status: 503 });
  }

  const token = bearer(req.headers.get("authorization"));
  if (!token) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const asUser = createLedgeurClient(SUPABASE.url, SUPABASE.anonKey, { persistSession: false, accessToken: token });
  const { data: userData, error: userErr } = await asUser.auth.getUser(token);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "That session has expired. Sign in again." }, { status: 401 });
  }

  // Read the customer id through the caller's own RLS — a user can see their
  // own org, and nobody else's.
  const { data: member } = await asUser
    .from("org_members").select("org_id").eq("user_id", userData.user.id).limit(1).maybeSingle();
  const orgId = (member as { org_id?: string } | null)?.org_id;
  if (!orgId) return NextResponse.json({ error: "No workspace found for your account." }, { status: 409 });

  const { data: org } = await asUser.from("orgs").select("stripe_customer_id").eq("id", orgId).maybeSingle();
  const customer = (org as { stripe_customer_id?: string | null } | null)?.stripe_customer_id;
  if (!customer) {
    return NextResponse.json(
      { error: "There is no subscription on this workspace yet, so there is nothing to manage.", code: "no_subscription" },
      { status: 409 },
    );
  }

  try {
    const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ customer, return_url: `${base}/account` }),
    });
    const session = await res.json();
    if (!res.ok) return NextResponse.json({ error: session?.error?.message ?? "Stripe refused the request." }, { status: 502 });
    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: "Could not reach Stripe. Try again in a moment." }, { status: 502 });
  }
}
