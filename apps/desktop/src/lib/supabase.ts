// App-wide Supabase client, created once from runtime config. Null when the
// backend isn't configured yet, so callers can branch to local-only behaviour.

import { createParleyClient, type SupabaseClient } from "@parleynotes/core";
import { CONFIG, hasBackend } from "./config.ts";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!hasBackend) return null;
  if (!client) {
    client = createParleyClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      persistSession: true,
    });
  }
  return client;
}
