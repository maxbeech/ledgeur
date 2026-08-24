// Turning a presented token into an RLS-scoped Supabase client.
//
// The token is an opaque Ledgeur secret (see token.ts). `mcp_tokens` holds only
// its SHA-256, so the plaintext exists in the holder's config and nowhere on
// our side, and revocation is a single boolean.
//
// Two privileged steps happen here and nothing else does:
//
//   1. Look up the hash. `mcp_tokens` is RLS-protected against the very session
//      we are trying to establish, so this read needs the service role. It
//      reads one row and never touches meeting content.
//   2. Ask GoTrue for a session belonging to that row's owner — see session.ts,
//      which explains why this asks rather than forging one.
//
// After that the client is an ordinary authenticated user. Every query runs
// under the RLS policies already written, `auth.uid()` is the token's owner,
// and this server holds no standing authority — a bug in a tool handler cannot
// show somebody another organisation's meetings, because the database would
// refuse.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { looksLikeToken, sha256Hex } from "./token.ts";
import { SessionError, sessionForUser } from "./session.ts";

export class McpAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "McpAuthError";
  }
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
 * route, and a token problem is a 401 rather than a 500.
 */
export async function clientForToken(token: string, env: McpEnv): Promise<SupabaseClient> {
  if (!looksLikeToken(token)) {
    // Rejected on shape, before a database round-trip. The message names the
    // place a real token comes from, because the commonest cause of this is
    // somebody pasting their anon key.
    throw new McpAuthError(
      "That is not a Ledgeur access token. Generate one in Ledgeur under Account, Agent access.",
      401,
    );
  }
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // `profiles` carries the email, and is joined here so establishing the
  // session costs no extra round-trip.
  const { data: row, error } = await admin
    .from("mcp_tokens")
    .select("id, user_id, revoked, profiles!inner(email)")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();

  if (error) throw new McpAuthError("Could not check the access token.", 500);
  // An unknown token and a revoked one get the SAME answer. Distinguishing them
  // would confirm that a token was once real, which is a small oracle and a
  // free one to avoid.
  if (!row || row.revoked) throw new McpAuthError("That access token is not valid.", 401);

  const profile = (row as { profiles?: { email?: string } | { email?: string }[] }).profiles;
  const email = Array.isArray(profile) ? profile[0]?.email : profile?.email;
  if (!email) throw new McpAuthError("That access token's owner no longer exists.", 401);

  let accessToken: string;
  try {
    accessToken = await sessionForUser(row.user_id as string, email, env);
  } catch (e) {
    if (e instanceof SessionError) throw new McpAuthError(e.message, e.status);
    throw e;
  }

  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  // Best effort, and deliberately not awaited into the failure path: a usage
  // timestamp is worth having and never worth failing a request for.
  void admin.from("mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);

  return client;
}
