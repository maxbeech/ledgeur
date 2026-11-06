/** Mount inside the same configuration and consent boundary as the Google tag. */
"use client";
import { useEffect } from "react";
import { observeActiveReturns } from "./analytics-return-browser";

type AnalyticsWindow = Window & { dataLayer?: unknown[] };
function queue(..._command: unknown[]): void {
  const target = window as AnalyticsWindow;
  target.dataLayer ??= [];
  // gtag drains Arguments objects; arrays are silently ignored by Google.
  // eslint-disable-next-line prefer-rest-params
  target.dataLayer.push(arguments);
}

export function ActiveReturnTracker({ measurementId, consentStorageKey }: { measurementId: string; consentStorageKey?: string }) {
  useEffect(() => {
    if (!measurementId) return;
    try { return observeActiveReturns({
      storage: window.localStorage, document, now: () => Date.now(),
      consented: () => !consentStorageKey || window.localStorage.getItem(consentStorageKey) === "granted",
      send: (event, params) => { queue("event", event, { ...params, send_to: measurementId }); return true; },
      onError: error => console.error("[openhelm-analytics] Active return measurement failed", error),
    }); } catch (error) {
      console.error("[openhelm-analytics] Active return storage is unavailable", error);
    }
  }, [measurementId, consentStorageKey]);
  return null;
}
