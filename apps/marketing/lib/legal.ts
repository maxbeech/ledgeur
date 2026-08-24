// Legal and policy content, as data.
//
// Kept out of the page components so the "last reviewed" date is set in one
// place and cannot quietly go stale on one page while another is updated — and
// so the same statements can be quoted on the security page and the privacy
// notice without being written twice and drifting apart.

/** The date these documents were last reviewed. Update when the text changes,
 *  not when the site is redeployed. */
export const POLICY_UPDATED = "2026-08-24";

export const POLICY_UPDATED_LABEL = new Date(POLICY_UPDATED).toLocaleDateString("en-GB", {
  day: "numeric", month: "long", year: "numeric",
});

/**
 * The factual claims about data handling, stated once.
 *
 * Each of these is a property of how the code is written, not a promise about
 * how we behave — which is the only kind of privacy claim worth making. The
 * file that implements each is named so a reader can check.
 */
export const DATA_FACTS: readonly { claim: string; because: string }[] = [
  {
    claim: "Audio is never uploaded.",
    because: "Transcription and speaker separation run as WebAssembly and WebGPU inside your browser (packages/asr). There is no upload endpoint for audio in this product — not a disabled one, not an optional one.",
  },
  {
    claim: "Your library lives on your device.",
    because: "Meetings are stored in your browser's IndexedDB (packages/core/src/browser/library.ts). On the free plan they are never sent anywhere.",
  },
  {
    claim: "Voice prints never leave the device that heard the voice.",
    because: "They are stored separately from meetings and are excluded from sync. A voice print identifies a person even after the transcript is deleted, so it is treated as the most sensitive thing the product holds.",
  },
  {
    claim: "On the paid plan, only what you choose to sync is synced.",
    because: "Synced meetings are rows in a Postgres database behind row-level security (supabase/migrations/0002_rls.sql). Policies are written so a query returns your rows, or rows shared into your workspace, and nothing else.",
  },
  {
    claim: "An agent reading your meetings reads them as you.",
    because: "An access token resolves to a short-lived session for its owner, so the same row-level security applies (packages/mcp/src/auth.ts). The endpoint holds no standing privileges of its own.",
  },
  {
    claim: "We do not train anything on your meetings.",
    because: "There is no training pipeline in this product. The speech, speaker and summarisation models are pre-trained and read-only; the summariser on the free plan is a deterministic function over your transcript, not a model call.",
  },
];

/** What we actually collect, and why. The honest list. */
export const DATA_COLLECTED: readonly { what: string; when: string; why: string }[] = [
  { what: "Your email address", when: "Only if you create an account.", why: "To sign you in, and to email you about your subscription. Not used for marketing." },
  { what: "Your meetings, transcripts and notes", when: "Only on a paid plan, and only meetings you sync.", why: "So they are available on your other devices and to your workspace." },
  { what: "Payment details", when: "Only if you subscribe.", why: "Handled entirely by Stripe. We never see or store a card number." },
  { what: "A hash of each access token", when: "Only if you generate one.", why: "To check a presented token and to let you revoke it. The token itself is never stored." },
];
