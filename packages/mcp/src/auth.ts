// Turning a presented token into an RLS-scoped Supabase client.
//
// The token IS a Supabase refresh token. `supabase/functions/mcp-token` mints
// one on the paid plan and records only its SHA-256 in `mcp_tokens`, so the
// plaintext exists in the holder's config and nowhere on our side. That is what
// lets every query run as the user rather than as a service role: the MCP
// server has no privileges of its own, so a bug in it cannot show somebody
// another org's meetings.
//
// The hash lookup needs the service role, because `mcp_tokens` is RLS-protected
// against the very session we are trying to establish. That is the one
// privileged step, it reads one row, and it never touches meeting content.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class McpAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "McpAuthError";
  }
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Pull the bearer token out of an Authorization header. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export interface McpEnv {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

/**
 * Resolve a token to a client that speaks as its owner.
 *
 * Throws McpAuthError with a status, never a bare Error: the caller is an HTTP
 * route and a token problem is a 401, not a 500.
 */
export async function clientForToken(token: string, env: McpEnv): Promise<SupabaseClient> {
  const hash = await sha256Hex(token);

  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: row, error } = await admin
    .from("mcp_tokens")
    .select("id, revoked")
    .eq("token_hash", hash)
    .maybeSingle();

  if (error) throw new McpAuthError("Could not check the access token.", 500);
  // An unknown token and a revoked one get the SAME answer. Distinguishing them
  // would confirm that a token was once real, which is a small oracle and a
  // free one to avoid.
  if (!row || row.revoked) throw new McpAuthError("That access token is not valid.", 401);

  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: refreshError } = await client.auth.refreshSession({ refresh_token: token });
  if (refreshError) {
    throw new McpAuthError(
      "That access token has expired. Generate a new one in Ledgeur under Integrations, Data access.",
      401,
    );
  }

  // Best effort, and deliberately not awaited into the failure path: a usage
  // timestamp is worth having and never worth failing a request for.
  void admin.from("mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);

  return client;
}
