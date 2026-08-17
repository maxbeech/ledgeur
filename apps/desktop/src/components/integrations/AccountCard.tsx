// Account card — real sign-in, real state. Email + password is the always-there
// path; OAuth buttons appear only for providers the backend actually has
// configured (asked at runtime), so nothing on screen is a dead end.

import { useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { LogIn, LogOut, Mail } from "lucide-react";
import { Button, Card, ErrorNote, Spinner } from "../ui.tsx";
import { hasBackend } from "../../lib/config.ts";
import {
  sendPasswordReset, signInWith, signInWithPassword, signOut, signUpWithPassword, useAuthCapabilities,
} from "../../lib/session.ts";
import {
  hasNoAuthMethod, PROVIDER_LABELS, signUpNextStep, validateCredentials, type OAuthProvider,
} from "../../lib/authMessages.ts";

type Mode = "signin" | "signup";

export function AccountCard({ session }: { session: Session | null }) {
  const caps = useAuthCapabilities();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  if (session) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-accent/70 to-glow/60 font-mono text-[13px] font-semibold uppercase text-white">
            {session.user.email?.slice(0, 2) ?? "LG"}
          </span>
          <div>
            <div className="text-sm font-medium text-ink-text">{session.user.email}</div>
            <div className="text-xs text-muted">Signed in · syncing to your company brain</div>
          </div>
        </div>
        <Button variant="outline" onClick={() => void signOut()}><LogOut className="h-4 w-4" /> Sign out</Button>
      </Card>
    );
  }

  if (!hasBackend) {
    return (
      <Card className="p-5">
        <div className="text-sm font-medium text-ink-text">Sign in to sync &amp; unlock the hive mind</div>
        <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted">
          Configure the Supabase backend to enable sign-in.
        </p>
      </Card>
    );
  }

  if (!caps) {
    return (
      <Card className="flex items-center gap-3 p-5 text-sm text-muted">
        <Spinner className="h-4 w-4" /> Checking which sign-in methods this workspace supports…
      </Card>
    );
  }

  if (hasNoAuthMethod(caps)) {
    return (
      <Card className="p-5">
        <div className="text-sm font-medium text-ink-text">Sign-in isn’t available yet</div>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">
          This backend has no sign-in method enabled. An admin needs to switch on email
          or an OAuth provider in the Supabase project’s auth settings.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="text-sm font-medium text-ink-text">Sign in to sync &amp; unlock the hive mind</div>
      <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted">
        Use a personal or work account. Recordings stay on your device unless you sync them.
      </p>

      {/* noValidate: without it Chrome's native constraint tooltip intercepts
          submit for a malformed address, so our own (styled, consistent)
          message never appears and `validateCredentials` never runs. Keeping
          validation in one place means every field fails the same way. */}
      {caps.email && (
        <form onSubmit={onSubmit} noValidate className="mt-4 max-w-md space-y-2">
          <label className="block">
            <span className="sr-only">Email</span>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="email" placeholder="you@company.com" disabled={busy}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-text outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="sr-only">Password</span>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder="Password" disabled={busy}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-text outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="submit" disabled={busy || (mode === "signup" && !caps.signupsAllowed)}>
              {busy ? <Spinner className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            {caps.signupsAllowed && (
              <button
                type="button" disabled={busy}
                onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setNotice(""); }}
                className="text-xs text-muted underline underline-offset-2 hover:text-ink-text"
              >
                {mode === "signin" ? "Create an account" : "I already have an account"}
              </button>
            )}
            {mode === "signin" && (
              <button type="button" disabled={busy} onClick={onReset}
                className="text-xs text-muted underline underline-offset-2 hover:text-ink-text">
                Forgot password
              </button>
            )}
          </div>
        </form>
      )}

      {caps.providers.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {caps.email && <span className="text-xs text-muted">or</span>}
          {caps.providers.map((p) => (
            <Button key={p} variant="outline" disabled={busy} onClick={() => onOAuth(p)}>
              <LogIn className="h-4 w-4" /> {PROVIDER_LABELS[p]}
            </Button>
          ))}
        </div>
      )}

      {notice && <p className="mt-3 text-xs leading-relaxed text-accent-strong">{notice}</p>}
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
    </Card>
  );
}
