// Runtime configuration. Values come from Vite env (VITE_*) at build time.
// We never hardcode secrets or fake data — if Supabase isn't configured the app
// runs in local-only mode and screens show explicit "connect the backend" states.

export const CONFIG = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
  /** Local llama.cpp OpenAI-compatible endpoint (native sidecar, task #8). */
  localLlmUrl: import.meta.env.VITE_LOCAL_LLM_URL ?? "http://127.0.0.1:8081/v1",
} as const;

/** True when a Supabase backend is configured. */
export const hasBackend = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
