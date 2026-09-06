// Light, dark, or whatever the system says.
//
// The design system's tokens follow `prefers-color-scheme` on their own; this
// only exists so a person can override that. "system" removes the attribute
// and lets CSS decide; the other two pin it. Applied once at start-up and again
// whenever the setting changes, so a toggle in Settings is immediate.

import { getSettings, subscribeSettings, type Settings } from "./settings.ts";

export type ThemeChoice = Settings["theme"];

export function applyTheme(choice: ThemeChoice = getSettings().theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

/** Wire the setting to the document for the life of the app. */
export function watchTheme(): () => void {
  applyTheme();
  return subscribeSettings(() => applyTheme());
}
