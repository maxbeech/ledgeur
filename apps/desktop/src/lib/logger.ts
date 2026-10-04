// Scoped logging. Always prints a timestamped line to the console (so
// `pnpm dev` output is actually useful for debugging). When Sentry is
// configured, debug stays local, info and warn become breadcrumbs, and only
// error becomes an issue — so a crash report arrives with the trail that led to
// it, and a degraded-but-working path (a model that was slow, a backend that
// has not had a migration yet, speaker naming that timed out) does not open an
// issue of its own.

import { Sentry, sentryEnabled } from "./sentry.ts";

type Level = "debug" | "info" | "warn" | "error";

const timestamp = () => new Date().toISOString().slice(11, 23);

function print(level: Level, scope: string, message: string, extra?: unknown) {
  const line = `[${timestamp()}] [${scope}] ${message}`;
  const method = level === "debug" ? "log" : level;
  if (extra !== undefined) console[method](line, extra);
  else console[method](line);
}

export interface Logger {
  debug(message: string, extra?: unknown): void;
  info(message: string, extra?: unknown): void;
  /** Something degraded but the app carried on. A breadcrumb on the next error report, never an issue. */
  warn(message: string, extra?: unknown): void;
  /** Logs and, when Sentry is configured, reports `error` (or `message` if no error object was thrown). */
  error(message: string, error?: unknown): void;
}

/** Where a logger sends what Sentry should hear about. Injectable so the
 *  warn-is-not-an-issue rule can be tested without the SDK. */
export interface Reporter {
  breadcrumb(b: { category: string; message: string; level: "info" | "warning"; data?: Record<string, unknown> }): void;
  exception(err: Error, extra: { scope: string; message: string }): void;
}

const sentryReporter: Reporter = {
  breadcrumb: (b) => Sentry.addBreadcrumb(b),
  exception: (err, extra) => Sentry.captureException(err, { extra }),
};

/** `extra` is whatever the call site had to hand: an Error, a string, or a bag of numbers. */
function breadcrumbData(extra: unknown): Record<string, unknown> | undefined {
  if (extra === undefined) return undefined;
  if (extra instanceof Error) return { error: extra.message };
  if (extra && typeof extra === "object") return extra as Record<string, unknown>;
  return { detail: String(extra) };
}

export function createLogger(scope: string, reporter: Reporter | null = sentryEnabled ? sentryReporter : null): Logger {
  return {
    debug: (message, extra) => print("debug", scope, message, extra),
    info: (message, extra) => {
      print("info", scope, message, extra);
      reporter?.breadcrumb({ category: scope, message, level: "info" });
    },
    warn: (message, extra) => {
      print("warn", scope, message, extra);
      reporter?.breadcrumb({ category: scope, message, level: "warning", data: breadcrumbData(extra) });
    },
    error: (message, error) => {
      print("error", scope, message, error);
      if (!reporter) return;
      const err = error instanceof Error ? error : new Error(error !== undefined ? `${message}: ${String(error)}` : message);
      reporter.exception(err, { scope, message });
    },
  };
}
