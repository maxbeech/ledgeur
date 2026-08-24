// The MCP server authenticates as a specific Ledgeur user, so every query runs
// under that user's row-level security — an external tool can never see
// meetings the user is not allowed to see.
//
// Preferred: LEDGEUR_TOKEN, the opaque access token generated in Ledgeur under
// Account → Agent access. It does not expire on its own, it is revocable from
// the account page, and it is the same token the hosted endpoint takes.
//
// Also accepted, for people who had one working before opaque tokens existed:
//   LEDGEUR_REFRESH_TOKEN — a Supabase refresh token.
//   LEDGEUR_ACCESS_TOKEN  — a short-lived Supabase JWT, mostly useful in CI.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clientForToken, looksLikeToken } from "@ledgeur/mcp";

export async function getClientFromEnv(): Promise<SupabaseClient> {
  const url = process.env.LEDGEUR_SUPABASE_URL;
  const key = process.env.LEDGEUR_SUPABASE_ANON_KEY;
  const token = process.env.LEDGEUR_TOKEN;
  const refreshToken = process.env.LEDGEUR_REFRESH_TOKEN;
  const accessToken = process.env.LEDGEUR_ACCESS_TOKEN;

  if (!url || !key) {
    throw new Error("LEDGEUR_SUPABASE_URL and LEDGEUR_SUPABASE_ANON_KEY are required.");
  }
  if (!token && !refreshToken && !accessToken) {
    throw new Error(
      "Set LEDGEUR_TOKEN — generate one in Ledgeur under Account → Agent access (paid plan).",
    );
  }

  if (token) {
    if (!looksLikeToken(token)) {
      throw new Error(
        "LEDGEUR_TOKEN does not look like a Ledgeur access token (they start with 'ldg_'). " +
          "Generate one under Account → Agent access.",
      );
    }
    const serviceRoleKey = process.env.LEDGEUR_SUPABASE_SERVICE_ROLE_KEY;
    const jwtSecret = process.env.LEDGEUR_SUPABASE_JWT_SECRET;
    if (!serviceRoleKey || !jwtSecret) {
      // Exchanging a token for a session is a privileged operation. On a
      // self-hosted deployment the operator has these; on ours they live on the
      // server, which is exactly why the hosted endpoint exists.
      throw new Error(
        "Redeeming a LEDGEUR_TOKEN locally needs LEDGEUR_SUPABASE_SERVICE_ROLE_KEY and " +
          "LEDGEUR_SUPABASE_JWT_SECRET. If you are not self-hosting, point your MCP client at " +
          "the hosted endpoint instead — it needs no process and no keys.",
      );
    }
    return clientForToken(token, { supabaseUrl: url, anonKey: key, serviceRoleKey, jwtSecret });
  }

  if (accessToken && !refreshToken) {
    // Use the access token directly; RLS applies via this JWT for its lifetime.
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const { error } = await client.auth.refreshSession({ refresh_token: refreshToken! });
  if (error) throw new Error(`Failed to authenticate with refresh token: ${error.message}`);
  return client;
}
