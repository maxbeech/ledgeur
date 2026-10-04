// Error tracking. Only active in a production build with VITE_SENTRY_DSN set
// (see .env.example). Anywhere else sentryEnabled is false and every call below
// is a silent no-op, so `pnpm dev` never touches the network — and never files
// the hot-reload and half-built-feature errors of a developer's own session as
// if a customer had hit them.

import * as Sentry from "@sentry/react";
import { CONFIG } from "./config.ts";

/** Whether this build reports to Sentry at all. Exported as a function so the
 *  rule is testable without a Vite environment. */
export function shouldReport(config: { sentryDsn: string; mode: string }): boolean {
  return Boolean(config.sentryDsn) && config.mode === "production";
}

export const sentryEnabled = shouldReport(CONFIG);

export function initSentry() {
  if (!sentryEnabled) return;
  Sentry.init({
    dsn: CONFIG.sentryDsn,
    environment: CONFIG.mode,
    tracesSampleRate: 0.1,
  });
}

export { Sentry };
