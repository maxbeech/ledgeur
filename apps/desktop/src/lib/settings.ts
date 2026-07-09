// User preferences, persisted to localStorage and shared across the app via a
// tiny subscribe/notify store (so a toggle in Settings updates the live meeting
// immediately). Typed keys with defaults — no magic strings at call sites.

import { useSyncExternalStore } from "react";

export interface Settings {
  /** The copilot proactively posts "you could say…" suggestions into the
   *  meeting thread as assistant messages. */
  proactiveSuggestions: boolean;
  /** How often (seconds) to auto-generate a proactive suggestion. */
  suggestIntervalSec: number;
  /** Include the copilot chat + your replies in the saved meeting record.
   *  Off by default — only the spoken transcript is kept. */
  saveChatWithMeeting: boolean;
}

const DEFAULTS: Settings = {
  proactiveSuggestions: true,
  suggestIntervalSec: 90,
  saveChatWithMeeting: false,
};

const KEY = "ledgeur.settings";

function load(): Settings {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getSettings(): Settings {
  return current;
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage may be unavailable (private mode) — keep the in-memory value */
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Subscribe a component to the whole settings object. */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

/** Subscribe a component to a single setting. */
export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSyncExternalStore(
    subscribe,
    () => current[key],
    () => current[key],
  );
}
