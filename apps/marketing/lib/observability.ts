import * as Sentry from "@sentry/nextjs";

/**
 * The one way server code reports a problem. Everything funnels through here
 * so scope tags stay consistent, and so a deployment with no DSN degrades to a
 * loud console line rather than throwing inside an error handler.
 */
function configured(): boolean {
  return Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
}

export function captureServerError(err: unknown, context: Record<string, unknown> = {}): void {
  const scope = typeof context.scope === "string" ? context.scope : "server";
  try {
    if (configured()) {
      Sentry.withScope((s) => {
        s.setTag("scope", scope);
        for (const [k, v] of Object.entries(context)) if (k !== "scope") s.setExtra(k, v);
        s.captureException(err instanceof Error ? err : new Error(String(err)));
      });
      return;
    }
  } catch {
    // Reporting an error must never become an error.
  }
  console.error(`[${scope}] (Sentry not configured)`, err, context);
}

/** A handled failure that is not an exception: a refused upstream response. */
export function captureServerMessage(message: string, context: Record<string, unknown> = {}): void {
  const scope = typeof context.scope === "string" ? context.scope : "server";
  try {
    if (configured()) {
      Sentry.withScope((s) => {
        s.setTag("scope", scope);
        s.setLevel("error");
        for (const [k, v] of Object.entries(context)) if (k !== "scope") s.setExtra(k, v);
        s.captureMessage(message);
      });
      return;
    }
  } catch {
    // see above
  }
  console.error(`[${scope}] (Sentry not configured)`, message, context);
}
