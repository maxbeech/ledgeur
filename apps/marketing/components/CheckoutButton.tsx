"use client";

import { useState } from "react";
import EmailLink from "@/components/EmailLink";

// Team-plan checkout. Stripe keys are injected as Vercel env vars
// (STRIPE_SECRET_KEY, STRIPE_PRICE_ID). When absent the endpoint returns a
// graceful 503 and we show a contact fallback instead of crashing.
//
// The app's "Upgrade" button deep-links here with ?org=<uuid> so the purchase
// auto-activates the org's plan; visiting /pricing directly still works but
// won't auto-activate (falls back to the contact email until linked by hand).
// Read from window.location at click-time (not useSearchParams) so this stays
// usable in a statically-prerendered page with no Suspense boundary.
export default function CheckoutButton({ label = "Start Team plan" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showContact, setShowContact] = useState(false);

  async function start() {
    setLoading(true);
    setMsg(null);
    setShowContact(false);
    try {
      const orgId = new URLSearchParams(window.location.search).get("org");
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; return; }
      setMsg(data.error ?? "Checkout is not available yet.");
      setShowContact(true);
    } catch {
      setMsg("Could not start checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={start} disabled={loading}
        className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60">
        {loading ? "Starting…" : label}
      </button>
      {msg && <p className="mt-2 text-center text-xs text-stone-600">{msg}</p>}
      {showContact && (
        <EmailLink
          label="Email us"
          subject="Ledgeur team plan"
          className="mt-1 block w-full text-center text-xs font-semibold text-emerald-700 hover:underline"
        />
      )}
    </div>
  );
}
