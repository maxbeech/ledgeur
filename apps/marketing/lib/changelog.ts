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
    date: "2026-09-07",
    title: "Sync switched fully on, and the phone apps tested on real phones",
    changes: [
      { kind: "new", text: "Two-way sync is now switched on for everybody. Editing a title, renaming a speaker, filing a meeting into a space or deleting it reaches your other devices within a second or two, with nothing to refresh." },
      { kind: "fixed", text: "An open meeting never changed underneath you. If someone renamed, filed or deleted a meeting on another device while you had it open, the page carried on showing it as it was when you opened it, until you reloaded." },
      { kind: "fixed", text: "With no connection, Ledgeur told you your account had no workspace and to sign out and sign back in \u2014 the one thing you cannot do without a connection. It now says plainly that you are offline, that your work is saved on the device, and that it will sync on its own." },
      { kind: "fixed", text: "Coming back online could take up to five minutes to catch up, because nothing was watching for the connection returning. It now syncs a couple of seconds after your wifi or signal is back." },
      { kind: "fixed", text: "On Android, the phone's own navigation bar was drawn over the tabs at the bottom of the screen, across the Record button." },
      { kind: "fixed", text: "While a recording was catching up on a slower phone, Ledgeur warned that the speech model was returning nothing \u2014 and then never took the warning back once the words started arriving." },
    ],
  },
  {
    date: "2026-09-06",
    title: "A new look, a phone app, and sync that goes both ways",
    changes: [
      { kind: "changed", text: "Ledgeur has a new design: one typeface, a clean neutral canvas, and six pastel colours used for meaning — the copilot, live things, recording, warnings, and the people in your meetings. Every screen of the app and every page of this site was rebuilt on it, and it now has a dark mode that follows your system." },
      { kind: "fixed", text: "The desktop app had been using its own copy of the design and the copy had drifted: its secondary text colour failed the WCAG contrast standard, and it was the colour of every timestamp and hint in the product. There is one design now, shared by everything, with a test that measures every colour pairing in both light and dark." },
      { kind: "new", text: "Ledgeur on your phone. The iOS and Android apps are the same app as the desktop one — same code, same account — with a layout made for a phone, microphone recording, and the speech model downloaded the first time you record rather than at launch. They are built from source for now, not in the stores yet." },
      { kind: "fixed", text: "Sync only ever sent a meeting once, the moment it finished, and then never touched it again: renaming a speaker, editing the title, filing it into a space, the notes you typed — none of it reached your other devices, which showed the transcript as it was on the day. Every edit now syncs, deletions carry across, and a meeting keeps the same identity everywhere." },
      { kind: "new", text: "Spaces and your note recipes now follow your account instead of staying on the device that made them." },
      { kind: "new", text: "Changes from another device arrive on their own — a meeting recorded on your phone appears on your laptop within seconds, without refreshing." },
      { kind: "new", text: "Your whole library is kept on each device, so search, reading and asking questions work with the wifi off, and catch up when it is back." },
    ],
  },
  {
    date: "2026-09-05",
    title: "Asking mid-meeting, in 32 languages, with a link back to what was said",
    changes: [
      { kind: "fixed", text: "Asking the copilot a question during a meeting could only see the words spoken so far, as one undifferentiated block — no speakers, no timestamps, and nothing your company already knows. So “what did she just commit to?” was unanswerable, and anything needing a fact from outside the room came back as “I don’t have that information” while the fact sat one lookup away." },
      { kind: "new", text: "A mid-meeting question now reaches the transcript with speakers and timestamps, who has spoken and for how long, your own typed notes, and — in the same breath — your Contextely company memory, Notion, your past meetings and your calendar." },
      { kind: "new", text: "Every answer shows what it was allowed to see, and says so when something was missing: “Answered without Contextely company memory (timed out).” A source that fails is named with its own error instead of quietly vanishing." },
      { kind: "fixed", text: "In a long meeting the copilot was given the transcript with the end cut off — the most recent and most relevant part. It now always keeps the recent stretch and retrieves the earlier passages that bear on your question, marking anything it left out." },
      { kind: "new", text: "Every line of the notes links back to the moment it came from. Click “from 12:04” and the transcript opens there. A line nothing in the meeting supports gets no link at all, and is counted — because a bullet the recording does not back up is the one worth reading twice." },
      { kind: "new", text: "Follow-up emails, drafted from the meeting’s real decisions and action items, editable before they go anywhere. Nothing is invented: an action item with nobody’s name on it stays that way." },
      { kind: "new", text: "Write your own note styles. If you run the same kind of call every week, tell Ledgeur what to look for in it once." },
      { kind: "new", text: "32 spoken languages, each labelled with how well the model actually does on it. Previously “other languages” meant letting the model guess — which quietly turns a meeting that starts in English and continues in German into a whole transcript of invented English." },
      { kind: "new", text: "Spaces, for filing meetings. Deleting one keeps every meeting in it." },
      { kind: "new", text: "A people directory, built from who has actually spoken in your meetings. There is nothing to fill in." },
      { kind: "new", text: "Send finished meetings to anywhere you like with a signed webhook — Zapier, n8n, your own CRM. Notes by default, the transcript only if you ask; voice prints never leave, under any setting." },
      { kind: "new", text: "Ledgeur can start recording when a calendar meeting begins. Off unless you turn it on, only for meetings with a join link, and it tells you every time it does." },
      { kind: "new", text: "Sign in with your company’s single sign-on, where your workspace has it configured." },
      { kind: "fixed", text: "Starting a second meeting opened it with the previous meeting’s copilot conversation still in it." },
    ],
  },
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
