"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ display: "grid", minHeight: "100dvh", placeItems: "center", margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: "32rem", padding: "2rem", textAlign: "center" }}>
          <h1>Something went wrong</h1>
          <p>We&apos;ve been notified. Please try again.</p>
          <button type="button" onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
