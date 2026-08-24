// Types for asr-plan.js. The implementation is deliberately plain ESM — the
// exact file is served to the browser at /asr-plan.js and imported by the
// transcription worker, so it cannot have a build step. This declaration lets
// the TypeScript apps import it without a second copy of the constants.

export declare const RUNTIMES: { readonly stable: string; readonly latest: string };
export declare const LANGS: readonly string[];

export interface LangOption {
  /** One of LANGS. */
  value: string;
  label: string;
  hint: string;
}
export declare const LANG_OPTIONS: readonly LangOption[];

export interface AsrAttempt {
  id: string;
  runtime: string;
  device: "webgpu" | "wasm";
  model: string;
  dtype: string;
  label: string;
}

export declare function runtimeUrl(version: string): string;
export declare function normaliseLang(lang: string): string;
export declare function buildLoadPlan(lang: string, caps?: { webgpu?: boolean }): AsrAttempt[];
export declare function friendlyAsrError(err: unknown, opts?: { exhausted?: boolean }): string;
