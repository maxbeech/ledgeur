// Single source of truth for /transcribe/[slug] programmatic SEO pages.
// Targets the high-volume, beatable "[platform] transcription / meeting notes"
// long-tail (live Google Ads US data, fetched 2026-06-14).

export interface Platform {
  slug: string;
  name: string;
  /** Live search-demand note. */
  demand: string;
  /** How to capture audio from this platform in the browser. */
  how: string;
  /** Platform-specific tips shown as bullets. */
  tips: string[];
}

export const PLATFORMS: Platform[] = [
  {
    slug: "zoom",
    name: "Zoom",
    demand: "zoom transcription 1,900/mo · transcribe zoom 1,900/mo · zoom transcript 880/mo",
    how: "Join your Zoom meeting in the browser (Zoom Web Client) or share the Zoom window/tab in ParleyNotes. Enable 'Share tab audio' so the other participants' voices are captured alongside your mic.",
    tips: [
      "Use the Zoom Web Client (zoom.us/wc) so the call runs in a browser tab you can share with audio.",
      "When prompted to choose what to share, pick the Zoom tab and tick 'Share tab audio'.",
      "Your microphone is captured separately, so both sides of the conversation are transcribed.",
      "Nothing is uploaded to Zoom's cloud or ours — the transcript is built on your device.",
    ],
  },
  {
    slug: "google-meet",
    name: "Google Meet",
    demand: "google meet transcription 880/mo · google meet transcribe 90/mo",
    how: "Google Meet runs in the browser already. In ParleyNotes choose 'Capture a tab', select your Meet tab and enable 'Share tab audio' to record everyone on the call.",
    tips: [
      "Keep the Meet tab open; share that exact tab with audio enabled.",
      "Add your microphone so your own voice is included in the transcript.",
      "Works without Google's paid Workspace transcription add-on.",
      "Captions and notes stay private — Google never sees the transcript ParleyNotes builds.",
    ],
  },
  {
    slug: "microsoft-teams",
    name: "Microsoft Teams",
    demand: "teams transcription 720/mo (comp 19) · microsoft teams transcription 480/mo (comp 18) · teams meeting transcription 390/mo",
    how: "Open Teams in the browser (teams.microsoft.com) and join the meeting there, then share that tab with audio in ParleyNotes to transcribe the whole conversation.",
    tips: [
      "Use the Teams web app so the meeting lives in a shareable browser tab.",
      "Enable 'Share tab audio' to capture remote participants.",
      "No Teams Premium licence required for transcription.",
      "Ideal where IT policy forbids sending meeting audio to external notetaker clouds.",
    ],
  },
  {
    slug: "webex",
    name: "Webex",
    demand: "meeting transcription app 480/mo · webex transcription long-tail",
    how: "Join Webex in the browser and share the Webex tab with audio in ParleyNotes. Your mic is mixed in so both sides are transcribed.",
    tips: [
      "Use 'Join from browser' in the Webex invite.",
      "Share the tab with audio enabled.",
      "Great for regulated industries that need on-device processing.",
      "Export the transcript and notes as Markdown when you're done.",
    ],
  },
  {
    slug: "slack-huddles",
    name: "Slack Huddles",
    demand: "ai meeting notes / meeting transcription cluster",
    how: "Run the Slack huddle in the Slack web app, share that tab with audio in ParleyNotes, and add your microphone to capture the full huddle.",
    tips: [
      "Open Slack in a browser tab so the huddle audio can be shared.",
      "Enable 'Share tab audio' before the huddle starts.",
      "Perfect for fast, ad-hoc huddles that don't justify a paid notetaker seat.",
      "Notes are saved locally and exportable to Markdown.",
    ],
  },
  {
    slug: "discord",
    name: "Discord",
    demand: "meeting / call transcription long-tail",
    how: "Use Discord in the browser, join the voice channel, and share that tab with audio in ParleyNotes to transcribe the conversation.",
    tips: [
      "Open discord.com in a browser tab and join the voice channel there.",
      "Share the Discord tab with audio.",
      "Useful for community calls, study groups and standups.",
      "Everything stays on your machine.",
    ],
  },
  {
    slug: "google-voice-and-phone-calls",
    name: "phone & VoIP calls",
    demand: "meeting transcription app 480/mo · call transcription long-tail",
    how: "For browser-based calling (Google Voice, dialers in a tab), share the call tab with audio. For other audio, record it and upload the file to ParleyNotes to transcribe.",
    tips: [
      "Share the dialer tab with audio for live transcription.",
      "Or upload an existing call recording (MP3/WAV/M4A) to transcribe offline.",
      "Check local laws on recording calls before you start.",
      "Transcription and notes are generated entirely on your device.",
    ],
  },
];

export const platformBySlug = (slug: string) =>
  PLATFORMS.find((p) => p.slug === slug);
