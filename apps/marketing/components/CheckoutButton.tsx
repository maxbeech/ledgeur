"use client";

// The upgrade button.
//
// It refuses to start a checkout for somebody who is not signed in — not to be
// awkward, but because a subscription has to attach to a workspace to switch
// anything on. The previous version happily opened Stripe for an anonymous
// visitor, whose payment then activated nothing at all.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorNote } from "@ledgeur/ui/components";
import { getSupabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import EmailLink from "@/components/EmailLink";

export default function CheckoutButton({
  label = "Start the free trial",
  next = "/pricing",
}: { label?: string; next?: string }) {
  const router = useRouter();
  const { session, loading, available } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showContact, setShowContact] = useState(false);

  const start = useCallback(async () => {
    setError(""); setShowContact(false);

    if (!available) {
      setError("This deployment has no billing backend. Get in touch and we will set you up by hand.");
      setShowContact(true);
      return;
    }
    if (!session) {
      // Come back here afterwards and carry straight on.
      router.push(`/signin?next=${encodeURIComponent(next)}`);
      return;
    }

    setBusy(true);
    try {
      const sb = getSupabase();
      // Ask for a fresh token rather than reusing one that may have expired
      // while the pricing page sat open in a tab.
      const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) { router.push(`/signin?next=${encodeURIComponent(next)}`); return; }

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (body.url) { window.location.href = body.url; return; }

      setError(body.error ?? "Checkout could not be started.");
      setShowContact(body.code === "not_configured" || body.code === "no_workspace");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [available, session, router, next]);

  return (
    <div>
      <Button onClick={start} disabled={busy || loading} size="lg" className="w-full">
        {busy ? "Opening Stripe…" : loading ? "…" : session ? label : `${label} →`}
      </Button>
      {!loading && !session && available && (
        <p className="mt-2 text-center text-[12.5px] text-faint">
          You will be asked to sign in first, so the plan can be attached to your workspace.
        </p>
      )}
      {error && (
        <ErrorNote className="mt-3">
          {error}
          {showContact && (
            <EmailLink
              label="Email us"
              subject="Ledgeur Team plan"
              className="mt-2 block font-semibold underline"
            />
          )}
        </ErrorNote>
      )}
    </div>
  );
}
