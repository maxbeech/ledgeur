"use client";

// Where every Supabase auth email lands: "confirm your email address" and
// "reset your password". Before this page existed both links dropped the user
// on the marketing home page, which silently ignored the URL fragment — so a
// confirmed account looked like nothing had happened, an expired link looked
// identical to a working one, and a password reset had nowhere to finish.
//
// Supabase puts the outcome in the URL *fragment* (#access_token=… or
// #error=…), which never reaches the server, so this has to be a client
// component reading location.hash on mount.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { MIN_PASSWORD_LENGTH, SITE, SUPABASE } from "@/lib/site";
import { Button, Card, ErrorNote, buttonClass } from "@ledgeur/ui/components";
import { Wordmark } from "@/components/site/Chrome";

type View =
  | { kind: "loading" }
  | { kind: "error"; title: string; detail: string }
  | { kind: "confirmed" }
  | { kind: "recovery"; accessToken: string }
  | { kind: "done"; title: string; detail: string };

/** Turn Supabase's error codes into something a person can act on. */
function describeError(code: string, description: string): { title: string; detail: string } {
  const readable = description.replace(/\+/g, " ").trim();
  if (/expired|invalid/i.test(code) || /expired|invalid/i.test(readable)) {
    return {
      title: "That link has expired",
      detail: "Email links are single-use and time-limited. Request a new one from Ledgeur and open it as soon as it arrives.",
    };
  }
  if (/access_denied/i.test(code)) {
    return { title: "That link could not be used", detail: readable || "Request a new email from Ledgeur and try again." };
  }
  return { title: "Something went wrong", detail: readable || "Request a new email from Ledgeur and try again." };
}

/** What the link in the email actually says happened. */
function readOutcome(): View {
  // Supabase uses the fragment; a few flows use the query string. Read both.
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const get = (k: string) => hash.get(k) ?? query.get(k);

  const errorCode = get("error_code") ?? get("error");
  if (errorCode) return { kind: "error", ...describeError(errorCode, get("error_description") ?? "") };

  const accessToken = get("access_token");
  if (!accessToken) {
    return {
      kind: "error",
      title: "Nothing to confirm here",
      detail: "Open this page from the link in a Ledgeur email — the link carries the details this page needs.",
    };
  }

  return get("type") === "recovery" ? { kind: "recovery", accessToken } : { kind: "confirmed" };
}

export default function AuthCallbackPage() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  // The fragment only exists in the browser, so this is read after mount rather
  // than during render — reading it during render would break hydration.
  //
  // `hashchange` matters: opening a second auth link (say a password reset
  // after a confirmation) while this tab is already here changes only the
  // fragment, which is a same-document navigation. Without this listener the
  // page would keep showing the previous outcome and the reset form would
  // never appear.
  useEffect(() => {
    const sync = () => setView(readOutcome());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const submitPassword = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (view.kind !== "recovery") return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Choose a longer password — at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) { setFormError("Those two passwords don’t match."); return; }

    setBusy(true); setFormError("");
    try {
      const res = await fetch(`${SUPABASE.url}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: SUPABASE.anonKey,
          Authorization: `Bearer ${view.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = String(body?.msg || body?.message || `Request failed (${res.status})`);
        setFormError(/expired|invalid/i.test(msg)
          ? "That reset link has expired. Request a new one from Ledgeur."
          : msg);
        return;
      }
      setView({
        kind: "done",
        title: "Password updated",
        detail: "Open Ledgeur and sign in with your new password.",
      });
    } catch {
      setFormError("Couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [view, password, confirm]);

  return (
    <main className="mx-auto flex max-w-lg flex-col px-5 py-20">
      <Link href="/" aria-label={`${SITE.name} home`}><Wordmark /></Link>

      {view.kind === "loading" && (
        <p className="mt-8 text-[15px] text-muted">Checking your link…</p>
      )}

      {view.kind === "confirmed" && (
        <>
          <h1 className="ldg-display mt-8 text-[30px] leading-tight text-ink-text">Email confirmed</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            Your {SITE.name} account is ready. Open the app and sign in with your email and password.
          </p>
          <Actions />
        </>
      )}

      {view.kind === "done" && (
        <>
          <h1 className="ldg-display mt-8 text-[30px] leading-tight text-ink-text">{view.title}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">{view.detail}</p>
          <Actions />
        </>
      )}

      {view.kind === "error" && (
        <>
          <h1 className="ldg-display mt-8 text-[30px] leading-tight text-ink-text">{view.title}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">{view.detail}</p>
          <Actions />
        </>
      )}

      {view.kind === "recovery" && (
        <>
          <h1 className="ldg-display mt-8 text-[30px] leading-tight text-ink-text">Choose a new password</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            Set a new password for your {SITE.name} account, then sign in with it in the app.
          </p>
          <form onSubmit={submitPassword} noValidate className="mt-6 space-y-3">
            <label className="block">
              <span className="text-[13.5px] font-medium text-ink-text">New password</span>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password" disabled={busy}
                className="mt-1.5 w-full rounded-xl border border-hairline-strong bg-paper px-3.5 py-2.5 text-[14.5px] text-ink-text outline-none transition-colors focus:border-accent disabled:opacity-60"
              />
            </label>
            <label className="block">
              <span className="text-[13.5px] font-medium text-ink-text">Confirm new password</span>
              <input
                type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password" disabled={busy}
                className="mt-1.5 w-full rounded-xl border border-hairline-strong bg-paper px-3.5 py-2.5 text-[14.5px] text-ink-text outline-none transition-colors focus:border-accent disabled:opacity-60"
              />
            </label>
            <Button type="submit" size="lg" disabled={busy} className="w-full">
              {busy ? "Saving…" : "Save new password"}
            </Button>
            {formError && <ErrorNote>{formError}</ErrorNote>}
          </form>
        </>
      )}
    </main>
  );
}

function Actions() {
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <Link href="/app" className={buttonClass("primary", "md")}>Open Ledgeur</Link>
      <Link href="/account" className={buttonClass("secondary", "md")}>Your account</Link>
    </div>
  );
}
