// Single source of truth for brand + site-wide constants. Imported everywhere
// (layout, metadata, sitemap, pages) so there is exactly one place to change
// the name, domain, pricing or repo URL.

export const SITE = {
  name: "Ledgeur",
  domain: "ledgeur.com",
  url: "https://ledgeur.com",
  tagline: "The meeting record that never leaves your machine",
  /** The meta description. Kept under ~160 characters, because a search result
   *  is truncated there and a sentence cut mid-clause reads as carelessness. */
  description:
    "Record meetings and see who said what — transcription and speaker separation run in your browser. Free, open source, and nothing is ever uploaded.",
  /** The longer statement, for structured data and anywhere with room for it. */
  longDescription:
    "Ledgeur records, transcribes and separates speakers entirely in your browser. Name a voice once and it is recognised in every meeting after that. Drag in recordings you already have. Search everything anyone has said. Free forever and open source, with nothing uploaded — the paid plan syncs the record across your team and opens it to your AI agents over MCP.",
  repo: "https://github.com/maxbeech/ledgeur",
  // A real, CORS-enabled audio clip used by the "Try a sample" button so a
  // first-time visitor can see on-device transcription work in seconds.
  sampleAudioUrl: "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav",
} as const;

// The Supabase project this site talks to for auth landing pages — the page
// people reach from a "confirm your email" or "reset your password" message.
//
// Both values are publishable by design: the anon key carries the `anon` role,
// every table is behind row-level security, and the same key already ships
// inside the desktop app. They live here as ordinary config, with an env
// override, so the auth pages cannot silently break in an environment where
// someone forgot to set a variable.
export const SUPABASE = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ysmzzxkchfzbdxsrpgpw.supabase.co",
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzbXp6eGtjaGZ6YmR4c3JwZ3B3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MDQ5MjcsImV4cCI6MjA5OTE4MDkyN30.MraFJwedu6MFTxaAVyUjC0KixjJU8BENQDlod9OTiQQ",
} as const;

// Password rules, auth-capability parsing and error wording all live in
// @ledgeur/core/auth now — one definition shared with the app, rather than two
// that a test had to keep in step.
export { MIN_PASSWORD_LENGTH } from "@ledgeur/core";

// Pricing lives in lib/plans.ts — one definition, read by the pricing page, the
// comparison tables and the checkout route. Importing it from there rather than
// restating it here is the whole point.
export { PLANS, TEAM_PRICE_USD, planById, COMPARISON } from "./plans";

/** The four things worth knowing, reused across the hero, the alternatives
 *  pages and the feature grids — one definition, so the pitch cannot drift. */
export const VALUE_PROPS = [
  {
    title: "The audio never leaves",
    body: "Whisper runs in your browser. So does speaker separation. There is no upload step to trust us about — open the network tab and check.",
  },
  {
    title: "It learns who people are",
    body: "Ledgeur separates the voices in a recording, and once you have named one, it recognises that person in every meeting afterwards. The voice prints stay on your device.",
  },
  {
    title: "Nobody joins your call",
    body: "No bot in the participant list, no awkward pause while people ask what it is. Ledgeur listens to the tab, the way you would.",
  },
  {
    title: "Free is the whole product",
    body: "Unlimited recording, transcription, speakers, notes and search — permanently, for nothing. You pay when you want the record shared across a team, or open to your AI agents.",
  },
] as const;

/** Every navigable page, in one list. The header, the footer and the sitemap
 *  all read from this, so a new page cannot be launched unlinked. */
export const NAV = {
  product: [
    ["Open the app", "/app"],
    ["Download for Mac", "/download"],
    ["Pricing", "/pricing"],
    ["For agents (MCP)", "/agents"],
    ["Open source", "/open-source"],
  ],
  learn: [
    ["Blog", "/blog"],
    ["Use cases", "/use-cases"],
    ["Transcribe", "/transcribe"],
    ["Alternatives", "/alternatives"],
  ],
  company: [
    ["Security", "/security"],
    ["Privacy", "/privacy"],
    ["Terms", "/terms"],
    ["Changelog", "/changelog"],
  ],
} as const satisfies Record<string, readonly (readonly [string, string])[]>;
