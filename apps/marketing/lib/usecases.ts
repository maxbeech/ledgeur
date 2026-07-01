// Single source of truth for /use-cases/[slug] programmatic SEO pages.
// Targets "ai meeting notes for [x]" / "[x] transcription" intent.

export interface UseCase {
  slug: string;
  name: string;
  /** H1 / headline framing. */
  headline: string;
  /** Why this audience needs private, on-device notes. */
  why: string;
  /** What the structured notes capture for this use case. */
  captures: string[];
}

export const USE_CASES: UseCase[] = [
  {
    slug: "sales-calls",
    name: "Sales calls",
    headline: "AI notes for sales calls — without a bot tipping off the prospect",
    why: "A notetaker bot joining the call signals 'you're being recorded for our CRM'. ParleyNotes captures the call tab quietly and privately, so reps get clean notes without the awkward bot.",
    captures: ["Prospect pain points and objections", "Pricing and next-step commitments", "Action items and follow-up dates", "Verbatim quotes for the CRM"],
  },
  {
    slug: "user-interviews",
    name: "User interviews",
    headline: "Private transcription for user research interviews",
    why: "Research interviews contain sensitive participant data. On-device transcription keeps it out of third-party clouds, which makes consent and GDPR far simpler.",
    captures: ["Verbatim participant quotes", "Pain points and feature requests", "Themes across sessions", "Timestamps for clipping highlights"],
  },
  {
    slug: "standups",
    name: "Standups",
    headline: "Daily standup notes that write themselves",
    why: "Nobody wants to take standup minutes. Capture the huddle tab, get a per-person summary of what was done, what's next and blockers — in seconds, free.",
    captures: ["Yesterday / today / blockers per person", "Decisions made", "Action items with owners", "A shareable Markdown digest"],
  },
  {
    slug: "one-on-ones",
    name: "1:1s",
    headline: "Notes for 1:1 meetings, kept private to you",
    why: "1:1s are confidential by nature. Keeping the transcript and notes on your own device — never a shared cloud — respects that trust.",
    captures: ["Talking points and feedback", "Career and growth commitments", "Follow-ups for next time", "A private running history per report"],
  },
  {
    slug: "hiring-interviews",
    name: "Hiring interviews",
    headline: "Structured interview notes for fairer hiring",
    why: "Consistent, evidence-based notes reduce bias. Transcribe interviews on-device and turn them into a structured scorecard you control.",
    captures: ["Candidate answers per competency", "Strengths and concerns", "Follow-up questions for the next round", "Quotes to support the decision"],
  },
  {
    slug: "lectures-and-classes",
    name: "Lectures & classes",
    headline: "Turn lectures into searchable notes",
    why: "Students get a free, unlimited transcriber that works offline after the first load — no subscription, no minute caps, no account.",
    captures: ["Key concepts and definitions", "Exam hints the lecturer flags", "A clean summary to revise from", "Timestamps to jump back to tricky parts"],
  },
  {
    slug: "podcasts",
    name: "Podcasts",
    headline: "Transcribe podcast episodes for show notes & SEO",
    why: "Upload an episode and get a full transcript plus a summary you can publish as SEO-friendly show notes — no per-minute transcription bill.",
    captures: ["Full episode transcript", "Chapter-style summary", "Pull quotes for social", "Show notes in Markdown"],
  },
  {
    slug: "customer-support",
    name: "Customer support calls",
    headline: "Capture support calls privately for QA",
    why: "Support conversations contain customer PII. On-device transcription keeps that data in-house while still giving QA clean, structured call notes.",
    captures: ["The customer's issue and resolution", "Sentiment and escalation flags", "Action items and follow-ups", "Quotes for product feedback"],
  },
  {
    slug: "consulting-and-client-meetings",
    name: "Client meetings",
    headline: "Client meeting notes you fully own",
    why: "Consultants bill on outcomes, not minute-taking. Get accurate client notes automatically while keeping client confidentiality with on-device processing.",
    captures: ["Scope, decisions and deliverables", "Deadlines and owners", "Risks and open questions", "A polished recap to send the client"],
  },
  {
    slug: "all-hands",
    name: "All-hands meetings",
    headline: "Share all-hands recaps with the whole team",
    why: "Capture the all-hands tab, summarise the key announcements and Q&A, and share a clean recap with anyone who couldn't attend — without a paid seat each.",
    captures: ["Key announcements", "Q&A highlights", "Decisions and what changes", "A digest to post in Slack"],
  },
];

// Named findUseCase (not useCaseBySlug) so eslint's rules-of-hooks doesn't
// mistake the "use…" prefix for a React Hook.
export const findUseCase = (slug: string) =>
  USE_CASES.find((u) => u.slug === slug);
