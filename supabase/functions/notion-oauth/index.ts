// Notion OAuth token exchange. The client sends the authorization `code`; we
// exchange it server-side (keeping the Notion client secret off the device) and
// store the resulting token in integration_secrets (service-role only). The
// non-secret workspace info goes in integrations (RLS-readable by the user).
//
// Secrets required (supabase secrets set): NOTION_CLIENT_ID, NOTION_CLIENT_SECRET.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, preflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const { code, redirectUri } = await req.json().catch(() => ({}));
  if (!code || !redirectUri) return json({ error: "code and redirectUri are required" }, 400);

  const clientId = Deno.env.get("NOTION_CLIENT_ID");
  const clientSecret = Deno.env.get("NOTION_CLIENT_SECRET");
  if (!clientId || !clientSecret) return json({ error: "Notion OAuth is not configured on the server." }, 500);

  // Identify the user from their JWT.
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Not authenticated" }, 401);
  const userId = userData.user.id;

  // Exchange the code with Notion.
  const basic = btoa(`${clientId}:${clientSecret}`);
  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  const tok = await tokenRes.json();
  if (!tokenRes.ok) return json({ error: `Notion: ${tok.error ?? tokenRes.status}` }, 400);

  // Persist with the service role (bypasses RLS for the secrets table).
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: member } = await admin.from("org_members").select("org_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!member) return json({ error: "No organisation for this user" }, 400);

  const { data: integ, error: iErr } = await admin
    .from("integrations")
    .upsert(
      {
        org_id: member.org_id, user_id: userId, provider: "notion",
        external_account_id: tok.workspace_id ?? null,
        config: { workspace_name: tok.workspace_name ?? null, bot_id: tok.bot_id ?? null },
      },
      { onConflict: "user_id,provider" },
    )
    .select("id")
    .single();
  if (iErr) return json({ error: iErr.message }, 500);

  const { error: sErr } = await admin.from("integration_secrets").upsert({
    integration_id: integ.id, access_token: tok.access_token, updated_at: new Date().toISOString(),
  });
  if (sErr) return json({ error: sErr.message }, 500);

  return new Response(JSON.stringify({ ok: true, workspaceName: tok.workspace_name ?? null }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
