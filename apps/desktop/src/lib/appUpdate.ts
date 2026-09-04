// Auto-update. Ledgeur checks GitHub Releases' latest.json (built and signed
// by scripts/release-macos.mjs) via @tauri-apps/plugin-updater — the same
// mechanism every release goes through, never a hand-rolled version check.
// Browser preview (not Tauri) has no updater at all: `checkForUpdate` is a
// no-op there, same pattern as nativeAI.ts.

import { isTauri } from "./runtime.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("app-update");

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

/** The plugin's `Update` handle, kept for `install()` to act on. Not exported
 *  — callers only ever see the plain data above. */
let pending: import("@tauri-apps/plugin-updater").Update | null = null;

/** Ask GitHub for the latest release and compare against the running build.
 *  Returns null in the browser preview, when already current, or when the
 *  check itself fails (no network, GitHub down) — never throws, since a
 *  failed update check must not look like a broken app. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update?.available) { pending = null; return null; }
    pending = update;
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body ?? null,
      date: update.date ?? null,
    };
  } catch (e) {
    log.warn("update check failed", e);
    return null;
  }
}

/** Download + install the update found by the last `checkForUpdate()` call,
 *  then relaunch into the new version. Throws on failure — unlike the check,
 *  a failure here is the user's own "Update now" click and should surface. */
export async function installUpdate(onProgress?: (p: DownloadProgress) => void): Promise<void> {
  if (!pending) throw new Error("No update to install — check for one first.");
  const update = pending;
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") { total = event.data.contentLength ?? null; onProgress?.({ downloaded, total }); }
    else if (event.event === "Progress") { downloaded += event.data.chunkLength; onProgress?.({ downloaded, total }); }
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
