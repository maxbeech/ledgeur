import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, consoleLogging } from "@/lib/sentry-options";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV,
  ...baseSentryOptions,
  integrations: [consoleLogging()],
});
