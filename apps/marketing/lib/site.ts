// Single source of truth for brand + site-wide constants. Imported everywhere
// (layout, metadata, sitemap, pages) so there is exactly one place to change
// the name, domain, pricing or repo URL.

export const SITE = {
  name: "ParleyNotes",
  domain: "parleynotes.com",
  // Until the custom domain DNS is attached this is the canonical live URL.
  url: "https://parleynotes.vercel.app",
  tagline: "Open-source, private AI meeting notes",
  description:
    "ParleyNotes is the open-source AI meeting assistant that runs 100% in your browser. Record or upload a meeting, get an instant private transcript and structured notes — no account, no cloud upload, no per-seat fee. Free forever for individuals; company licenses for teams.",
  repo: "https://github.com/maxbeech/parleynotes",
  contactEmail: "hello@parleynotes.com",
  // A real, CORS-enabled audio clip used by the "Try a sample" button so a
  // first-time visitor can see on-device transcription work in seconds.
  sampleAudioUrl: "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav",
} as const;

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
    body: "Unlike notetaker bots, ParleyNotes captures the meeting tab's audio directly. No awkward 'ParleyNotes has joined' in the participant list.",
  },
  {
    title: "Free for individuals",
    body: "Unlimited recordings, transcripts and notes at no cost. Pay only for team workspaces, SSO and a supported self-host bundle.",
  },
] as const;
