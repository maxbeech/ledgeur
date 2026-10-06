import * as Sentry from "@sentry/nextjs";

/**
 * The browser-side twin of `captureServerError`: a failure the UI turns into a
 * friendly message must still reach Sentry as an Issue, tagged with where it
 * happened. Safe when Sentry is not configured (the SDK is then a no-op) and
 * never throws.
 */
export function reportClientError(err: unknown, scope: string, extra: Record<string, unknown> = {}): void {
  try {
    Sentry.withScope((s) => {
      s.setTag("scope", scope);
      for (const [k, v] of Object.entries(extra)) s.setExtra(k, v);
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
    });
  } catch {
    // Reporting an error must never become an error.
  }
}
