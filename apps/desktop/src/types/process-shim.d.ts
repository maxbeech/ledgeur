// Minimal ambient `process` so `tsc` can typecheck
// ../../../../lib/openhelm-analytics-mp.ts (a file shared with Node/Next.js
// surfaces, whose configFromEnv() defaults to `process.env`) when it is
// imported from this Vite/Tauri app, which has no @types/node and never
// actually runs configFromEnv() itself (see src/lib/analytics.ts — it builds
// a MeasurementConfig by hand from import.meta.env instead). No runtime
// `process` global exists in this app; this declaration exists for the
// compiler only.
declare const process: { env: Record<string, string | undefined> };
