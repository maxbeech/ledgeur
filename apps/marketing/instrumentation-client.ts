import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, consoleLogging } from "@/lib/sentry-options";

/**
 * Browser error reporting, logs and user feedback. Feedback is opened by our
 * own "Send feedback" control (components/feedback), so a note from a person
 * lands in the same Sentry project as the exceptions from the code.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    ...baseSentryOptions,
    // Requests go through our own tunnel route (next.config.ts). A feedback
    // report with a screenshot is sent as a raw ArrayBuffer with NO
    // Content-Type, so the tunnel would receive an empty body and the submit
    // would silently fail. See getsentry/sentry-javascript#16112.
    transportOptions: {
      headers: { "content-type": "application/x-sentry-envelope" },
    },
    integrations: [
      consoleLogging(),
      Sentry.feedbackIntegration({
        colorScheme: "system",
        // Opened by our own control; no floating Sentry button over the page.
        autoInject: false,
        showBranding: false,
        formTitle: "Send feedback",
        submitButtonLabel: "Send feedback",
        messagePlaceholder: "A bug, an idea, anything on your mind.",
        successMessageText: "Thank you. That has gone straight to the people who can act on it.",
      }),
    ],
  });
} else if (process.env.NODE_ENV === "production") {
  console.error("Sentry is not configured: NEXT_PUBLIC_SENTRY_DSN is missing from this build.");
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
