"use client";

// The boundary for any page that throws while rendering. The root layout's
// header and footer stay in place; only the page body is replaced. Report the
// error so it becomes a Sentry Issue rather than a blank page nobody hears about.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Button, Display } from "@ledgeur/ui/components";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);

  return (
    <main className="mx-auto max-w-xl px-5 py-24 text-center">
      <Display level={1} className="text-3xl">Something went wrong.</Display>
      <p className="mt-4 text-base leading-relaxed text-muted">
        This page hit an error. We have been told about it. Anything you recorded is still on your device.
      </p>
      <Button className="mt-8 rounded-full" onClick={reset}>Try again</Button>
    </main>
  );
}
