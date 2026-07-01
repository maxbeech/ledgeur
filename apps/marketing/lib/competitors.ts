// Single source of truth for /alternatives/[slug] programmatic SEO pages.
// Each entry targets a real "[competitor] alternative" / "open source [x]" query.
// Content is specific and factual (positioning + pricing model as publicly
// described); no fabricated metrics.

export interface Competitor {
  slug: string;
  name: string;
  /** Search demand note from live Google Ads data (US). */
  demand: string;
  /** One-line summary of what they are. */
  what: string;
  /** How they price / their model — public positioning. */
  model: string;
  /** Concrete points where ParleyNotes differs. */
  diff: string[];
}

export const COMPETITORS: Competitor[] = [
  {
    slug: "granola",
    name: "Granola",
    demand: "granola alternative 260/mo (rising) · open source granola 50→110/mo",
    what: "A macOS AI notepad that listens to your meeting audio and enhances your typed notes with an AI summary after the call.",
    model: "Paid subscription per seat after a free trial; macOS-first desktop app; transcripts and notes are processed in its cloud.",
    diff: [
      "ParleyNotes is open source (MIT) — Granola is closed source.",
      "Transcription runs locally in your browser; Granola sends audio to its servers for processing.",
      "Works on any OS with a Chromium browser, not just macOS.",
      "Free forever for individuals — no trial clock, no per-seat fee until you want team features.",
    ],
  },
  {
    slug: "otter-ai",
    name: "Otter.ai",
    demand: "otter ai alternatives 390/mo · alternatives to otter ai 110/mo · otter alternative 90/mo",
    what: "A cloud transcription service that records meetings, generates live transcripts and AI summaries, and stores them in your Otter account.",
    model: "Freemium with strict monthly transcription minutes; paid tiers per user; recordings live in Otter's cloud.",
    diff: [
      "No monthly minute caps — transcribe as much as you want, it runs on your device.",
      "Your recordings never leave the browser; Otter stores everything in its cloud.",
      "No notetaker bot joins the call — ParleyNotes captures the meeting tab audio directly.",
      "Self-hostable and open source for organisations with data-residency rules.",
    ],
  },
  {
    slug: "fireflies-ai",
    name: "Fireflies.ai",
    demand: "fireflies ai note taker 4,400/mo",
    what: "A meeting assistant bot that joins calls via a calendar integration, records and transcribes them, and pushes notes to your CRM.",
    model: "Per-seat SaaS; a bot joins the call; transcripts stored and analysed in Fireflies' cloud.",
    diff: [
      "No bot in the participant list — capture happens locally from the meeting tab.",
      "Privacy by default: audio is processed on-device, not in a third-party cloud.",
      "Free for individuals; pay only for shared team workspaces.",
      "Open source — auditable and self-hostable for security-conscious teams.",
    ],
  },
  {
    slug: "fathom",
    name: "Fathom",
    demand: "ai meeting assistant cluster 3,600/mo (comp 10)",
    what: "A free-for-individuals notetaker that records Zoom/Meet/Teams calls via a bot and produces highlights and summaries.",
    model: "Free tier for individuals with paid team plans; cloud recording and storage; a bot joins the call.",
    diff: [
      "ParleyNotes is open source; Fathom is closed source.",
      "On-device transcription — no cloud upload of your meeting audio.",
      "No bot joining the meeting; works from any meeting tab.",
      "Bring your own AI key for summaries, or use the built-in offline summarizer with no key at all.",
    ],
  },
  {
    slug: "tldv",
    name: "tl;dv",
    demand: "ai meeting notes 1,300/mo · meeting recorder long-tail",
    what: "A meeting recorder that captures Zoom/Meet/Teams calls with a bot, timestamps highlights, and shares clips.",
    model: "Freemium per-seat SaaS; bot-based recording; clips and transcripts hosted in tl;dv's cloud.",
    diff: [
      "No recording bot — ParleyNotes captures the tab audio directly.",
      "Local-first: transcripts stay in your browser unless you export them.",
      "Open source and self-hostable.",
      "No per-seat paywall for the core notetaking individuals rely on.",
    ],
  },
  {
    slug: "avoma",
    name: "Avoma",
    demand: "ai meeting assistant / ai meeting notes cluster",
    what: "A revenue-team meeting assistant with transcription, conversation intelligence and CRM sync.",
    model: "Per-seat SaaS aimed at sales teams; cloud processing; bot joins calls.",
    diff: [
      "Lightweight and private rather than a heavy revenue-intelligence suite.",
      "On-device transcription with no cloud storage of audio.",
      "Free for individuals; open-source core.",
      "No bot, no calendar-wide auto-recording you have to police.",
    ],
  },
  {
    slug: "sembly-ai",
    name: "Sembly AI",
    demand: "ai meeting assistant cluster",
    what: "A meeting assistant that records, transcribes and generates tasks and meeting minutes across platforms.",
    model: "Per-seat SaaS; bot-based recording; cloud transcription and analytics.",
    diff: [
      "Private by design — audio processed locally, not in Sembly's cloud.",
      "No participant-list bot.",
      "Open source and free for individuals.",
      "Export clean Markdown notes you fully own.",
    ],
  },
  {
    slug: "notta",
    name: "Notta",
    demand: "meeting transcription app 480/mo · ai meeting notes cluster",
    what: "A transcription app for meetings, interviews and voice memos with real-time captions and summaries.",
    model: "Freemium with monthly transcription limits; cloud-based; paid per-user tiers.",
    diff: [
      "No monthly minute limits — transcription runs on your hardware.",
      "Audio never uploaded; everything stays local.",
      "Free for individuals, open source for teams that need to self-host.",
      "Upload an existing recording or capture live — both fully offline-capable after model load.",
    ],
  },
  {
    slug: "fellow-app",
    name: "Fellow",
    demand: "meeting notes app 880/mo",
    what: "A meeting-management tool with agendas, collaborative notes and an AI notetaker add-on.",
    model: "Per-seat SaaS focused on agendas and workflows; AI recording in its cloud.",
    diff: [
      "Focused on fast, private transcription rather than a full meeting-workflow suite.",
      "On-device processing, no cloud upload of audio.",
      "Free for individuals; open source.",
      "Drop into any meeting without onboarding a whole team.",
    ],
  },
  {
    slug: "read-ai",
    name: "Read.ai",
    demand: "ai meeting assistant 3,600/mo (comp 10)",
    what: "A meeting assistant that scores engagement, summarises calls and tracks speaker analytics via a bot.",
    model: "Per-seat SaaS; bot joins calls; cloud analytics and storage.",
    diff: [
      "No surveillance-style analytics — just clean private notes.",
      "Local transcription; nothing sent to a third party.",
      "No bot in the meeting.",
      "Open source and free for individuals.",
    ],
  },
  {
    slug: "supernormal",
    name: "Supernormal",
    demand: "ai meeting notes 1,300/mo cluster",
    what: "An AI notetaker that joins calls, writes summaries and syncs notes to your docs and CRM.",
    model: "Freemium per-seat SaaS; bot-based; cloud processing.",
    diff: [
      "Bot-free capture from the meeting tab.",
      "Private, on-device transcription.",
      "Free for individuals; open source and self-hostable.",
      "Bring your own AI model for summaries — no lock-in to one provider.",
    ],
  },
  {
    slug: "krisp",
    name: "Krisp",
    demand: "ai meeting assistant / ai notetaker cluster",
    what: "A noise-cancellation app that added an AI meeting notetaker and transcription layer.",
    model: "Freemium desktop app; cloud transcription for the notetaker features.",
    diff: [
      "Purpose-built for private meeting notes rather than a noise-cancel add-on.",
      "Transcription stays on-device.",
      "Open source and free for individuals.",
      "No account required to start.",
    ],
  },
];

export const competitorBySlug = (slug: string) =>
  COMPETITORS.find((c) => c.slug === slug);
