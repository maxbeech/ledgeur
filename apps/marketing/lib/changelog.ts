// The changelog, as data.
//
// Only things a user would notice. Refactors, test coverage and dependency
// bumps do not belong here — a changelog full of "chore:" entries is one nobody
// reads, and this one is meant to be read by somebody deciding whether to trust
// the product.

export interface Release {
  /** ISO date. */
  date: string;
  title: string;
  /** What changed, in the user's terms. */
  changes: readonly { kind: "new" | "fixed" | "changed"; text: string }[];
}

export const RELEASES: readonly Release[] = [
  {
    date: "2026-08-24",
    title: "Speakers, imports, and an honest price list",
    changes: [
      { kind: "new", text: "Ledgeur now works out who is speaking. Two on-device models find where the voice changes and turn each stretch of speech into a voice print, so a recording comes back as Speaker 1, Speaker 2, Speaker 3 rather than one undifferentiated block." },
      { kind: "new", text: "Name a voice once and it is recognised in every meeting after that. Voice prints are stored in your browser and are never synced or uploaded." },
      { kind: "new", text: "Drag any recording onto the app — a voice memo, a Zoom export, an old interview — and it is transcribed, separated and filed exactly like a live meeting." },
      { kind: "new", text: "The transcript now carries timestamps, and search looks inside every meeting rather than only at titles." },
      { kind: "new", text: "A real web app: a library, search across everything said, per-speaker talking time, Markdown export, and your own notes kept verbatim." },
      { kind: "new", text: "Accounts on the web, so sync and agent access can be bought and used without installing anything." },
      { kind: "new", text: "Name a speaker from a saved transcript, days after the meeting — not only by enrolling them in advance. Meetings keep each voice print, which is what makes a late answer possible." },
      { kind: "fixed", text: "Buying the paid plan from the pricing page took the payment but activated nothing, because the subscription was never attached to a workspace. Checkout now resolves the workspace from your own signed-in session and refuses to start if it cannot." },
      { kind: "fixed", text: "Every agent access token issued by the app was unusable: the token recorded and the token presented were different things. Tokens are now opaque secrets, stored only as a hash, and exchanged for a scoped session that row-level security applies to." },
      { kind: "fixed", text: "You can now cancel from your account page, through Stripe's billing portal, instead of emailing us." },
      { kind: "fixed", text: "Five colours in the interface failed WCAG AA contrast, including the small labels above each section. All of them now pass, and a test keeps them passing." },
      { kind: "changed", text: "The price list now describes only what exists. SSO, SCIM, an admin audit log and a packaged self-host bundle were advertised and are not built — they have been removed, and the pricing page now publishes what we do not have." },
      { kind: "changed", text: "The website and the app finally look like the same product." },
      { kind: "fixed", text: "Recording failed silently when the browser refused permission to use your microphone — the button appeared to do nothing. Permission is now asked for before the model downloads, so it fails in a second rather than a minute, and every refusal is explained in a sentence that says what to do about it." },
      { kind: "fixed", text: "The last few seconds of a meeting could be missing from the transcript, depending on where the transcription cycle happened to fall when you pressed stop. Stopping now waits for the audio still being worked on before it finishes." },
      { kind: "fixed", text: "The meeting library could hang on “Opening your library…” indefinitely if you had a second Ledgeur tab open. It now says so, and offers you the fix." },
      { kind: "fixed", text: "The image shown when Ledgeur is shared on social media had the wrong letter in the logo." },
      { kind: "changed", text: "Speaker separation was tuned against real recordings rather than a plausible-sounding guess: a two-speaker clip that was being split into four now comes back as two, and a familiar voice on a poor microphone is still recognised." },
    ],
  },
  {
    date: "2026-08-14",
    title: "Universal Mac build",
    changes: [
      { kind: "new", text: "The macOS app ships as a universal binary, so it runs natively on Intel Macs as well as Apple silicon." },
    ],
  },
  {
    date: "2026-08-08",
    title: "A hosted endpoint for agents",
    changes: [
      { kind: "new", text: "Agent access no longer requires running a process: point any MCP client that speaks HTTP at the hosted endpoint." },
    ],
  },
  {
    date: "2026-08-02",
    title: "Sign-in by email, and steadier transcription",
    changes: [
      { kind: "new", text: "Email and password sign-in, with working confirmation and password-reset emails." },
      { kind: "fixed", text: "Transcription failed to start for everyone without WebGPU. The model loader now walks a fallback ladder in a fresh worker each time, because a failed session poisons the runtime." },
      { kind: "changed", text: "Sign-in buttons for providers the backend does not have configured are no longer shown." },
    ],
  },
];
