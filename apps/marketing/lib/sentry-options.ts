import * as Sentry from "@sentry/nextjs";

/**
 * The one place Sentry's shared options live, so the browser, server and edge
 * inits cannot drift apart. Each init file still sets its own `dsn` and
 * `environment` (the no-vercel test pins the latter to NODE_ENV).
 */

// Anything that looks like an email address or a bearer / access token. Logs
// are free text, so a stray `console.log(user)` must not ship either to Sentry.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TOKEN = /\b(?:bearer\s+[\w.~+/=-]{8,}|ldg_[\w-]{8,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,})/gi;

export function scrubText(text: string): string {
  return text.replace(EMAIL, "[email]").replace(TOKEN, "[token]");
}

/** `beforeSendLog` hook: redacts the message of every structured log. */
export function scrubLog<T extends { message?: unknown }>(log: T): T {
  if (typeof log.message === "string") log.message = scrubText(log.message);
  return log;
}

/** Forwards console output to Sentry Logs. */
export function consoleLogging() {
  return Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] });
}

export const baseSentryOptions = {
  sendDefaultPii: false,
  tracesSampleRate: 0.05,
  enableLogs: true,
  beforeSendLog: scrubLog,
} as const;
