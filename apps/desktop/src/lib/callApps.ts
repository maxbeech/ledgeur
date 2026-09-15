// Tells the Record screen when a call app with a known mic-ducking quirk is
// currently open — see src-tauri/src/callapps.rs for why this exists and why
// it's Zoom-only today. A person who has never heard of Zoom's own
// "Automatically adjust microphone volume" setting has no reason to go
// looking for it; this surfaces it at the one moment it matters, instead of
// requiring them to already know.

import { useEffect, useState } from "react";
import { isTauri } from "./runtime.ts";

const POLL_MS = 4_000;

async function detect(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("detect_running_call_app");
  } catch {
    return null;
  }
}

/**
 * The display name of a known call app (e.g. `"Zoom"`) if one is running
 * right now, else `null`. Polls only while `active` — meant for the Record
 * pre-flight screen, not to run for the lifetime of the app.
 */
export function useRunningCallApp(active: boolean): string | null {
  const [app, setApp] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setApp(null);
      return;
    }
    let cancelled = false;
    const check = () => void detect().then((found) => { if (!cancelled) setApp(found); });
    check();
    const id = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [active]);

  return app;
}

const DISMISSED_KEY = "ledgeur.callAppTip.dismissed";

/** Persisted across launches: once somebody has read the tip, it stays gone. */
export function isCallAppTipDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissCallAppTip(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    /* storage may be unavailable (private mode) — dismissal just won't stick */
  }
}
