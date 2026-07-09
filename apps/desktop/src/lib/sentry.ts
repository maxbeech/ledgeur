// Error tracking. Only active when VITE_SENTRY_DSN is set (see .env.example) —
// with no DSN, sentryEnabled is false and every call below is a silent no-op,
// so local-only dev never touches the network.

import * as Sentry from "@sentry/react";
import { CONFIG } from "./config.ts";

export const sentryEnabled = Boolean(CONFIG.sentryDsn);

export function initSentry() {
  if (!sentryEnabled) return;
  Sentry.init({
    dsn: CONFIG.sentryDsn,
    environment: CONFIG.mode,
    tracesSampleRate: CONFIG.mode === "production" ? 0.1 : 1.0,
  });
}

export { Sentry };
