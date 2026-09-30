// Wiring checks for the monetisation and billing-portal journey steps: the
// checkout and portal buttons must actually report the funnel event they are
// meant to represent, and every Stripe-facing failure path must reach Sentry
// rather than being swallowed as a plain JSON error the customer sees and
// nobody else ever learns about.
import { readFileSync } from "node:fs";
import { isValidEventName } from "../../../lib/openhelm-analytics-mp.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

export function runAnalyticsTests(ok: Ok): void {
  const checkoutButton = read("../components/CheckoutButton.tsx");
  ok("CheckoutButton reports checkout_started", /track\("checkout_started"\)/.test(checkoutButton));
  ok("CheckoutButton reports failures to Sentry", /Sentry\.captureException/.test(checkoutButton));

  const accountPanel = read("../components/auth/AccountPanel.tsx");
  ok("AccountPanel reports billing_portal_opened", /track\("billing_portal_opened"\)/.test(accountPanel));
  ok("AccountPanel reports portal failures to Sentry", /Sentry\.captureException/.test(accountPanel));

  const checkoutRoute = read("../app/api/checkout/route.ts");
  ok("/api/checkout reports its catch block to Sentry", /Sentry\.captureException/.test(checkoutRoute));
  ok("/api/checkout reports a Stripe-refused session to Sentry", /Sentry\.captureMessage/.test(checkoutRoute));

  const portalRoute = read("../app/api/portal/route.ts");
  ok("/api/portal reports its catch block to Sentry", /Sentry\.captureException/.test(portalRoute));
  ok("/api/portal reports a Stripe-refused session to Sentry", /Sentry\.captureMessage/.test(portalRoute));

  const webhook = read("../../../supabase/functions/stripe-webhook/index.ts");
  ok("the Stripe webhook checks the activation write for an error instead of discarding it",
    /if \(error\) console\.error\("checkout\.session\.completed/.test(webhook));
  ok("the webhook reports a confirmed trial start", /reportBillingEvent\("trial_started"/.test(webhook));
  ok("the webhook reports a confirmed cancellation", /reportBillingEvent\("subscription_canceled"/.test(webhook));

  for (const name of ["checkout_started", "billing_portal_opened", "trial_started", "subscription_canceled"]) {
    ok(`"${name}" is a valid GA4 event name`, isValidEventName(name), name);
  }
}
