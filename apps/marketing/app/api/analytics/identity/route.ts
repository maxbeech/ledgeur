import { NextResponse } from "next/server";
import { createLedgeurClient } from "@ledgeur/core";
import { SUPABASE } from "@/lib/site";
import { planFor } from "@/lib/analytics-identity";
import { userRefFor } from "../../../../../../lib/openhelm-analytics-mp";

// The pseudonymous analytics identity of the signed-in caller: the first 16 hex
// characters of SHA-256 over their Supabase user id, plus their plan. The hash
// is computed here so the raw id is never handed to the analytics client.
// Nothing is stored and no email is read.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(header: string | null): string | null {
  const m = /^bearer\s+(.+)$/i.exec((header ?? "").trim());
  return m ? m[1].trim() : null;
}

export async function GET(req: Request) {
  const token = bearer(req.headers.get("authorization"));
  if (!token) return NextResponse.json({ error: "Sign in first.", code: "sign_in_required" }, { status: 401 });

  const asUser = createLedgeurClient(SUPABASE.url, SUPABASE.anonKey, { persistSession: false, accessToken: token });
  const { data, error } = await asUser.auth.getUser(token);
  if (error || !data?.user) {
    return NextResponse.json({ error: "That session has expired.", code: "sign_in_required" }, { status: 401 });
  }

  // Read under the caller's own RLS, like /api/checkout does for membership.
  const { data: org } = await asUser.from("orgs").select("plan").limit(1).maybeSingle();
  const plan = planFor((org as { plan?: string } | null)?.plan);

  return NextResponse.json({ userRef: await userRefFor(data.user.id), plan });
}
