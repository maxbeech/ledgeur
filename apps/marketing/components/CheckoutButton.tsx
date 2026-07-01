"use client";

import { useState } from "react";

// Team-plan checkout. Stripe keys are injected as Vercel env vars
// (STRIPE_SECRET_KEY, STRIPE_PRICE_ID). When absent the endpoint returns a
// graceful 503 and we show a contact fallback instead of crashing.
export default function CheckoutButton({ label = "Start Team plan" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; return; }
      setMsg(data.error ?? "Checkout is not available yet — email hello@parleynotes.com.");
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
    </div>
  );
}
