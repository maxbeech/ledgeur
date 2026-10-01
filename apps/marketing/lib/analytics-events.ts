// Every product event the web app sends, in one typed map. Call sites go
// through `emit` so a misspelt event name or param is a type error rather than
// a metric that is silently always zero.

import { track } from "../../../lib/openhelm-analytics";

type Source = "web" | "web_import";

export interface AnalyticsEventMap {
  sign_up: { method: "email" };
  sign_up_failed: { reason: string };
  login: { method: "email" };
  login_failed: { reason: string };
  checkout_started: Record<string, never>;
  checkout_failed: { reason: string };
  purchase: { currency: "USD" };
  purchase_confirmation_failed: { waited_seconds: number };
  billing_portal_opened: Record<string, never>;
  billing_portal_failed: { reason: string };
  capture_started: { source: Source; system_audio: boolean; mic: boolean };
  capture_failed: { source: Source };
  meeting_saved: { source: Source; segments: number; word_count?: number };
  meeting_save_failed: { source: Source };
}

export function emit<K extends keyof AnalyticsEventMap>(name: K, params?: AnalyticsEventMap[K]): void {
  track(name, params as Record<string, unknown> | undefined);
}
