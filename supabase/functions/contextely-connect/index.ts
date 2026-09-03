// Store a user's Contextely API key after validating it against Contextely's
// own API. Contextely is the company's shared memory layer — Notion, Drive,
// Postgres and anything else the org has connected there, condensed into one
// searchable place; connecting it here lets Ask/the copilot draw on it,
// alongside Ledgeur's own local meeting knowledge.
//
// Unlike Notion this isn't OAuth: Contextely issues a personal bearer key
// (ctx_sk_...) from its own dashboard, so this just verifies the key actually
// works and stores it — same integrations/integration_secrets tables, same
// service-role-only access, as every other provider.
//
// Env (supabase secrets set): CONTEXTELY_BASE_URL (optional — defaults to the
// hosted API; point it at a self-hosted instance instead if that's what the
// org runs).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, preflight } from "../_shared/cors.ts";

const BASE_URL = (Deno.env.get("CONTEXTELY_BASE_URL") ?? "https://www.contextely.com/api/v1").replace(/\/+$/, "");

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const { apiKey } = await req.json().catch(() => ({}));
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return json({ error: "apiKey is required" }, 400);
  }
  const key = apiKey.trim();

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Not authenticated" }, 401);
  const userId = userData.user.id;

  // Verify the key actually works before storing it — a typo'd or revoked key
  // would otherwise silently "connect" to nothing.
  let checkRes: Response;
  try {
    checkRes = await fetch(`${BASE_URL}/usage`, { headers: { Authorization: `Bearer ${key}` } });
  } catch {
    return json({ error: "Could not reach Contextely. Check CONTEXTELY_BASE_URL and try again." }, 502);
  }
  if (!checkRes.ok) {
    const detail = await checkRes.json().catch(() => null) as { error?: { message?: string } } | null;
    return json({ error: detail?.error?.message ?? `Contextely rejected this key (${checkRes.status}).` }, 400);
  }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: member } = await admin.from("org_members").select("org_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!member) return json({ error: "No organisation for this user" }, 400);

  const { data: integ, error: iErr } = await admin
    .from("integrations")
    .upsert(
      { org_id: member.org_id, user_id: userId, provider: "contextely", external_account_id: null, config: {} },
      { onConflict: "user_id,provider" },
    )
    .select("id")
    .single();
  if (iErr) return json({ error: iErr.message }, 500);

  const { error: sErr } = await admin.from("integration_secrets").upsert({
    integration_id: integ.id, access_token: key, updated_at: new Date().toISOString(),
  });
  if (sErr) return json({ error: sErr.message }, 500);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
