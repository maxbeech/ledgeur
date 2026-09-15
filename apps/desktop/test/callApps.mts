// The dismiss-flag half of the call-app tip — see src/lib/callApps.ts and
// src-tauri/src/callapps.rs for why it exists. The detection itself (a Tauri
// command backed by `ps`) isn't reachable from this Node test process; the
// Rust side's matching logic has its own unit tests in callapps.rs.
import { dismissCallAppTip, isCallAppTipDismissed } from "../src/lib/callApps.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;

/** A minimal in-memory Storage, installed only for the lifetime of this
 *  function so no other test file's `typeof localStorage !== "undefined"`
 *  checks (captures.ts, settings.ts, ...) observe a different environment. */
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

export function runCallAppsTests(ok: Ok): void {
  const original = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  try {
    ok("not dismissed before anyone has seen the tip", isCallAppTipDismissed() === false);
    dismissCallAppTip();
    ok("dismissed sticks after calling dismissCallAppTip", isCallAppTipDismissed() === true);
  } finally {
    if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
    else (globalThis as { localStorage?: unknown }).localStorage = original;
  }

  // Without any storage at all (the real situation this test file otherwise
  // runs under), both functions must degrade quietly rather than throw.
  ok("isCallAppTipDismissed doesn't throw with no localStorage", (() => {
    try { isCallAppTipDismissed(); return true; } catch { return false; }
  })());
  ok("dismissCallAppTip doesn't throw with no localStorage", (() => {
    try { dismissCallAppTip(); return true; } catch { return false; }
  })());
}
