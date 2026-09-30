// Product analytics (desktop). This surface has no document, so gtag.js
// cannot run here — see ../../../../lib/openhelm-analytics.tsx's header for
// why. Instead this reports through GA4's Measurement Protocol
// (../../../../lib/openhelm-analytics-mp.ts), the same wrapper the rest of the
// OpenHelm portfolio uses, into the SAME GA4 property as the marketing site's
// web tag, under the "desktop" stream.
//
// Blank config (VITE_GA_MEASUREMENT_ID / VITE_GA_API_SECRET unset) disables
// this entirely: no client id is generated, no request is made. Never throws
// and never awaited on a user's critical path — a dropped event must not
// delay or fail a recording.

import { trackEvent, newClientId } from "../../../../lib/openhelm-analytics-mp.ts";
import { CONFIG } from "./config.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("analytics");

const CLIENT_ID_KEY = "ledgeur.analytics.clientId";

export const analyticsEnabled = Boolean(CONFIG.gaMeasurementId && CONFIG.gaApiSecret);

/** Stable per-install id, the unit GA4 counts as "a user". Persisted in
 *  localStorage because only the caller (this app) knows what survives a
 *  reinstall; a fresh id per session would make every count meaningless. */
function clientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const id = newClientId();
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    return newClientId();
  }
}

/**
 * Report one product event from the desktop app. Fire-and-forget: a failed
 * or unconfigured send is logged (and, via the logger, reaches Sentry as a
 * warning) but never surfaces to the user or blocks the caller.
 */
export function track(name: string, params: Record<string, unknown> = {}): void {
  if (!analyticsEnabled) return;
  trackEvent(
    { measurementId: CONFIG.gaMeasurementId, apiSecret: CONFIG.gaApiSecret, clientId: clientId(), surface: "desktop" },
    name,
    params,
  )
    .then((result) => {
      if (!result.sent) log.warn("event not delivered", { name, reason: result.reason });
    })
    .catch((e: unknown) => log.warn("event send threw", { name, error: String(e) }));
}
