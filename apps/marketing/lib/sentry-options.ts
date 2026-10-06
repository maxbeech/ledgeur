import * as Sentry from "@sentry/nextjs";
import { sentryScrubHooks } from "@ledgeur/core/sentry";

/**
 * The one place Sentry's shared options live, so the browser, server and edge
 * inits cannot drift apart. Each init file still sets its own `dsn` and
 * `environment` (the no-vercel test pins the latter to NODE_ENV).
 */

// The scrubber itself lives in @ledgeur/core/sentry and is shared with the
// desktop app: redaction, 10k-char truncation, linear-time patterns, fail-closed
// hooks, and breadcrumb / transaction coverage. Re-exported here for tests.
export { scrubText, scrubLog, scrubEvent, scrubTransaction, scrubBreadcrumb } from "@ledgeur/core/sentry";

/** Forwards console output to Sentry Logs. */
export function consoleLogging() {
  return Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] });
}

export const baseSentryOptions = {
  sendDefaultPii: false,
  tracesSampleRate: 0.05,
  enableLogs: true,
  ...sentryScrubHooks,
} as const;
