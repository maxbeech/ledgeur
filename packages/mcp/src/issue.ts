// Issuing, listing and revoking access tokens from a signed-in client.
//
// Both the app and the website show the same "Agent access" panel, so this is
// the one place that knows the shape of the mint endpoint. The plan gate is
// enforced by the edge function, not here — hiding a button is a courtesy, not
// a security boundary — so `upgrade_required` is a normal, expected answer that
// callers render as an upsell rather than an error.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AccessTokenMeta {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

export type IssueResult =
  | { ok: true; token: string; meta: AccessTokenMeta }
  /** The workspace is on the free plan. Not an error — an upsell. */
  | { ok: false; reason: "upgrade_required" }
  | { ok: false; reason: "error"; message: string };

/** The error body the edge function returns. */
function readError(error: unknown): { message: string; code?: string } {
  const err = error as { message?: string; context?: { body?: unknown } } | null;
  const message = err?.message ?? "Could not reach the token service.";
  // supabase-js puts a non-2xx body on `context`. The 402 we care about is in
  // there, and without reading it every free-plan user sees "Edge Function
  // returned a non-2xx status code", which tells them nothing.
  const raw = err?.context?.body;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as { error?: string; code?: string };
      return { message: parsed.error ?? message, code: parsed.code };
    } catch { /* not JSON; fall through */ }
  }
  return { message };
}

/**
 * Mint a token. The plaintext comes back exactly once — it is not recoverable
 * afterwards, because only its hash is stored.
 */
export async function issueAccessToken(sb: SupabaseClient, name?: string): Promise<IssueResult> {
  const { data, error } = await sb.functions.invoke("mcp-token", {
    method: "POST",
    body: { name },
  });
  if (error) {
    const { message, code } = readError(error);
    if (code === "upgrade_required" || /paid plan/i.test(message)) return { ok: false, reason: "upgrade_required" };
    return { ok: false, reason: "error", message };
  }
  const body = data as { token?: string; meta?: AccessTokenMeta };
  if (!body?.token || !body.meta) {
    return { ok: false, reason: "error", message: "The token service returned nothing usable." };
  }
  return { ok: true, token: body.token, meta: body.meta };
}

/** Token metadata for this user. Never includes the secret. */
export async function listAccessTokens(sb: SupabaseClient): Promise<AccessTokenMeta[]> {
  const { data, error } = await sb.functions.invoke("mcp-token", { method: "GET" });
  if (error) return [];
  return ((data as { tokens?: AccessTokenMeta[] })?.tokens ?? []).filter((t) => !t.revoked);
}

/** Revoke a token. Anything holding it stops working immediately. */
export async function revokeAccessToken(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.functions.invoke("mcp-token", { method: "DELETE", body: { id } });
  if (error) throw new Error(readError(error).message);
}
