// Supabase client factory. Runtime-agnostic: the desktop/mobile app, the
// marketing site, and server functions each pass their own URL + key so this
// package never reads env directly (no hidden globals, testable, tree-shakeable).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface LedgeurClientOptions {
  /** Persist the auth session (true in the app; false for one-shot server use). */
  persistSession?: boolean;
  /** Custom storage (e.g. Tauri secure store) for the auth session. */
  storage?: {
    getItem: (key: string) => string | null | Promise<string | null>;
    setItem: (key: string, value: string) => void | Promise<void>;
    removeItem: (key: string) => void | Promise<void>;
  };
  /** A pre-obtained access token (service role or user JWT) for server contexts. */
  accessToken?: string;
}

/**
 * Create a Ledgeur Supabase client.
 * @param url  Supabase project URL (e.g. https://xyz.supabase.co)
 * @param key  anon key (client) or service-role key (trusted server only)
 */
export function createLedgeurClient(
  url: string,
  key: string,
  opts: LedgeurClientOptions = {},
): SupabaseClient {
  if (!url || !key) {
    throw new Error(
      "Supabase URL and key are required. Set LEDGEUR_SUPABASE_URL / LEDGEUR_SUPABASE_ANON_KEY.",
    );
  }
  return createClient(url, key, {
    auth: {
      persistSession: opts.persistSession ?? true,
      autoRefreshToken: opts.persistSession ?? true,
      detectSessionInUrl: false,
      ...(opts.storage ? { storage: opts.storage } : {}),
    },
    global: opts.accessToken
      ? { headers: { Authorization: `Bearer ${opts.accessToken}` } }
      : {},
  });
}

export type { SupabaseClient };
