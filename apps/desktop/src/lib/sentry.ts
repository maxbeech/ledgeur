// Error tracking. Only active in a production build with VITE_SENTRY_DSN set
// (see .env.example). Anywhere else sentryEnabled is false and every call below
// is a silent no-op, so `pnpm dev` never touches the network — and never files
// the hot-reload and half-built-feature errors of a developer's own session as
// if a customer had hit them.

import * as Sentry from "@sentry/react";
import { CONFIG } from "./config.ts";

/** Whether this build reports to Sentry at all. Exported as a function so the
 *  rule is testable without a Vite environment. */
export function shouldReport(config: { sentryDsn: string; mode: string }): boolean {
  return Boolean(config.sentryDsn) && config.mode === "production";
}

export const sentryEnabled = shouldReport(CONFIG);

// Logs are free text, so a stray `console.log(user)` must not ship an email
// address or an access token to Sentry.
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

/** Options shared by every Sentry.init in this app. Exported for tests. */
export function sentryOptions(config: { sentryDsn: string; mode: string }) {
  return {
    dsn: config.sentryDsn,
    environment: config.mode,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    enableLogs: true,
    beforeSendLog: scrubLog,
  } as const;
}

export function initSentry() {
  if (!sentryEnabled) return;
  Sentry.init({
    ...sentryOptions(CONFIG),
    integrations: [
      Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] }),
      Sentry.feedbackIntegration({
        colorScheme: "system",
        // Opened by our own "Send feedback" control; no floating Sentry button.
        autoInject: false,
        showBranding: false,
        formTitle: "Send feedback",
        submitButtonLabel: "Send feedback",
        messagePlaceholder: "A bug, an idea, anything on your mind.",
        successMessageText: "Thank you. That has gone straight to the people who can act on it.",
      }),
    ],
  });
}

/**
 * Opens the feedback form. Returns false when this build does not report to
 * Sentry (a dev session, or no DSN), so the caller can say so rather than do
 * nothing. Pre-fills the signed-in person's email when known.
 */
export async function openFeedbackForm(user?: { email?: string | null; name?: string | null }): Promise<boolean> {
  const feedback = sentryEnabled ? Sentry.getFeedback() : undefined;
  if (!feedback) return false;
  if (user?.email) Sentry.setUser({ email: user.email, ...(user.name ? { username: user.name } : {}) });
  const form = await feedback.createForm();
  form.appendToDom();
  form.open();
  return true;
}

export { Sentry };
