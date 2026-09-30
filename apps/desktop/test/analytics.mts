// Desktop product-analytics reporting: unconfigured means silent (no client id
// generated, no network call), and a configured send goes through the shared
// GA4 Measurement Protocol wrapper with the "desktop" surface tag.
import { analyticsEnabled, track } from "../src/lib/analytics.ts";
import { sendEvents, isValidEventName } from "../../../lib/openhelm-analytics-mp.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;

export function runAnalyticsTests(ok: Ok): void {
  // This test process sets none of VITE_GA_MEASUREMENT_ID / VITE_GA_API_SECRET
  // (import.meta.env is undefined outside Vite, see config.ts), so the module
  // must come up disabled rather than guessing at a client id.
  ok("analytics is disabled with no measurement id/secret configured", analyticsEnabled === false);
  ok("track() no-ops silently when disabled (throws nothing)", (() => {
    try { track("app_opened"); return true; } catch { return false; }
  })());

  // The events this app actually emits must be names GA4 will accept — every
  // one of them is instrumented at a real call site (useRecorder.ts,
  // useFileImport.ts, main.tsx, captures.ts), so a typo here is a metric that
  // is silently always zero in production.
  const emittedEvents = ["app_opened", "capture_started", "meeting_saved", "meeting_save_failed", "speaker_named", "capture_kept"];
  for (const name of emittedEvents) {
    ok(`"${name}" is a valid GA4 event name`, isValidEventName(name), name);
  }
}

export async function runAnalyticsAsyncTests(ok: Ok): Promise<void> {
  const unconfigured = await sendEvents({}, [{ name: "meeting_saved" }]);
  ok("sendEvents refuses to pretend an unconfigured send worked",
    unconfigured.sent === false && unconfigured.reason === "not_configured");

  const invalidName = await sendEvents(
    { measurementId: "G-TEST", apiSecret: "secret", clientId: "1.1" },
    [{ name: "not a valid name!" }],
  );
  ok("sendEvents rejects an invalid event name before making a network call",
    invalidName.sent === false && invalidName.reason === "invalid");

  let requested: { url: string; body: string } | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    requested = { url, body: String(init.body) };
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const result = await sendEvents(
    { measurementId: "G-TEST", apiSecret: "secret", clientId: "1.1", surface: "desktop" },
    [{ name: "meeting_saved", params: { source: "live" } }],
    fakeFetch,
  );
  ok("a configured, valid send is reported as sent", result.sent === true && result.events === 1);
  ok("the request carries the desktop surface", requested !== null && JSON.parse(requested.body).events[0].params.platform === "desktop");
  ok("the request is addressed to this client id", requested !== null && JSON.parse(requested.body).client_id === "1.1");

  const failedFetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
  const failed = await sendEvents(
    { measurementId: "G-TEST", apiSecret: "secret", clientId: "1.1" },
    [{ name: "meeting_saved" }],
    failedFetch,
  );
  ok("an HTTP failure is reported, not swallowed", failed.sent === false && failed.reason === "error");
}
