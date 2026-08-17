// Single source of truth for brand + site-wide constants. Imported everywhere
// (layout, metadata, sitemap, pages) so there is exactly one place to change
// the name, domain, pricing or repo URL.

export const SITE = {
  name: "Ledgeur",
  domain: "ledgeur.com",
  url: "https://ledgeur.com",
  tagline: "Open-source, private AI meeting notes",
  description:
    "Ledgeur is the open-source AI meeting assistant that runs 100% in your browser. Record or upload a meeting, get an instant private transcript and structured notes — no account, no cloud upload, no per-seat fee. Free forever for individuals; company licenses for teams.",
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

/** Minimum password length. Must match MIN_PASSWORD_LENGTH in the desktop app
 *  (apps/desktop/src/lib/authMessages.ts) — a test asserts the two agree. */
export const MIN_PASSWORD_LENGTH = 8;

export const PRICING = {
  free: { name: "Personal", price: "$0", note: "Free forever" },
  team: { name: "Team", price: "$6", note: "per user / month" },
  company: { name: "Company license", price: "Custom", note: "self-host + SSO" },
} as const;

// Reused across hero, alternative pages and feature grids — one definition.
export const VALUE_PROPS = [
  {
    title: "100% on-device",
    body: "Audio is transcribed in your browser with Whisper. Nothing is uploaded to a server — your meetings never leave your machine.",
  },
  {
    title: "Open source",
    body: "MIT-licensed and self-hostable. Read the code, fork it, or run it inside your own network. No vendor lock-in.",
  },
  {
    title: "No bot joins your call",
    body: "Unlike notetaker bots, Ledgeur captures the meeting tab's audio directly. No awkward 'Ledgeur has joined' in the participant list.",
  },
  {
    title: "Free for individuals",
    body: "Unlimited recordings, transcripts and notes at no cost. Pay only for team workspaces, SSO and a supported self-host bundle.",
  },
] as const;
