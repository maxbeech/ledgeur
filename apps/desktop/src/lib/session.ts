// Auth/session wiring over Supabase. OAuth with Google or Microsoft (Azure) —
// personal OR work accounts — requesting calendar read scopes at sign-in so the
// meeting auto-prompt can see upcoming meetings. No-ops cleanly in local mode.

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./supabase.ts";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setLoading(false); return; }
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  return { session, loading };
}

/** Calendar read scopes so we can prompt to record when a meeting starts. */
const SCOPES: Record<"google" | "azure", string> = {
  google: "https://www.googleapis.com/auth/calendar.readonly",
  azure: "Calendars.Read offline_access",
};

export async function signInWith(provider: "google" | "azure"): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Backend not configured. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.");
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: { scopes: SCOPES[provider] },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}
