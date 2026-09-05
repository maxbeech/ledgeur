// Auth/session wiring over Supabase. Two ways in:
//
//  • Email + password — always available when the backend has email auth on.
//  • OAuth (Google or Microsoft/Azure) — personal OR work accounts, requesting
//    calendar read scopes at sign-in so the meeting auto-prompt can see
//    upcoming meetings.
//  • SAML single sign-on — a work email, from which the server works out which
//    identity provider to send them to. Offered only when the project actually
//    has SAML on, for the same reason as the OAuth buttons.
//
// Which OAuth providers exist is a property of the *backend*, not of this app,
// so we ask it (GET /auth/v1/settings) instead of assuming. A provider that
// isn't configured is never offered as a button that silently fails.
//
// No-ops cleanly in local mode.

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./supabase.ts";
import { CONFIG, hasBackend } from "./config.ts";
import {
  authErrorMessage, NO_AUTH, parseAuthSettings, providerUnavailableMessage, ssoDomain,
  type AuthCapabilities, type OAuthProvider,
} from "@ledgeur/core";

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
const SCOPES: Record<OAuthProvider, string> = {
  google: "https://www.googleapis.com/auth/calendar.readonly",
  azure: "Calendars.Read offline_access",
};

let capsPromise: Promise<AuthCapabilities> | null = null;

/**
 * What the backend actually supports. Falls back to "nothing is available"
 * rather than guessing, so the UI stays honest.
 *
 * Only a real answer is cached: a failed lookup (offline, backend down) must
 * not pin the app to "no sign-in available" for the rest of the session, so the
 * next caller retries.
 */
export function authCapabilities(): Promise<AuthCapabilities> {
  if (!hasBackend) return Promise.resolve(NO_AUTH);
  const attempt = (capsPromise ??= fetch(`${CONFIG.supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: CONFIG.supabaseAnonKey },
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`settings ${r.status}`))))
    .then(parseAuthSettings));
  return attempt.catch(() => {
    if (capsPromise === attempt) capsPromise = null;
    return NO_AUTH;
  });
}

/** React hook wrapper around {@link authCapabilities}. */
export function useAuthCapabilities() {
  const [caps, setCaps] = useState<AuthCapabilities | null>(null);
  useEffect(() => { let live = true; void authCapabilities().then((c) => { if (live) setCaps(c); }); return () => { live = false; }; }, []);
  return caps;
}

const client = () => {
  const sb = getSupabase();
  if (!sb) throw new Error("Backend not configured. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.");
  return sb;
};

export async function signInWith(provider: OAuthProvider): Promise<void> {
  const sb = client();
  // Fail with an explanation rather than bouncing the user to a broken redirect.
  const caps = await authCapabilities();
  if (!caps.providers.includes(provider)) throw new Error(providerUnavailableMessage(provider));
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { scopes: SCOPES[provider] } });
  if (error) throw new Error(authErrorMessage(error));
}

/**
 * Start a SAML single sign-on flow for a work email or domain.
 *
 * Supabase returns a redirect URL rather than navigating itself, so the caller
 * gets an explicit failure ("no SSO provider is registered for that domain")
 * instead of a blank page — which is what most SSO attempts actually hit, and
 * is only fixable by an admin who needs to be told which domain failed.
 */
export async function signInWithSso(input: string): Promise<void> {
  const parsed = ssoDomain(input);
  if ("error" in parsed) throw new Error(parsed.error);
  const caps = await authCapabilities();
  if (!caps.sso) throw new Error("This workspace does not have single sign-on switched on. An admin enables SAML in the Supabase project's auth settings.");
  const { data, error } = await client().auth.signInWithSSO({ domain: parsed.domain });
  if (error) throw new Error(authErrorMessage(error));
  if (!data?.url) throw new Error(`No single sign-on provider is registered for ${parsed.domain}.`);
  window.location.assign(data.url);
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(authErrorMessage(error));
}

/**
 * Create an account. Returns true when the session is live immediately, false
 * when the backend still wants an email confirmation first.
 */
export async function signUpWithPassword(email: string, password: string): Promise<boolean> {
  const { data, error } = await client().auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(authErrorMessage(error));
  return Boolean(data.session);
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(email.trim());
  if (error) throw new Error(authErrorMessage(error));
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}
