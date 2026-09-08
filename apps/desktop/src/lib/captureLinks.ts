// Opening the app straight into the thing you wanted to do.
//
// A home-screen or lock-screen widget cannot run app code — it can only ask the
// system to open a URL. So the widgets (see src-tauri/gen/apple/LedgeurWidget
// and gen/android/app/src/main/java/.../CaptureWidget) hand over one of these:
//
//   ledgeur://capture              open the capture box, ready to type
//   ledgeur://capture?mode=speak   open it and start listening immediately
//   ledgeur://record               start a recording
//
// The point of the whole arrangement is the second one. A thought survives
// about as long as it takes to unlock a phone, and "unlock, find the app, wait
// for it, find the button" is longer than that. One tap from the lock screen to
// a live microphone is the difference between the feature existing and not.
//
// ── Why the app has to handle a link it is already open for ─────────────────
// On both phone platforms the app is usually already running when the widget is
// tapped, so there is no launch to hook — the URL simply arrives. `getCurrent`
// covers the cold start, `onOpenUrl` covers every other time, and both go to
// the same place.

import { isTauri } from "./runtime.ts";
import { openCapture } from "./captureDock.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("capture-links");

/** What a link asked for, or null when it is not one of ours. */
export function parseCaptureLink(raw: string): { action: "capture"; speak: boolean } | { action: "record" } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "ledgeur:") return null;
  // A custom scheme parses as `ledgeur://capture` → host "capture", but a
  // single-slash form (`ledgeur:capture`) puts it in the path instead, and
  // both are things a platform has been known to hand over.
  const what = (url.hostname || url.pathname.replace(/^\/+/, "")).toLowerCase();
  if (what === "record") return { action: "record" };
  if (what === "capture") {
    return { action: "capture", speak: url.searchParams.get("mode") === "speak" };
  }
  return null;
}

function act(raw: string): void {
  const link = parseCaptureLink(raw);
  if (!link) return;
  log.info("opened from a link", { action: link.action });
  if (link.action === "record") {
    // A hash route, because the app router is a HashRouter and this runs
    // outside it — there is no navigate() to reach from here.
    window.location.hash = "#/record";
    return;
  }
  openCapture(link.speak ? "speak" : "type");
}

/**
 * Listen for links for the life of the app.
 *
 * Everything is best-effort: a build without the plugin, a platform that never
 * delivers one, or a malformed URL all end with the app open on whatever screen
 * it was already showing, which is a perfectly good outcome.
 */
export function startCaptureLinks(): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;

  // The dev/web build has no plugin; the query string is the same contract in
  // a form a browser can deliver, which is also how this gets tested.
  const fromQuery = new URLSearchParams(window.location.search).get("capture");
  if (fromQuery) openCapture(fromQuery === "speak" ? "speak" : "type");

  if (isTauri()) {
    void (async () => {
      try {
        const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
        const launched = await getCurrent();
        for (const url of launched ?? []) act(url);
        const unlisten = await onOpenUrl((urls) => { for (const url of urls) act(url); });
        if (cancelled) unlisten(); else stop = unlisten;
      } catch (e) {
        log.info("deep links are not available in this build", { error: String(e) });
      }
    })();
  }

  return () => { cancelled = true; stop?.(); };
}
