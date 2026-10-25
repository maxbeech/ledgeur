import * as Sentry from "@sentry/nextjs";
import { sentryScrubHooks, scrubEvent } from "@ledgeur/core/sentry";

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

/**
 * A real server action id is a long hex digest. A scanner sends a made-up one
 * ("cachefn") to make Next.js render /_not-found as an RSC response, which it
 * answers with "Invariant: Expected RSC response, got text/plain" and a 4xx.
 */
const REAL_ACTION_ID = /^[0-9a-f]{40,}$/i;

type HeaderBag = Record<string, unknown> | null | undefined;

function headerValue(headers: HeaderBag, name: string): string | null {
  if (!headers) return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" ? first : null;
  }
  return null;
}

/**
 * Whether a request is a framework-exploit probe rather than a visitor: it
 * carries an `x-middleware-subrequest` header (set only by Next.js itself, never
 * by a browser, and the lever of the 2025 middleware-bypass CVE) or a
 * `next-action` header that is not a real action id. The app already refuses
 * these; reporting the refusal only fills the issue list with scanner traffic.
 * Narrow on purpose: an ordinary request, and a real server action, never match.
 */
export function isFrameworkProbe(headers: HeaderBag): boolean {
  if (headerValue(headers, "x-middleware-subrequest") !== null) return true;
  const action = headerValue(headers, "next-action");
  return action !== null && !REAL_ACTION_ID.test(action);
}

interface ProbeCarrier {
  request?: { headers?: HeaderBag };
  sdkProcessingMetadata?: { normalizedRequest?: { headers?: HeaderBag } };
}

/** The one `beforeSend`: drop scanner probes, then scrub as before. */
export function beforeSendEvent<T extends object>(event: T): T | null {
  const carrier = event as ProbeCarrier;
  if (isFrameworkProbe(carrier.request?.headers) || isFrameworkProbe(carrier.sdkProcessingMetadata?.normalizedRequest?.headers)) {
    return null;
  }
  return scrubEvent(event);
}

export const baseSentryOptions = {
  sendDefaultPii: false,
  tracesSampleRate: 0.05,
  enableLogs: true,
  ...sentryScrubHooks,
  beforeSend: beforeSendEvent,
} as const;
