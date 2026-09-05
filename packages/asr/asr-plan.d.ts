// Types for asr-plan.js. The implementation is deliberately plain ESM — the
// exact file is served to the browser at /asr-plan.js and imported by the
// transcription worker, so it cannot have a build step. This declaration lets
// the TypeScript apps import it without a second copy of the constants.

export declare const RUNTIMES: { readonly stable: string; readonly latest: string };
export declare const LANGS: readonly string[];

export interface SpokenLanguage {
  /** ISO 639-1 code passed to Whisper as a decoding hint. */
  code: string;
  label: string;
  /** How well the multilingual model actually does on it. Shown to the user. */
  tier: "strong" | "fair";
}
export declare const SPOKEN_LANGUAGES: readonly SpokenLanguage[];

export interface LangOption {
  /** A tier from LANGS, or `multi:<code>` for a specific spoken language. */
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
export declare function langTier(lang: string): string;
/** The ISO code to hand Whisper, or null to let it detect. */
export declare function whisperLanguage(lang: string): string | null;
export declare function langLabel(lang: string): string;
export declare function buildLoadPlan(lang: string, caps?: { webgpu?: boolean }): AsrAttempt[];
export declare function friendlyAsrError(err: unknown, opts?: { exhausted?: boolean }): string;
