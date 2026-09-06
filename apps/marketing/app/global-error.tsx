"use client";

// The page shown when the root layout itself has crashed. It has to carry its
// own <html> and <body>, and it cannot rely on the layout's stylesheet having
// loaded — so the brand is carried by inline values read from the design
// tokens rather than by Tailwind classes.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { COLORS, FONTS } from "@ledgeur/ui";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: COLORS.surface, color: COLORS["ink-text"], fontFamily: FONTS.sans }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "112px 20px", textAlign: "center" }}>
          <div style={{ width: 44, height: 44, margin: "0 auto", borderRadius: 12, background: COLORS["danger-soft"], color: COLORS.danger, display: "grid", placeItems: "center", fontWeight: 700 }}>!</div>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 24 }}>Something went wrong.</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: COLORS.muted, marginTop: 12 }}>
            The page hit an error it could not recover from. Nothing you recorded is affected — it is still on your device.
          </p>
          <button
            onClick={reset}
            style={{ marginTop: 24, height: 40, padding: "0 20px", borderRadius: 999, border: 0, background: COLORS.ink, color: COLORS["on-ink"], fontWeight: 600, fontSize: 14, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
