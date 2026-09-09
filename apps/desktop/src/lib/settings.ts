// User preferences, persisted to localStorage and shared across the app via a
// tiny subscribe/notify store (so a toggle in Settings updates the live meeting
// immediately). Typed keys with defaults — no magic strings at call sites.

import { useSyncExternalStore } from "react";
import { DEFAULT_TEMPLATE_ID } from "@ledgeur/core";

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
  /** Which note template steers the summary — a NOTE_TEMPLATES id, or a
   *  `custom:` id from the user's own recipes (see recipes.ts). */
  noteTemplate: string;
  /**
   * Start recording by itself when a calendar meeting with a join link begins.
   *
   * Off by default and deliberately so: a recorder that starts on its own is
   * the single behaviour most likely to capture something nobody meant to
   * capture, and that has to be an explicit choice rather than a default
   * somebody discovers afterwards.
   */
  autoStartFromCalendar: boolean;
  /** POST finished meetings here. Empty = off. See webhooks.ts. */
  webhookUrl: string;
  /** HMAC secret for the webhook signature. Empty = deliveries are unsigned. */
  webhookSecret: string;
  /** Include the full transcript in the webhook payload, not just the notes. */
  webhookIncludeTranscript: boolean;
  /**
   * Where action items go when somebody sends one. A TASK_TARGETS id, or empty
   * for off. See @ledgeur/core (tasks/push.ts) for the shape of each request.
   *
   * The credential lives here, in localStorage, alongside the webhook secret
   * that has always lived here. That is a deliberate limit, and it is the
   * reason the card says so out loud: this is a personal token on a personal
   * machine, not a team credential, and anything that can read this device's
   * localStorage can read it.
   */
  taskTarget: string;
  taskToken: string;
  /** Linear team id, Todoist project id, or Asana project gid. */
  taskContainer: string;
  /** Asana only. */
  taskWorkspace: string;
  /**
   * Send every action item to that destination as soon as a meeting finishes.
   *
   * Off by default. A meeting produces action items whether or not they were
   * meant as tasks, and forty issues nobody asked for is a worse outcome than
   * pressing a button four times.
   */
  taskAutoPush: boolean;
  /** How to sign off a follow-up email. Empty = no signature is invented. */
  senderName: string;
  /** Follow-up email register. */
  followUpTone: "warm" | "neutral" | "brief";
  /** Light, dark, or follow the system (the default — see lib/theme.ts). */
  theme: "system" | "light" | "dark";
}

const DEFAULTS: Settings = {
  proactiveSuggestions: true,
  suggestIntervalSec: 90,
  saveChatWithMeeting: false,
  transcriptionLang: DEFAULT_LANG,
  captureSystemAudio: false,
  noteTemplate: DEFAULT_TEMPLATE_ID,
  autoStartFromCalendar: false,
  webhookUrl: "",
  webhookSecret: "",
  webhookIncludeTranscript: false,
  taskTarget: "",
  taskToken: "",
  taskContainer: "",
  taskWorkspace: "",
  taskAutoPush: false,
  senderName: "",
  followUpTone: "neutral",
  theme: "system",
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

/** Subscribe outside React (the theme watcher). */
export const subscribeSettings = subscribe;

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
