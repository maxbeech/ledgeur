/**
 * OpenHelm Analytics: this product's Google Analytics 4 measurement.
 *
 * ⚠️ GENERATED. The canonical copy is
 * `ProductFactory/_services/openhelm-analytics/openhelm-analytics.tsx`; edit it
 * there and re-run `node _services/openhelm-analytics/install.mjs` rather than
 * editing this file in a product. One implementation across every product is
 * the point: a per-product hand-pasted gtag snippet is how consent handling,
 * SPA page views and event naming drift apart across a portfolio.
 *
 * THE MEASUREMENT ID IS CONFIGURATION, NOT CODE. It is read from
 * `NEXT_PUBLIC_GA_MEASUREMENT_ID` and never hardcoded. That is deliberate and
 * load-bearing: a GA4 property's id changes whenever the property is recreated
 * or moved between accounts, and a portfolio that hardcodes it needs 32 commits
 * and 32 deploys to re-point. With the id in the environment, re-pointing a
 * product at a different property is a Vercel env change and a redeploy.
 *
 * UNSET MEANS OFF, LOUDLY-IN-DEV AND SILENTLY-IN-PROD. With no measurement id
 * this renders nothing, loads no script, and `track()` is a no-op. It never
 * queues events for a tag that will never arrive and never pretends to have
 * measured anything. In development it says so once on the console, because a
 * product that thinks it is measuring and is not is the failure this whole
 * service exists to prevent.
 *
 * WHY NOT `@next/third-parties`. That package would be a dependency in 32
 * repositories to save ~30 lines, and it does not solve the part that is
 * actually easy to get wrong (below). A generated file keeps the dependency
 * count at zero and the behaviour identical everywhere.
 *
 * THE PART THAT IS EASY TO GET WRONG. gtag.js sends one `page_view` when it
 * loads. The App Router then navigates on the client without a document load,
 * so every route after the first is invisible unless the app sends the event
 * itself, the single most common way a Next.js site reports a tenth of its
 * real traffic. So `send_page_view` is switched OFF at config time and every
 * view, including the first, is sent explicitly on pathname/query change.
 *
 * WHY THE SUSPENSE BOUNDARY IS NOT OPTIONAL. `useSearchParams()` in a component
 * that is not inside `<Suspense>` opts the WHOLE route out of static rendering
 * (Next.js bails to client-side rendering at build time). Analytics must never
 * change how a product's pages render, so the hook-using half is isolated
 * behind a boundary here rather than left for each product to remember.
 *
 * NON-WEB SURFACES. A desktop (Tauri/Electron) or mobile (Expo/React Native)
 * build has no `document` to put a tag in. Those send through the Measurement
 * Protocol instead; see `openhelm-analytics-mp.ts` beside this file, which
 * reports to the SAME GA4 property through its own data stream. Do not try to
 * load gtag.js in a native shell.
 */
"use client";

import { Suspense, useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";

/** The one place the measurement id is read. */
export const MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || "";

/** True when this product is actually configured to measure anything. */
export const analyticsEnabled = MEASUREMENT_ID.length > 0;

type GtagArgs =
  | ["js", Date]
  | ["config", string, Record<string, unknown>?]
  | ["event", string, Record<string, unknown>?]
  | ["set", Record<string, unknown>];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: GtagArgs) => void;
  }
}

/**
 * Send a custom event.
 *
 * Safe to call from anywhere, including the server and before the tag has
 * loaded: `dataLayer` is an array that gtag.js drains on arrival, so an event
 * pushed early is delivered rather than dropped. Returns whether it was
 * recorded, so a caller that genuinely needs to know is not left guessing.
 */
export function track(event: string, params: Record<string, unknown> = {}): boolean {
  if (!analyticsEnabled) return false;
  if (typeof window === "undefined") return false;
  window.dataLayer = window.dataLayer || [];
  // Push the raw argument tuple rather than calling window.gtag, so events
  // fired before gtag.js finishes loading still land in the queue it drains.
  window.dataLayer.push(["event", event, params]);
  return true;
}

/** Send a page_view for one resolved URL. Exported for tests and for products
 *  that route outside the App Router (a modal treated as a page, say). */
export function trackPageView(url: string): boolean {
  if (!analyticsEnabled) return false;
  if (typeof window === "undefined") return false;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push([
    "event",
    "page_view",
    { page_path: url, page_location: window.location.href, page_title: document.title },
  ]);
  return true;
}

/**
 * The half that needs the navigation hooks. Isolated so the Suspense boundary
 * in `Analytics` covers it; see the header note on static rendering.
 */
function PageViews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // gtag.js sends nothing until it has loaded, but dataLayer queues, so there
  // is no ordering problem, only a duplicate one, which this guards.
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!analyticsEnabled || !pathname) return;
    const query = searchParams?.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    if (lastSent.current === url) return;
    lastSent.current = url;
    trackPageView(url);
  }, [pathname, searchParams]);

  return null;
}

/**
 * Drop `<OpenHelmAnalytics />` in the root layout's `<body>`. Renders nothing.
 *
 * The name is deliberately not `Analytics`. Nine of these products already
 * import `Analytics` from `@vercel/analytics`, and a second import of that
 * binding is a duplicate-identifier build failure, not a warning, so the
 * generic name is the one name this component may not have.
 */
export function OpenHelmAnalytics() {
  useEffect(() => {
    if (analyticsEnabled) return;
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[openhelm-analytics] NEXT_PUBLIC_GA_MEASUREMENT_ID is not set, so " +
          "nothing is being measured. Set it in .env.local and in the Vercel " +
          "project's environment to switch measurement on.",
      );
    }
  }, []);

  if (!analyticsEnabled) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="openhelm-analytics-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
gtag('js', new Date());
gtag('config', '${MEASUREMENT_ID}', { send_page_view: false });`}
      </Script>
      <Suspense fallback={null}>
        <PageViews />
      </Suspense>
    </>
  );
}

export default OpenHelmAnalytics;
