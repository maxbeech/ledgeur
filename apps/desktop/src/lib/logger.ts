// Scoped logging. Always prints a timestamped line to the console (so
// `pnpm dev` output is actually useful for debugging), and — when Sentry is
// configured — forwards warn/error as events and info/debug as breadcrumbs so
// a prod crash report comes with the trail that led to it.

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
  warn(message: string, extra?: unknown): void;
  /** Logs and, when Sentry is configured, reports `error` (or `message` if no error object was thrown). */
  error(message: string, error?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, extra) => print("debug", scope, message, extra),
    info: (message, extra) => {
      print("info", scope, message, extra);
      if (sentryEnabled) Sentry.addBreadcrumb({ category: scope, message, level: "info" });
    },
    warn: (message, extra) => {
      print("warn", scope, message, extra);
      if (sentryEnabled) Sentry.captureMessage(`${scope}: ${message}`, "warning");
    },
    error: (message, error) => {
      print("error", scope, message, error);
      if (!sentryEnabled) return;
      const err = error instanceof Error ? error : new Error(error !== undefined ? `${message}: ${String(error)}` : message);
      Sentry.captureException(err, { extra: { scope, message } });
    },
  };
}
