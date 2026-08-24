"use client";

// The signed-in user, as a hook.
//
// Deliberately small: the web app is local-first, so almost nothing depends on
// this. Being signed out is a normal, fully-functional state — not a gate — and
// `loading` exists so the UI never flashes "Sign in" at somebody who is already
// signed in.

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, hasBackend } from "./supabase";

export interface SessionState {
  session: Session | null;
  loading: boolean;
  /** False when this deployment has no backend at all — the UI then hides
   *  account features rather than offering buttons that cannot work. */
  available: boolean;
}

export function useSession(): SessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setLoading(false); return; }
    let live = true;
    sb.auth.getSession().then(({ data }) => {
      if (!live) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = sb.auth.onAuthStateChange((_event, next) => { if (live) setSession(next); });
    return () => { live = false; data.subscription.unsubscribe(); };
  }, []);

  return { session, loading, available: hasBackend };
}
