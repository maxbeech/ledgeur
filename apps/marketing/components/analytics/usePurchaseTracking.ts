"use client";

// Reports a completed checkout, from evidence rather than from the redirect.
//
// Stripe sends the customer back to /account?checkout=success the moment the
// card clears, which says nothing about whether the workspace was activated. So
// `purchase` fires only once the workspace row reads as a paid plan (the
// webhook's own write), at most once per browser tab. If it still reads free
// after the page's last re-read, `purchase_confirmation_failed` fires so a
// webhook that never landed is distinguishable from a visitor who left.

import { useEffect, useRef } from "react";
import { emit } from "@/lib/analytics-events";
import { planFor } from "@/lib/analytics-identity";
import { syncAnalyticsIdentity } from "./identity-client";

const FLAG = "ledgeur.analytics.purchase";
export const CONFIRM_WAIT_SECONDS = 12;

function alreadyReported(): boolean {
  try { return sessionStorage.getItem(FLAG) === "1"; } catch { return false; }
}
function markReported(): void {
  try { sessionStorage.setItem(FLAG, "1"); } catch { /* best effort */ }
}

export function usePurchaseTracking(justPaid: boolean, signedIn: boolean, orgPlan: string | undefined): void {
  const reported = useRef(false);
  const paid = planFor(orgPlan) === "paid";

  useEffect(() => {
    if (!justPaid || !signedIn || !paid || reported.current || alreadyReported()) return;
    reported.current = true;
    markReported();
    emit("purchase", { currency: "USD" });
    void syncAnalyticsIdentity();
  }, [justPaid, signedIn, paid]);

  useEffect(() => {
    if (!justPaid || !signedIn || paid || alreadyReported()) return;
    const t = setTimeout(() => {
      if (!reported.current) emit("purchase_confirmation_failed", { waited_seconds: CONFIRM_WAIT_SECONDS });
    }, CONFIRM_WAIT_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [justPaid, signedIn, paid]);
}
