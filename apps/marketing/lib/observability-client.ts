import * as Sentry from "@sentry/nextjs";
import { safeContext } from "@ledgeur/core/sentry";
import { isExpectedClientError } from "@ledgeur/core/expected";

/**
 * The browser-side twin of `captureServerError`: a failure the UI turns into a
 * friendly message must still reach Sentry as an Issue, tagged with where it
 * happened. Safe when Sentry is not configured (the SDK is then a no-op) and
 * never throws. `extra` is ids, codes and counts only (see `safeContext`).
 *
 * A person's or device's state (a dismissed share prompt, no speech in a file, a
 * cancelled model load) is shown to them and is not an Issue; see `ExpectedClientError`.
 */
export function reportClientError(err: unknown, scope: string, extra: Record<string, unknown> = {}): void {
  if (isExpectedClientError(err)) return;
  try {
    Sentry.withScope((s) => {
      s.setTag("scope", scope);
      for (const [k, v] of Object.entries(safeContext(extra))) s.setExtra(k, v);
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
    });
  } catch {
    // Reporting an error must never become an error.
  }
}
