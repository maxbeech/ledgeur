// Issuing and revoking Ledgeur access tokens — the paid "agent access" tier.
//
// A token is an opaque secret. We store only its SHA-256, so the plaintext is
// returned exactly once, at mint, and cannot be recovered afterwards: if the
// holder loses it they mint a new one and revoke the old.
//
// The previous version of this function accepted a `refreshTokenHash` from the
// caller and, when absent, recorded the hash of a random UUID nobody would ever
// present. Every token it issued was therefore unusable. The token is now
// generated here, which is the only place that can honestly promise the
// plaintext was never stored.
//
//   POST   -> mint (returns the plaintext once)
//   DELETE -> revoke by id
//   GET    -> list this user's tokens (metadata only, never the secret)

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

const TOKEN_BYTES = 32;
const TOKEN_PREFIX = "ldg_";

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(buf));
}

function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return `${TOKEN_PREFIX}${hex(bytes)}`;
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
  const { data: member } = await admin
    .from("org_members").select("org_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!member) return json({ error: "No workspace for this user" }, 400);

  // Listing is metadata only — deliberately no token_hash, which would be a
  // free offline-cracking target for a short secret and is useless to the user.
  if (req.method === "GET") {
    const { data } = await admin
      .from("mcp_tokens")
      .select("id, name, created_at, last_used_at, revoked")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    return json({ tokens: data ?? [] });
  }

  if (req.method === "DELETE") {
    const { id } = await req.json().catch(() => ({}));
    if (!id) return json({ error: "id required" }, 400);
    // Scoped to this user, so an id from someone else's account revokes nothing.
    await admin.from("mcp_tokens").update({ revoked: true }).eq("id", id).eq("user_id", userId);
    return json({ ok: true });
  }

  if (req.method !== "POST") return json({ error: "GET/POST/DELETE only" }, 405);

  // The paid gate, enforced server-side. The UI also hides the button, but the
  // UI is not a security boundary.
  const { data: paid } = await admin.rpc("org_is_paid", { p_org: member.org_id });
  if (!paid) {
    return json({ error: "Agent access requires a paid plan.", code: "upgrade_required" }, 402);
  }

  const { name } = await req.json().catch(() => ({}));
  const token = generateToken();
  const { data: row, error } = await admin
    .from("mcp_tokens")
    .insert({
      user_id: userId,
      org_id: member.org_id,
      token_hash: await sha256Hex(token),
      name: (typeof name === "string" && name.trim()) || "Agent access token",
    })
    .select("id, name, created_at")
    .single();
  if (error) return json({ error: error.message }, 500);

  // The one and only time the plaintext leaves this function.
  return json({ ok: true, token, meta: row });
});
