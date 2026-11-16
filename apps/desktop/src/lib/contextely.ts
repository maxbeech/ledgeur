// Contextely integration (client side). Contextely is Beech's other product —
// the company's shared knowledge base: collections, records and pages that people
// and their AI tools share, plus what's synced in from Notion, Drive, Postgres and
// MCP sources. Connecting it here gives Ask and the copilot the company's
// knowledge, limited to what the person who owns the key can see in Contextely,
// alongside Ledgeur's own local meetings (the same way notion.ts adds Notion pages).
//
// No OAuth: the user pastes a personal Contextely API key (ctx_sk_...) from
// their Contextely dashboard. The key never reaches this device's storage —
// it's verified (GET /api/v1/me) and kept server-side (contextely-connect), same
// as every other integration's secret. Context comes from the v2 `search` tool and
// `record_get` for the top hits (contextely-context).

import { getSupabase } from "./supabase.ts";
import type { ContextBlock } from "./chat.ts";

/** Where to get a key, so the UI can link there directly. */
export const CONTEXTELY_SIGNUP_URL = "https://www.contextely.com";
/**
 * Where a Contextely admin adds Ledgeur as a source — the other direction of
 * the integration, in which meetings become company memory. Contextely ingests
 * over MCP and ships a Ledgeur preset (`list_meetings` / `get_meeting`), so
 * nothing is pushed from this app; Contextely pulls, condenses and refreshes on
 * its own schedule under its own entitlement rules.
 */
export const CONTEXTELY_SOURCES_URL = "https://www.contextely.com/sources";

export async function isContextelyConnected(): Promise<boolean> {
  return (await contextelyConnection()).connected;
}

/** Whether Contextely is connected, and the workspace name verified at connect time. */
export async function contextelyConnection(): Promise<{ connected: boolean; workspace: string | null }> {
  const sb = getSupabase();
  if (!sb) return { connected: false, workspace: null };
  const { data } = await sb.from("integrations").select("id, config").eq("provider", "contextely").maybeSingle();
  if (!data) return { connected: false, workspace: null };
  const name = (data.config as { workspace_name?: unknown } | null)?.workspace_name;
  return { connected: true, workspace: typeof name === "string" && name ? name : null };
}

/** Verify and store a Contextely API key. Throws with Contextely's own
 *  rejection reason (bad key, wrong host, ...) so the user can fix it. */
export async function connectContextely(apiKey: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sign in first.");
  const { data, error } = await sb.functions.invoke("contextely-connect", { body: { apiKey } });
  if (error) throw new Error(error.message);
  if (!(data as { ok?: boolean })?.ok) throw new Error("Contextely did not confirm the connection.");
}

export async function disconnectContextely(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("integrations").delete().eq("provider", "contextely");
  if (error) throw new Error(error.message);
}

/** Contextely records matching the question (search, then the top hits in full),
 *  as Ask context. Never throws — no connection or a Contextely error just means no Contextely
 *  context, not a broken Ask. */
export async function contextelyContext(question: string): Promise<ContextBlock[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb.functions.invoke("contextely-context", { body: { query: question } });
    if (error || !(data as { ok?: boolean })?.ok) return [];
    return (data as { blocks?: ContextBlock[] }).blocks ?? [];
  } catch {
    return [];
  }
}
