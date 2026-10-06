// Wiring checks for the monetisation and billing-portal journey steps: the
// checkout and portal buttons must actually report the funnel event they are
// meant to represent, and every Stripe-facing failure path must reach Sentry
// rather than being swallowed as a plain JSON error the customer sees and
// nobody else ever learns about.
import { readFileSync } from "node:fs";
import { isValidEventName, userRefFor } from "../../../lib/openhelm-analytics-mp.ts";
import { planFor, isAnalyticsIdentity, reasonCode } from "../lib/analytics-identity.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// Every event the web app sends (see lib/analytics-events.ts). Each must be a
// valid GA4 name and must appear at a real call site, so a rename that misses
// one is a failing test rather than a metric that is silently zero.
const WEB_EVENTS: Array<[string, string]> = [
  ["sign_up", "../components/auth/SignInForm.tsx"],
  ["sign_up_failed", "../components/auth/SignInForm.tsx"],
  ["login", "../components/auth/SignInForm.tsx"],
  ["login_failed", "../components/auth/SignInForm.tsx"],
  ["checkout_started", "../components/CheckoutButton.tsx"],
  ["checkout_failed", "../components/CheckoutButton.tsx"],
  ["purchase", "../components/analytics/usePurchaseTracking.ts"],
  ["purchase_confirmation_failed", "../components/analytics/usePurchaseTracking.ts"],
  ["billing_portal_failed", "../components/auth/AccountPanel.tsx"],
  ["capture_started", "../lib/useWebRecorder.ts"],
  ["capture_failed", "../lib/useWebRecorder.ts"],
  ["meeting_saved", "../lib/useWebRecorder.ts"],
  ["meeting_save_failed", "../lib/useWebRecorder.ts"],
];

export async function runAnalyticsAsyncTests(ok: Ok): Promise<void> {
  ok("userRefFor matches the pinned vector", (await userRefFor("00000000-0000-0000-0000-000000000000")) === "12b9377cbe7e5c94");
  // gtag.js only acts on `arguments` objects in dataLayer; a plain array is ignored.
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST12345";
  const g = globalThis as unknown as Record<string, unknown>;
  const win = { dataLayer: [] as unknown[], location: { href: "https://x.test/" } };
  g.window = win; g.document = { title: "T" };
  const client = await import("../../../lib/openhelm-analytics.tsx");
  client.track("sign_up", { method: "email" });
  client.identify({ userRef: "12b9377cbe7e5c94", plan: "free" });
  const isArgs = (v: unknown) => Object.prototype.toString.call(v) === "[object Arguments]";
  ok("track pushes an arguments object", isArgs(win.dataLayer[0]) && JSON.stringify(Array.from(win.dataLayer[0] as ArrayLike<unknown>)) === JSON.stringify(["event", "sign_up", { method: "email" }]));
  ok("identify pushes oh_user_ref and oh_plan as user properties", isArgs(win.dataLayer[1])
    && JSON.stringify(Array.from(win.dataLayer[1] as ArrayLike<unknown>)) === JSON.stringify(["set", "user_properties", { oh_user_ref: "12b9377cbe7e5c94", oh_plan: "free" }]));
  delete g.window; delete g.document;
  ok("userRefFor is 16 hex characters", /^[0-9a-f]{16}$/.test(await userRefFor("someone")));
}

export function runAnalyticsTests(ok: Ok): void {
  ok("plan: free org is free", planFor("free") === "free");
  ok("plan: team (active or trialing subscription) is paid", planFor("team") === "paid");
  ok("plan: company is paid", planFor("company") === "paid");
  ok("plan: unknown workspace is free", planFor(undefined) === "free" && planFor(null) === "free");
  ok("identity shape is accepted", isAnalyticsIdentity({ userRef: "12b9377cbe7e5c94", plan: "paid" }));
  ok("identity rejects a raw id or an email", !isAnalyticsIdentity({ userRef: "a@b.co", plan: "free" })
    && !isAnalyticsIdentity({ userRef: "00000000-0000-0000-0000-000000000000", plan: "free" }));
  ok("identity rejects the anonymous plan", !isAnalyticsIdentity({ userRef: "12b9377cbe7e5c94", plan: "anonymous" }));
  ok("reasonCode keeps a short code", reasonCode({ code: "invalid_credentials" }) === "invalid_credentials");
  ok("reasonCode never carries free text", reasonCode({ code: "User a@b.co not found" }) === "user_a_b_co_not_found"
    && reasonCode(new Error("a@b.co")) === "unknown");
  ok("reasonCode is capped at 40 chars", reasonCode({ code: "x".repeat(80) }).length === 40);

  for (const [name, file] of WEB_EVENTS) {
    ok(`"${name}" is a valid GA4 event name`, isValidEventName(name), name);
    ok(`"${name}" is sent from ${file.split("/").pop()}`, new RegExp(`emit\\("${name}"`).test(read(file)), name);
  }

  const identityRoute = read("../app/api/analytics/identity/route.ts");
  ok("the identity route hashes the id server-side and returns no email",
    /userRefFor\(data\.user\.id\)/.test(identityRoute) && !/\.email/.test(identityRoute));
  ok("the identity route refuses a caller with no bearer token", /sign_in_required/.test(identityRoute));
  ok("the layout mounts the identity setter", /<AnalyticsIdentity \/>/.test(read("../app/layout.tsx")));
  ok("no code pushes a plain array to dataLayer",
    !/dataLayer\.push\(\[/.test(read("../../../lib/openhelm-analytics.tsx")));

  const checkoutButton = read("../components/CheckoutButton.tsx");
  ok("CheckoutButton reports checkout_started", /emit\("checkout_started"/.test(checkoutButton));
  ok("CheckoutButton reports failures to Sentry", /Sentry\.captureException/.test(checkoutButton));

  const accountPanel = read("../components/auth/AccountPanel.tsx");
  ok("AccountPanel reports billing_portal_opened", /emit\("billing_portal_opened"/.test(accountPanel));
  ok("AccountPanel reports portal failures to Sentry", /Sentry\.captureException/.test(accountPanel));

  const checkoutRoute = read("../app/api/checkout/route.ts");
  ok("/api/checkout reports its catch block to Sentry", /captureServerError\(/.test(checkoutRoute));
  ok("/api/checkout reports a Stripe-refused session to Sentry", /captureServerMessage\(/.test(checkoutRoute));

  const portalRoute = read("../app/api/portal/route.ts");
  ok("/api/portal reports its catch block to Sentry", /captureServerError\(/.test(portalRoute));
  ok("/api/portal reports a Stripe-refused session to Sentry", /captureServerMessage\(/.test(portalRoute));

  const webhook = read("../../../supabase/functions/stripe-webhook/index.ts");
  ok("the Stripe webhook checks the activation write for an error instead of discarding it",
    /if \(error\) console\.error\("checkout\.session\.completed/.test(webhook));
  ok("the webhook reports a confirmed trial start", /reportBillingEvent\("trial_started"/.test(webhook));
  ok("the webhook reports a confirmed cancellation", /reportBillingEvent\("subscription_canceled"/.test(webhook));

  for (const name of ["checkout_started", "billing_portal_opened", "trial_started", "subscription_canceled"]) {
    ok(`"${name}" is a valid GA4 event name`, isValidEventName(name), name);
  }
}
