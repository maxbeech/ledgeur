/**
 * OpenHelm Analytics: the non-browser half (desktop, mobile, server).
 *
 * ⚠️ GENERATED. Canonical copy:
 * `ProductFactory/_services/openhelm-analytics/openhelm-analytics-mp.ts`.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE TAG. gtag.js needs a document. A Tauri or
 * Electron shell, an Expo/React Native app, a CLI, a cron job and a webhook
 * handler have none, so a product whose only measurement is the web tag goes
 * dark the moment it grows a surface that is not a web page. GA4's Measurement
 * Protocol is the supported way in for those, and it reports to the SAME GA4
 * property: one property per product, several streams under it, so the
 * numbers add up instead of living in separate accounts.
 *
 * STREAMS, AND WHY THE CREDENTIALS DIFFER PER SURFACE. GA4 has exactly three
 * stream types (web, Android app, iOS app) and there is NO desktop type.
 * So:
 *   • Web page          → the gtag tag (openhelm-analytics.tsx), web stream.
 *   • Server / desktop  → this file in `web` mode, against the SAME web
 *                         stream's measurement id (G-...) + an API secret.
 *   • Android / iOS app → this file in `app` mode, against that app stream's
 *                         FIREBASE APP ID (1:...:android:...) + an API secret.
 * A desktop app is measured as a web-stream client because that is the only
 * thing GA4 offers it; it is not a mistake, and `platform` below records which
 * surface an event actually came from so the two are separable in reports.
 *
 * THE API SECRET IS A SERVER SECRET. `GA_API_SECRET` is NOT `NEXT_PUBLIC_`, and
 * must never be shipped in a web bundle: anyone holding it can write events
 * into the property. In a desktop or mobile build it is embedded in the client
 * by necessity (the app IS the client); treat it as low-value and rotatable,
 * scoped to one stream, exactly as Google intends.
 *
 * CLIENT ID IS THE UNIT OF "A USER". It must be stable for the life of an
 * install, or every event starts its own session and the user counts become
 * meaningless. This module does not invent or persist one; the caller owns
 * storage (Tauri store, AsyncStorage, a config file) because only the caller
 * knows what survives a reinstall. `newClientId()` is here to generate the
 * first one.
 *
 * NO SILENT SUCCESS. Unconfigured returns `{ sent: false, reason:
 * "not_configured" }`. GA4's collect endpoint answers 204 to almost anything,
 * including payloads it then discards, so `validate()` exists to check a
 * payload against Google's own debug endpoint and is the only way to know a
 * payload is actually accepted. Use it in a test, not on every send.
 */

const COLLECT_URL = "https://www.google-analytics.com/mp/collect";
const DEBUG_URL = "https://www.google-analytics.com/debug/mp/collect";

/** GA4 caps a single Measurement Protocol request at 25 events. */
export const MAX_EVENTS_PER_REQUEST = 25;

export type Surface = "desktop" | "server" | "android" | "ios" | "web";

export interface AnalyticsEvent {
  /** ≤40 chars, letters/digits/underscore, must start with a letter. */
  name: string;
  params?: Record<string, unknown>;
}

export interface MeasurementConfig {
  /** Web/desktop/server: the `G-...` measurement id. */
  measurementId?: string;
  /** Android/iOS app streams: the `1:...:android:...` Firebase app id. */
  firebaseAppId?: string;
  /** Per-stream API secret. Server-side secret, never `NEXT_PUBLIC_`. */
  apiSecret?: string;
  /** Stable per-install id. Required. */
  clientId?: string;
  /** Which surface these events came from; recorded on every event. */
  surface?: Surface;
}

export type SendResult =
  | { sent: true; events: number }
  | { sent: false; reason: "not_configured" | "no_events" | "invalid" | "error"; error?: string };

/** Read configuration from the environment, for the common case. */
export function configFromEnv(env: Record<string, string | undefined> = process.env): MeasurementConfig {
  return {
    measurementId: env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || env.GA_MEASUREMENT_ID?.trim(),
    firebaseAppId: env.GA_FIREBASE_APP_ID?.trim(),
    apiSecret: env.GA_API_SECRET?.trim(),
    surface: (env.GA_SURFACE?.trim() as Surface) || undefined,
  };
}

/** A fresh client id in GA's own `<random>.<seconds>` shape. */
export function newClientId(now: () => number = Date.now): string {
  const rand = Math.floor(Math.random() * 2 ** 31);
  return `${rand}.${Math.floor(now() / 1000)}`;
}

/**
 * GA4 rejects event names it does not like, silently, at collect time. Checking
 * here turns that into a caller-visible error instead of a metric that is
 * simply always zero.
 */
export function isValidEventName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(name);
}

function buildPayload(config: MeasurementConfig, events: AnalyticsEvent[]) {
  const app = Boolean(config.firebaseAppId);
  /*
   * `engagement_time_msec` and `session_id` are not decoration. Without them a
   * Measurement Protocol event is accepted (204) and then omitted from realtime
   * and most standard reports, which reads exactly like the events never
   * arrived, the single most common reason MP "does not work".
   */
  const sessionId = String(Math.floor(Date.now() / 1000));
  const body: Record<string, unknown> = {
    events: events.map((e) => ({
      name: e.name,
      params: {
        engagement_time_msec: 1,
        session_id: sessionId,
        platform: config.surface ?? (app ? "app" : "server"),
        ...e.params,
      },
    })),
  };
  if (app) body.app_instance_id = config.clientId;
  else body.client_id = config.clientId;
  return body;
}

function endpoint(base: string, config: MeasurementConfig): string {
  const q = new URLSearchParams({ api_secret: config.apiSecret ?? "" });
  if (config.firebaseAppId) q.set("firebase_app_id", config.firebaseAppId);
  else q.set("measurement_id", config.measurementId ?? "");
  return `${base}?${q.toString()}`;
}

function configured(config: MeasurementConfig): boolean {
  return Boolean(config.apiSecret && config.clientId && (config.measurementId || config.firebaseAppId));
}

/**
 * Send events. Never throws: a product must not fail a user's action because
 * analytics was unreachable.
 */
export async function sendEvents(
  config: MeasurementConfig,
  events: AnalyticsEvent[],
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  if (!configured(config)) return { sent: false, reason: "not_configured" };
  if (events.length === 0) return { sent: false, reason: "no_events" };
  if (events.length > MAX_EVENTS_PER_REQUEST) {
    return { sent: false, reason: "invalid", error: `at most ${MAX_EVENTS_PER_REQUEST} events per request` };
  }
  const bad = events.find((e) => !isValidEventName(e.name));
  if (bad) return { sent: false, reason: "invalid", error: `invalid event name: ${bad.name}` };

  try {
    const res = await fetchImpl(endpoint(COLLECT_URL, config), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(config, events)),
    });
    if (!res.ok) return { sent: false, reason: "error", error: `HTTP ${res.status}` };
    return { sent: true, events: events.length };
  } catch (error) {
    return { sent: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

/** Convenience for the one-event case. */
export async function trackEvent(
  config: MeasurementConfig,
  name: string,
  params: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  return sendEvents(config, [{ name, params }], fetchImpl);
}

/**
 * Ask Google's debug endpoint whether a payload would actually be accepted.
 * The live endpoint answers 204 regardless, so this is the only honest check:
 * use it in a test or a setup script, not on the hot path.
 */
export async function validate(
  config: MeasurementConfig,
  events: AnalyticsEvent[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ valid: boolean; messages: string[] }> {
  if (!configured(config)) return { valid: false, messages: ["not configured"] };
  const res = await fetchImpl(endpoint(DEBUG_URL, config), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPayload(config, events)),
  });
  const json = (await res.json()) as { validationMessages?: { description?: string }[] };
  const messages = (json.validationMessages ?? []).map((m) => m.description ?? "unknown");
  return { valid: messages.length === 0, messages };
}
