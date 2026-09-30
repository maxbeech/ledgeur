// Runtime configuration. Values come from Vite env (VITE_*) at build time.
// We never hardcode secrets or fake data — if Supabase isn't configured the app
// runs in local-only mode and screens show explicit "connect the backend" states.

// `import.meta.env` is a Vite build-time object; guard it so modules that read
// config stay importable under plain Node (unit tests) where it's undefined.
const env: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const CONFIG = {
  supabaseUrl: env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY ?? "",
  /** OpenAI-compatible HTTP fallback (BYO cloud key or external llama.cpp). The
   *  default on-device path is the in-process native engine — no server needed. */
  localLlmUrl: env.VITE_LOCAL_LLM_URL ?? "http://127.0.0.1:8081/v1",
  /** Error tracking. Blank disables Sentry entirely (local-only dev is silent). */
  sentryDsn: env.VITE_SENTRY_DSN ?? "",
  /** Product analytics (GA4 Measurement Protocol). This surface has no
   *  document for gtag.js, so it reports through the same OpenHelm Analytics
   *  property via ../../../../lib/openhelm-analytics-mp.ts. Blank disables it
   *  entirely — no client id is even generated. */
  gaMeasurementId: env.VITE_GA_MEASUREMENT_ID ?? "",
  gaApiSecret: env.VITE_GA_API_SECRET ?? "",
  mode: env.MODE ?? "development",
} as const;

/** True when a Supabase backend is configured. */
export const hasBackend = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
