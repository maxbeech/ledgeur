// Account card — real sign-in, real state. Email + password is the always-there
// path; OAuth buttons appear only for providers the backend actually has
// configured (asked at runtime), so nothing on screen is a dead end.

import { useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { LogIn, LogOut, Building2 } from "lucide-react";
import { Avatar, Badge, Button, Card, ErrorNote, Input, Notice, Spinner } from "../ui.tsx";
import { hasBackend } from "../../lib/config.ts";
import {
  sendPasswordReset, signInWith, signInWithPassword, signInWithSso, signOut, signUpWithPassword, useAuthCapabilities,
} from "../../lib/session.ts";
import {
  hasNoAuthMethod, PROVIDER_LABELS, signUpNextStep, validateCredentials, type OAuthProvider,
} from "@ledgeur/core";

type Mode = "signin" | "signup";

export function AccountCard({ session }: { session: Session | null }) {
  const caps = useAuthCapabilities();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sso, setSso] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const invalid = validateCredentials(email, password);
    if (invalid) { setError(invalid); setNotice(""); return; }
    void run(async () => {
      if (mode === "signin") { await signInWithPassword(email, password); return; }
      const live = await signUpWithPassword(email, password);
      // `useSession` picks up a live session on its own; otherwise say what's next.
      if (!live && caps) setNotice(signUpNextStep(caps));
    });
  };

  const onReset = () => {
    if (!email.trim()) { setError("Enter your email address first, then choose “Forgot password”."); return; }
    void run(async () => {
      await sendPasswordReset(email);
      setNotice("If that address has an account, a reset link is on its way.");
    });
  };

  const onOAuth = (p: OAuthProvider) => void run(() => signInWith(p));

  const onSso = (e: FormEvent) => {
    e.preventDefault();
    void run(() => signInWithSso(sso));
  };

  if (session) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <Avatar name={session.user.email ?? "You"} size="lg" />
          <div>
            <div className="text-base font-semibold text-ink-text">{session.user.email}</div>
            <div className="mt-0.5 flex items-center gap-2 text-sm text-muted">Signed in <Badge tone="accent">Syncing</Badge></div>
          </div>
        </div>
        <Button tone="secondary" onClick={() => void signOut()}><LogOut className="h-4 w-4" /> Sign out</Button>
      </Card>
    );
  }

  if (!hasBackend) {
    return (
      <Card className="p-5">
        <div className="text-base font-semibold text-ink-text">Sign in to sync across your devices</div>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">Configure the Supabase backend to enable sign-in.</p>
      </Card>
    );
  }

  if (!caps) {
    return (
      <Card className="flex items-center gap-3 p-5 text-sm text-muted">
        <Spinner className="h-4 w-4" /> Checking which sign-in methods this workspace supports
      </Card>
    );
  }

  if (hasNoAuthMethod(caps)) {
    return (
      <Card className="p-5">
        <div className="text-base font-semibold text-ink-text">Sign-in isn't available yet</div>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
          This backend has no sign-in method enabled. An admin needs to switch on email
          or an OAuth provider in the Supabase project's auth settings.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="text-base font-semibold text-ink-text">Sign in to sync across your devices</div>
      <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
        Meetings recorded on your laptop appear on your phone, and the other way round. Recordings stay on the device unless you sync them.
      </p>

      {/* noValidate: without it the native constraint tooltip intercepts
          submit for a malformed address, so our own message never appears and
          `validateCredentials` never runs. */}
      {caps.email && (
        <form onSubmit={onSubmit} noValidate className="mt-4 max-w-md space-y-2.5">
          <Input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email" placeholder="you@company.com" disabled={busy} aria-label="Email"
          />
          <Input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder="Password" disabled={busy} aria-label="Password"
          />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="submit" disabled={busy || (mode === "signup" && !caps.signupsAllowed)}>
              {busy ? <Spinner className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            {caps.signupsAllowed && (
              <Button type="button" tone="ghost" size="sm" disabled={busy}
                onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setNotice(""); }}>
                {mode === "signin" ? "Create an account" : "I already have an account"}
              </Button>
            )}
            {mode === "signin" && (
              <Button type="button" tone="ghost" size="sm" disabled={busy} onClick={onReset}>Forgot password</Button>
            )}
          </div>
        </form>
      )}

      {caps.providers.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {caps.email && <span className="text-sm text-muted">or</span>}
          {caps.providers.map((p) => (
            <Button key={p} tone="secondary" disabled={busy} onClick={() => onOAuth(p)}>
              <LogIn className="h-4 w-4" /> {PROVIDER_LABELS[p]}
            </Button>
          ))}
        </div>
      )}

      {/* SSO is its own form rather than another button: there is no provider
          to pick, the server resolves the identity provider from the domain. */}
      {caps.sso && (
        <form onSubmit={onSso} noValidate className="mt-4 max-w-md">
          <div className="mb-1.5 flex items-center gap-1.5 text-sm text-muted">
            <Building2 className="h-4 w-4" /> Your company uses single sign-on?
          </div>
          <div className="flex gap-2">
            <Input
              type="email" value={sso} onChange={(e) => setSso(e.target.value)}
              autoComplete="email" placeholder="you@company.com" disabled={busy}
              aria-label="Work email address for single sign-on"
            />
            <Button type="submit" tone="secondary" disabled={busy}>
              {busy ? <Spinner className="h-4 w-4" /> : <LogIn className="h-4 w-4" />} Continue
            </Button>
          </div>
        </form>
      )}

      {notice && <Notice tone="accent" className="mt-3">{notice}</Notice>}
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
    </Card>
  );
}
