// Detect whether we're running inside the Tauri native shell (vs a plain browser
// during `vite dev`). Lets the UI light up native-only features (system audio,
// notifications, secure storage) without crashing in the browser.

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Open a URL in the user's real browser (via Tauri opener natively; window.open
 *  in the browser preview). Used for OAuth authorize flows. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

export type Platform = "macos" | "windows" | "ios" | "android" | "web";

/** Best-effort platform guess from the user agent (refined by Tauri OS plugin later). */
export function guessPlatform(): Platform {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent;
  if (!isTauri()) return "web";
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Mac OS X|Macintosh/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  return "web";
}
