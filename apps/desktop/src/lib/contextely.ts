// Contextely integration (client side). Contextely is Beech's other product —
// the shared context layer that condenses everything a company knows (Notion,
// Drive, Postgres, MCP sources...) into one searchable memory, scored by the
// asker's own entitlement. Connecting it here means Ask and the copilot draw
// on that company-wide memory alongside Ledgeur's own local meetings, the same
// way notion.ts adds Notion pages.
//
// No OAuth: the user pastes a personal Contextely API key (ctx_sk_...) from
// their Contextely dashboard. The key never reaches this device's storage —
// it's validated and kept server-side (contextely-connect), same as every
// other integration's secret.

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
  const sb = getSupabase();
  if (!sb) return false;
  const { data } = await sb.from("integrations").select("id").eq("provider", "contextely").maybeSingle();
  return Boolean(data);
}

/** Validate and store a Contextely API key. Throws with Contextely's own
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

/** Contextely memory objects matching the question, as Ask context. Never
 *  throws — no connection or a Contextely error just means no Contextely
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
