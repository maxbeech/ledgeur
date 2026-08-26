import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0.05,
    integrations: [
      Sentry.feedbackIntegration({
        autoInject: true,
        showBranding: false,
        buttonLabel: "Send feedback",
        formTitle: "Send feedback to Ledgeur",
        submitButtonLabel: "Send feedback",
      }),
    ],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
