// Plan-gated MCP access issuance. The MCP server authenticates as the user via
// their Supabase refresh token (RLS-correct, auto-refreshing). This function
// enforces the paid gate and records an issuance row for audit/revocation.
// POST  -> mint (records issuance)   DELETE -> revoke (by id)

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const authHeader = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Not authenticated" }, 401);
  const userId = userData.user.id;

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: member } = await admin.from("org_members").select("org_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!member) return json({ error: "No organisation for this user" }, 400);

  if (req.method === "DELETE") {
    const { id } = await req.json().catch(() => ({}));
    if (!id) return json({ error: "id required" }, 400);
    await admin.from("mcp_tokens").update({ revoked: true }).eq("id", id).eq("user_id", userId);
    return json({ ok: true });
  }
  if (req.method !== "POST") return json({ error: "POST/DELETE only" }, 405);

  // Enforce the paid gate.
  const { data: paid } = await admin.rpc("org_is_paid", { p_org: member.org_id });
  if (!paid) return json({ error: "MCP data access requires a paid plan.", code: "upgrade_required" }, 402);

  const { name, refreshTokenHash } = await req.json().catch(() => ({}));
  const tokenHash = refreshTokenHash || (await sha256Hex(crypto.randomUUID() + userId));
  const { data: row, error } = await admin
    .from("mcp_tokens")
    .insert({ user_id: userId, org_id: member.org_id, token_hash: tokenHash, name: name || "MCP token" })
    .select("id, name, created_at")
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, token: row });
});
