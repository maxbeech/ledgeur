// User preferences, persisted to localStorage and shared across the app via a
// tiny subscribe/notify store (so a toggle in Settings updates the live meeting
// immediately). Typed keys with defaults — no magic strings at call sites.

import { useSyncExternalStore } from "react";

/**
 * The transcription model tier used everywhere unless the user picks another.
 *
 * `en-hq` (whisper-base.en) rather than the plain `en` tiny model: a larger
 * download and somewhat slower per pass, but meaningfully more accurate — the
 * tiny model was the single biggest contributor to inaccurate transcripts.
 *
 * Exported because the *warmup* and the *recorder* must agree on it. When they
 * didn't, the app warmed one model at launch and then loaded a different one at
 * "Start recording" — which is a full reload, and looked exactly like the
 * warmup having done nothing at all.
 */
export const DEFAULT_LANG = "en-hq";

export interface Settings {
  /** The copilot proactively posts "you could say…" suggestions into the
   *  meeting thread as assistant messages. */
  proactiveSuggestions: boolean;
  /** How often (seconds) to auto-generate a proactive suggestion. */
  suggestIntervalSec: number;
  /** Include the copilot chat + your replies in the saved meeting record.
   *  Off by default — only the spoken transcript is kept. */
  saveChatWithMeeting: boolean;
  /** Speech model tier — one of @ledgeur/asr's LANG_OPTIONS values. Persisted
   *  so the model warmed at launch is the one the next recording asks for. */
  transcriptionLang: string;
  /** Capture the other side of the call as well as this device's microphone. */
  captureSystemAudio: boolean;
}

const DEFAULTS: Settings = {
  proactiveSuggestions: true,
  suggestIntervalSec: 90,
  saveChatWithMeeting: false,
  transcriptionLang: DEFAULT_LANG,
  captureSystemAudio: false,
};

const KEY = "ledgeur.settings";
/**
 * Keys the user has actually chosen a value for.
 *
 * Persisted separately because the settings blob always contains every key
 * (defaults included), so "is this the default or did they pick it?" cannot be
 * answered from it. That distinction matters wherever a default should improve
 * itself as the app's capabilities change — `captureSystemAudio` becomes a
 * sensible default once a build can capture system audio without a screen-share
 * picker, but only for someone who has never turned it off on purpose.
 */
const TOUCHED_KEY = "ledgeur.settings.touched";

function load(): Settings {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function loadTouched(): Set<string> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(TOUCHED_KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

let current: Settings = load();
let touched: Set<string> = loadTouched();
const listeners = new Set<() => void>();

/** True when the user has explicitly set `key` rather than inheriting a default. */
export function hasChosen(key: keyof Settings): boolean {
  return touched.has(key);
}

/** Convenience for the one call site that needs it, so it reads as a question. */
export function hasChosenSystemAudio(): boolean {
  return hasChosen("captureSystemAudio");
}

function emit() {
  for (const l of listeners) l();
}

export function getSettings(): Settings {
  return current;
}

/**
 * Change a setting.
 *
 * `intent` distinguishes a person choosing something from the app improving its
 * own default underneath them — only the former is recorded as a choice, so an
 * adaptive default never mistakes its own previous suggestion for consent.
 */
export function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
  intent: "user" | "default" = "user",
): void {
  current = { ...current, [key]: value };
  if (intent === "user" && !touched.has(key)) touched = new Set(touched).add(key);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
    if (intent === "user") localStorage.setItem(TOUCHED_KEY, JSON.stringify([...touched]));
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
