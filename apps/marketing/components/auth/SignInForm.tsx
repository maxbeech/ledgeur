"use client";

// Sign in / create an account.
//
// Two rules shape this form:
//
//  1. It never offers a button that cannot work. Which methods exist is a
//     property of the *backend*, so it asks (GET /auth/v1/settings) rather than
//     assuming. A deployment with email auth switched off shows that, instead of
//     a form that fails on submit.
//  2. Failures are explained in the user's terms using the shared wording from
//     @ledgeur/core — the same sentences the desktop app shows, because they
//     are the same account.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  authErrorMessage, hasNoAuthMethod, NO_AUTH, parseAuthSettings, signUpNextStep,
  validateCredentials, MIN_PASSWORD_LENGTH, type AuthCapabilities,
} from "@ledgeur/core";
import { Button, Card, ErrorNote } from "@ledgeur/ui/components";
import { getSupabase, hasBackend } from "@/lib/supabase";
import { SITE, SUPABASE } from "@/lib/site";

type Mode = "signin" | "signup" | "reset";

export default function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Where to go once signed in. Relative paths only — an open redirect here
  // would turn the sign-in page into a phishing tool.
  const raw = params.get("next") ?? "/app";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/app";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [caps, setCaps] = useState<AuthCapabilities | null>(null);

  // Ask the backend what it supports. A failure here means "we do not know",
  // which is shown as such rather than as "nothing works".
  const [capsFailed, setCapsFailed] = useState(false);
  useEffect(() => {
    if (!hasBackend) { setCaps(NO_AUTH); return; }
    let live = true;
    fetch(`${SUPABASE.url}/auth/v1/settings`, { headers: { apikey: SUPABASE.anonKey } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((raw) => { if (live) setCaps(parseAuthSettings(raw)); })
      .catch(() => { if (live) { setCaps(NO_AUTH); setCapsFailed(true); } });
    return () => { live = false; };
  }, []);

  // Already signed in? Do not make them do it again.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    sb.auth.getSession().then(({ data }) => { if (live && data.session) router.replace(next); });
    return () => { live = false; };
  }, [router, next]);

  const submit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(""); setNotice("");

    const sb = getSupabase();
    if (!sb) { setError("This deployment has no account backend configured."); return; }

    if (mode !== "reset") {
      const invalid = validateCredentials(email, password);
      if (invalid) { setError(invalid); return; }
    } else if (!email.trim()) {
      setError("Enter your email address."); return;
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: err } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
        router.replace(next);
        return;
      }
      if (mode === "signup") {
        const { error: err } = await sb.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${SITE.url}/auth/callback` },
        });
        if (err) throw err;
        // Whether they are signed in already depends on the project's confirm
        // setting, so the message asks the backend rather than guessing.
        const step = signUpNextStep(caps ?? NO_AUTH);
        if (caps?.autoConfirm) { router.replace(next); return; }
        setNotice(step);
        return;
      }
      const { error: err } = await sb.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${SITE.url}/auth/callback`,
      });
      if (err) throw err;
      setNotice("If that address has an account, a reset link is on its way. It expires quickly, so open it soon.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [mode, email, password, caps, router, next]);

  if (caps && hasNoAuthMethod(caps)) {
    return (
      <Card raised className="p-7">
        <h2 className="ldg-display text-[20px] text-ink-text">Accounts are not available here</h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
          {capsFailed
            ? "We could not reach the account server, so we cannot show you a sign-in form that would work. Check your connection and reload."
            : "This deployment has no sign-in method configured. Ledgeur still records, transcribes and stores meetings entirely on your device."}
        </p>
        <Link href="/app" className="mt-5 inline-block text-[14px] font-medium text-accent-strong hover:underline">
          Use Ledgeur without an account →
        </Link>
      </Card>
    );
  }

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create an account" : "Reset your password";

  return (
    <Card raised className="p-7">
      <h2 className="ldg-display text-[22px] text-ink-text">{title}</h2>
      {mode === "signup" && caps && !caps.signupsAllowed && (
        <p className="mt-3 text-[14px] text-warn">New accounts are disabled on this workspace.</p>
      )}

      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        <Field
          label="Email" type="email" value={email} onChange={setEmail}
          autoComplete="email" disabled={busy}
        />
        {mode !== "reset" && (
          <Field
            label="Password" type="password" value={password} onChange={setPassword}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            disabled={busy}
            hint={mode === "signup" ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
          />
        )}

        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {busy ? "Working…" : title}
        </Button>

        {error && <ErrorNote>{error}</ErrorNote>}
        {notice && (
          <p role="status" className="rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 text-[14px] text-accent-strong">
            {notice}
          </p>
        )}
      </form>

      <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-hairline pt-5 text-[13.5px]">
        {mode !== "signin" && <Switch onClick={() => { setMode("signin"); setError(""); setNotice(""); }}>Sign in instead</Switch>}
        {mode !== "signup" && <Switch onClick={() => { setMode("signup"); setError(""); setNotice(""); }}>Create an account</Switch>}
        {mode !== "reset" && <Switch onClick={() => { setMode("reset"); setError(""); setNotice(""); }}>Forgot your password?</Switch>}
      </div>

      <p className="mt-5 text-[12.5px] leading-relaxed text-faint">
        Signing in syncs the meetings you choose to sync. Your voice prints are never uploaded —
        they stay in this browser, on this device.
      </p>
    </Card>
  );
}

function Switch({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="font-medium text-accent-strong hover:underline">
      {children}
    </button>
  );
}

function Field({
  label, type, value, onChange, autoComplete, disabled, hint,
}: {
  label: string; type: string; value: string; onChange: (v: string) => void;
  autoComplete?: string; disabled?: boolean; hint?: string;
}) {
  const id = `field-${label.toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="block text-[13.5px] font-medium text-ink-text">{label}</label>
      <input
        id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete} disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-1.5 w-full rounded-xl border border-hairline-strong bg-paper px-3.5 py-2.5 text-[14.5px] text-ink-text outline-none transition-colors focus:border-accent disabled:opacity-60"
      />
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-[12.5px] text-faint">{hint}</p>}
    </div>
  );
}
