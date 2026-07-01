// The MCP server authenticates as a specific ParleyNotes user so every query
// runs under that user's RLS — external tools can never see meetings the user
// isn't allowed to see. Preferred: PARLEY_REFRESH_TOKEN (long-lived, auto-
// refreshing). Also supports a short-lived PARLEY_ACCESS_TOKEN.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export async function getClientFromEnv(): Promise<SupabaseClient> {
  const url = process.env.PARLEY_SUPABASE_URL;
  const key = process.env.PARLEY_SUPABASE_ANON_KEY;
  const refreshToken = process.env.PARLEY_REFRESH_TOKEN;
  const accessToken = process.env.PARLEY_ACCESS_TOKEN;
  if (!url || !key) {
    throw new Error("PARLEY_SUPABASE_URL and PARLEY_SUPABASE_ANON_KEY are required.");
  }
  if (!refreshToken && !accessToken) {
    throw new Error(
      "Set PARLEY_REFRESH_TOKEN (recommended) or PARLEY_ACCESS_TOKEN — generate it in the app " +
        "under Integrations → Data access (paid plan).",
    );
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
