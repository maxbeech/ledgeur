// Store a user's Contextely API key after verifying it against Contextely's own
// API (`GET /v1/me`). Contextely is the company's knowledge base: connecting it
// here gives Ask and the copilot the company's knowledge, limited to what the key's
// person can see in Contextely, alongside Ledgeur's own local meeting knowledge.
//
// Unlike Notion this isn't OAuth: Contextely issues a personal bearer key
// (ctx_sk_...) from its own dashboard, so this just verifies the key actually
// works and stores it, in the same integrations/integration_secrets tables with
// the same service-role-only access as every other provider. The workspace name
// `/me` returns is kept in `integrations.config` so the card can say what is
// connected without another round trip.
//
// Env (supabase secrets set): CONTEXTELY_BASE_URL (optional; defaults to the
// hosted API, `https://www.contextely.com/api/v1`. Point it at a self-hosted
// instance instead if that's what the org runs).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, preflight } from "../_shared/cors.ts";
import { contextelyBaseUrl, ContextelyHttpError, verifyKey } from "../_shared/contextely.ts";

const BASE_URL = contextelyBaseUrl(Deno.env.get("CONTEXTELY_BASE_URL"));

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

  // Verify the key actually works before storing it (GET /v1/me) — a typo'd or
  // revoked key would otherwise silently "connect" to nothing.
  let workspace: { workspaceId: string | null; workspaceName: string | null };
  try {
    workspace = await verifyKey(BASE_URL, key);
  } catch (e) {
    if (e instanceof ContextelyHttpError && e.status === null) {
      return json({ error: "Could not reach Contextely. Check CONTEXTELY_BASE_URL and try again." }, 502);
    }
    return json({ error: e instanceof Error ? e.message : "Contextely rejected this key." }, 400);
  }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: member } = await admin.from("org_members").select("org_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!member) return json({ error: "No organisation for this user" }, 400);

  const { data: integ, error: iErr } = await admin
    .from("integrations")
    .upsert(
      { org_id: member.org_id, user_id: userId, provider: "contextely", external_account_id: workspace.workspaceId, config: { workspace_name: workspace.workspaceName } },
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
