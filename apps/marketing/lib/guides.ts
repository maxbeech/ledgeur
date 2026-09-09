// The pillars: three hubs that give twenty-eight flat blog posts a shape.
//
// ── The problem this solves ─────────────────────────────────────────────────
// Everything under /blog sat at one level, mixing comparison, how-to and
// definitional intent, with nothing linking a reader from "what is an AI
// meeting assistant" to the eight posts that answer the next question. That is
// bad for a person and worse for a crawler: twenty-eight posts competing with
// each other for the same terms, none of them the obvious answer to any of them.
//
// A pillar is the page that ranks for the broad term and hands the reader down
// to the specific one. Each of these three targets a term measured on
// 2026-09-09 in Google Ads Keyword Planner (US, trailing twelve months):
//
//   ai meeting assistant     4,400/mo, competition index 4  (the lowest of
//                            anything measured anywhere in this site's research)
//   speaker diarization      880/mo, index 22, and a $9.80 to $75.96 top-of-page
//                            bid range, which is what a technical buyer looks like
//   model context protocol   14,800/mo, index 29, and nobody in this category
//                            has written the meeting-record version of it
//
// ── The rule for this file ──────────────────────────────────────────────────
// `cluster` holds slugs from lib/posts. They are validated against POSTS at
// build time by the test in test/run.mts, because a pillar linking to a post
// that was renamed is a 404 from the one page whose entire job is to link.

export interface Guide {
  slug: string;
  /** The term this page is the answer to. */
  keyword: string;
  title: string;
  /** The H1. Longer than the title, and written as a claim. */
  headline: string;
  lede: string;
  /** Measured demand, so a future decision is made against a number. */
  demand: string;
  /** The argument, in sections. Kept as data so the page renders one way. */
  sections: readonly { heading: string; body: readonly string[] }[];
  /** Blog slugs this pillar hands the reader down to. */
  cluster: readonly string[];
  /** Product pages that answer the same question with a thing rather than an
   *  article. Rendered separately, because a reader who is ready for one should
   *  not have to find it among nine posts. */
  pages: readonly (readonly [label: string, href: string])[];
}

export const GUIDES: readonly Guide[] = [
  {
    slug: "ai-meeting-assistant",
    keyword: "ai meeting assistant",
    title: "AI meeting assistant: what one is, and what to look for",
    headline: "What an AI meeting assistant actually does, and the four questions that separate them.",
    lede:
      "The category went from novelty to default in about eighteen months, and the products in it are now so similar on a feature grid that the grid has stopped being useful. The differences that matter are architectural, and none of them appear on a comparison table.",
    demand: "4,400/mo",
    sections: [
      {
        heading: "The job, stated plainly",
        body: [
          "An AI meeting assistant listens to a conversation, writes down what was said, and turns it into something shorter that you can act on. Everything else is variation on those three steps: who joins the call, where the audio goes, what the summary is shaped like, and what happens to the record afterwards.",
          "Most people arrive at this category because they took bad notes in an important meeting, or because they took good notes and missed the meeting doing it. Both are real, and either is enough reason to use one.",
        ],
      },
      {
        heading: "Question one: does something join the call?",
        body: [
          "Most assistants work by sending a bot into the meeting through a calendar integration. It appears in the participant list, everybody sees it, and somebody usually asks what it is. That is a social cost on every external call you take.",
          "The alternative is capturing the audio the meeting is already playing on your machine. Nobody joins, nothing appears, and it works the same on Zoom, Teams, Meet, a phone call on speaker, or a conversation in a room.",
          "It also decides something less obvious: a bot can be locked out. Video platforms control their own participant APIs, and several now ship their own free notetaker. A tool that depends on being admitted as a guest depends on a decision somebody else makes.",
        ],
      },
      {
        heading: "Question two: where does the audio go?",
        body: [
          "Nearly every product in this category uploads the recording and processes it on their servers. That is not sinister, it is just how the software was built, and it is worth knowing because it decides what a security review will find and what happens to the recording if you stop paying.",
          "The alternative is running the speech model on your own machine. It is harder to build and it costs the vendor nothing to run, which is why the products that do it can afford to be free for one person.",
        ],
      },
      {
        heading: "Question three: does it tell you who said what?",
        body: [
          "A transcript without speakers is a wall of text. Separating voices is called diarization, and doing it well, with overlapping speech handled and the same person recognised across different meetings, is the single largest quality gap between products in this category.",
          "Ask specifically whether it recognises a person in a later meeting, not just whether it labels Speaker 1 and Speaker 2 within one recording. Those are very different features and the marketing rarely distinguishes them.",
        ],
      },
      {
        heading: "Question four: can anything else read the record?",
        body: [
          "This is the one nobody asks and the one that matters most in a year. A meeting archive that only its own app can read is a dead end: you cannot ask your coding agent why a decision was made, or have your assistant check what a customer objected to last quarter.",
          "The open answer is the Model Context Protocol, which lets an agent read the record directly. Ask whether the product has an MCP endpoint, or an API that is not shaped entirely around exporting to one CRM.",
        ],
      },
      {
        heading: "What to actually do",
        body: [
          "Record one real meeting with two candidates on the same day and read both transcripts. Accuracy differences are obvious immediately and invisible in a feature list, and speaker labelling either works on your accent, your microphone and your team or it does not.",
          "Then check the price against how much you will use it. Nearly everything here is metered by minutes, which is fine until a fortnight of workshops.",
        ],
      },
    ],
    cluster: [
      "best-ai-meeting-assistant-2026",
      "ai-meeting-summarizer-guide",
      "extract-action-items-from-meetings",
      "getting-started-ai-meeting-notes",
      "how-to-choose-ai-meeting-recorder",
      "ai-meeting-notes-without-a-bot",
      "meeting-notes-for-remote-teams",
      "what-is-meeting-recording-software",
    ],
    pages: [
      ["Compare the products directly", "/alternatives"],
      ["Templates for each kind of meeting", "/templates"],
      ["Pricing, and why free is the whole product", "/pricing"],
    ],
  },
  {
    slug: "private-meeting-transcription",
    keyword: "on-device transcription and speaker diarization",
    title: "Private meeting transcription: running the models on your own machine",
    headline: "Transcription that never leaves the device is no longer a research project.",
    lede:
      "Of fourteen meeting products surveyed in September 2026, exactly one besides Ledgeur ships any on-device processing at all, and that one is partial. This is a guide to why it is rare, why it is now possible anyway, and how to tell a real claim from a careful sentence.",
    demand: "880/mo (speaker diarization)",
    sections: [
      {
        heading: "What 'private' usually means, and what it can mean",
        body: [
          "Most privacy pages in this category are describing careful handling of data they hold: encryption in transit, encryption at rest, a retention policy, a promise not to train on your recordings. All of that is worth having, and all of it is a promise about what somebody does with a copy of your meeting that they have.",
          "The stronger version is not holding it. If the speech model runs in your browser, there is no copy on anybody's server to handle carefully, and the guarantee stops depending on the vendor's conduct.",
          "The test for which one you are reading is simple. Open the network tab during a recording and see whether any audio leaves.",
        ],
      },
      {
        heading: "Why almost nobody does it",
        body: [
          "Running Whisper in a browser tab was genuinely impractical until WebGPU and quantised ONNX builds arrived. Before that, a browser could not touch the GPU and the models were too large to ship.",
          "There is also a business reason. Server-side processing is where per-seat, per-minute pricing comes from. A product whose costs scale with your usage has to meter you; a product that runs on your hardware has nothing to meter, which is a worse business model right up until it becomes the reason people choose you.",
        ],
      },
      {
        heading: "What it costs you in practice",
        body: [
          "The first run downloads the model, once, and after that it is cached and works offline. A machine with WebGPU transcribes roughly in real time or better; one without falls back to the CPU and takes longer.",
          "The honest trade is that a hosted service with a datacentre GPU will sometimes finish faster on a long recording. What you get in exchange is no minute cap, no upload, and a record that keeps working if the company stops existing.",
        ],
      },
      {
        heading: "Diarization is the harder half",
        body: [
          "Speech recognition on-device is now well understood. Working out who was speaking is a second pipeline: a segmentation model to find where the voice changes, an embedding model to turn each stretch of speech into a vector, and clustering to decide which vectors are the same person.",
          "Both models are open and both run in a browser. The clustering is ordinary arithmetic, which means it can be unit-tested properly rather than being an opaque service.",
          "The part that makes it useful rather than impressive is persistence: keeping a voice print so the same person is recognised next week. That print is biometric, so where it is stored is a real decision and not a detail.",
        ],
      },
      {
        heading: "Questions worth asking a vendor",
        body: [
          "Does the audio leave the device, yes or no, with no clause after it. Where are voice prints stored, and are they synced. Can I self-host, and is the schema published. What happens to my recordings if I cancel. Is the source auditable.",
          "Every one of those has a one-word answer, and a vendor that needs a paragraph is telling you something.",
        ],
      },
    ],
    cluster: [
      "private-on-device-meeting-transcription",
      "whisper-in-the-browser-explained",
      "ai-note-taker-privacy-guide",
      "offline-meeting-transcription",
      "self-hosted-meeting-notes-for-enterprise",
      "free-meeting-transcription-tools",
      "hipaa-compliant-meeting-notes",
    ],
    pages: [
      ["How speaker identification works", "/speaker-identification"],
      ["The security model, and what we do not have", "/security"],
      ["The source, on GitHub", "/open-source"],
    ],
  },
  {
    slug: "meetings-for-ai-agents",
    keyword: "model context protocol",
    title: "Meetings for AI agents: MCP and the company record",
    headline: "Your agent is guessing about your work, and the answer was in a meeting.",
    lede:
      "The Model Context Protocol is how an AI tool reads a system it does not own. Search demand for it runs at roughly 14,800 a month and nobody in the meeting-notes category has written the version of this that matters: what it means when the system being read is everything your company has said out loud.",
    demand: "14,800/mo",
    sections: [
      {
        heading: "What MCP is, in one paragraph",
        body: [
          "The Model Context Protocol is an open standard for giving an AI model access to a system: a set of named tools it can call, with typed arguments and structured results. Instead of pasting a transcript into a chat window, the agent asks for the meeting it needs and gets it.",
          "It matters because it is the first interface in this space that is not a vendor's private API. A record exposed over MCP is readable by Claude, by ChatGPT, by Cursor, and by whatever exists in two years, without anybody building an integration for it.",
        ],
      },
      {
        heading: "Why meetings are the right thing to expose",
        body: [
          "Most of what makes a company's work legible is not written down. Why the architecture is like that, what the customer actually objected to, which decision was quietly reversed and why: all of it was said out loud in a meeting and none of it is in the documentation.",
          "That makes the meeting record the highest-context artefact a company produces and the least reusable one. Every question an agent gets wrong about your work, it gets wrong because it is reasoning from the documents rather than from the conversations.",
        ],
      },
      {
        heading: "The security question, which is the real question",
        body: [
          "Opening a meeting archive to an agent sounds alarming, and would be if it were done badly. The wrong shape is a service account with read access to everything, because then the agent's permissions are the union of everybody's.",
          "The right shape is that the agent runs as a person. A token resolves to one user's session, the database's row-level security decides what comes back, and an agent cannot read a meeting its owner could not. That is checkable rather than promised, because it is enforced in the database and not in application code.",
        ],
      },
      {
        heading: "What this looks like in practice",
        body: [
          "Ask your coding agent why a service was built the way it was, and it reads the design review. Ask an assistant what a customer has raised across four calls, and it searches the transcripts rather than the CRM notes somebody wrote afterwards.",
          "The useful tools are unglamorous: list the meetings, search them, get one in full with speakers and timestamps, list the open action items, list the people. Five tools cover almost everything anybody asks.",
        ],
      },
      {
        heading: "Where this is going",
        body: [
          "The category's best-funded players are converging on the same idea from the other direction: meetings as the seed of a broader context layer, held in their cloud, queried through their product. That is a real answer and it produces exactly one company that can read your history.",
          "The alternative is an open protocol over a record you hold, under a licence you can fork. Both will exist. It is worth deciding which one you want before you have four years of meetings inside it.",
        ],
      },
    ],
    cluster: [
      "fireflies-vs-otter-vs-ledgeur",
      "meeting-recording-transcription-software-compared",
      "extract-action-items-from-meetings",
      "meeting-notes-best-practices",
    ],
    pages: [
      ["Meetings as company memory", "/company-memory"],
      ["Connect an agent over MCP", "/agents"],
      ["What agent access costs", "/pricing"],
    ],
  },
];

export const guideBySlug = (slug: string): Guide | undefined => GUIDES.find((g) => g.slug === slug);
