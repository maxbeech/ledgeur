// The browser Supabase client for the web app and the auth pages.
//
// Created through @ledgeur/core so the site and the desktop app talk to the
// backend through one configured client — same session handling, same
// auto-refresh. Returns null when the deployment has no backend configured, so
// every caller has to decide what "local only" means rather than crashing on a
// missing variable.
//
// `detectSessionInUrl` is off in the shared factory, which is correct: this app
// handles the auth fragment itself in /auth/callback, deliberately, because
// that page has to explain an expired link rather than silently failing.

import { createLedgeurClient, type SupabaseClient } from "@ledgeur/core";
import { SUPABASE } from "./site";

let client: SupabaseClient | null = null;

/** Whether accounts are available at all on this deployment. */
export const hasBackend = Boolean(SUPABASE.url && SUPABASE.anonKey);

export function getSupabase(): SupabaseClient | null {
  if (typeof window === "undefined" || !hasBackend) return null;
  client ??= createLedgeurClient(SUPABASE.url, SUPABASE.anonKey, { persistSession: true });
  return client;
}
