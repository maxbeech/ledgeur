// The plans, defined once.
//
// This is the single source of truth for what Ledgeur costs and what each tier
// actually includes. The pricing page, the upgrade prompts inside the app, the
// checkout route and the comparison tables all read from here — previously the
// pricing page and the README described two different businesses, and the
// pricing page described features that did not exist.
//
// ── The rule for this file ──────────────────────────────────────────────────
// Nothing goes in a `includes` list unless it is shipping today. Not "on the
// roadmap", not "coming soon". Every line below maps to code in this repository:
//
//   on-device transcription   packages/asr/transcribe.worker.js
//   speaker separation        packages/asr/diarize.worker.js
//   voices that persist       packages/core/src/browser/voices.ts
//   local library + search    packages/core/src/library/meeting.ts
//   sync                      supabase/migrations/0002_rls.sql
//   shared team library       meetings.visibility = 'org' + RLS policies
//   agent access (MCP)        packages/mcp, apps/mcp-server, /api/mcp
//   plan gating               supabase/functions/mcp-token (org_is_paid)
//
// If you add a line here, add the code first.

export type PlanId = "personal" | "team" | "enterprise";

export interface Plan {
  id: PlanId;
  name: string;
  /** Formatted price, or null when it is a conversation. */
  price: string | null;
  cadence: string;
  /** The one sentence that says who this is for. */
  who: string;
  includes: readonly string[];
  /** Shown under the list — the honest caveat, not a disclaimer. */
  note?: string;
  cta: { label: string; href?: string; kind: "app" | "checkout" | "contact" };
  featured?: boolean;
  /** The `orgs.plan` value this maps to in the database. */
  dbPlan: "free" | "team" | "company";
}

/** Monthly price of the paid tier, in whole dollars. One number, used by the
 *  pricing page, the app's upgrade prompt and the comparison tables. */
export const TEAM_PRICE_USD = 6;

export const PLANS: readonly Plan[] = [
  {
    id: "personal",
    name: "Personal",
    price: "$0",
    cadence: "free, forever",
    who: "Everything the product does on your own machine.",
    dbPlan: "free",
    includes: [
      "Unlimited recording and transcription",
      "Speaker separation — who said what, automatically",
      "Name a voice once; it is recognised in every later meeting",
      "Drag in an existing recording and treat it like a live one",
      "Summary, decisions and action items",
      "Full-text search across your whole library",
      "Markdown export, and a copy of everything you can take with you",
    ],
    note: "No account required. Nothing is uploaded — the models run in your browser, and your library lives on your device.",
    cta: { label: "Open Ledgeur", href: "/app", kind: "app" },

  },
  {
    id: "team",
    name: "Team",
    price: `$${TEAM_PRICE_USD}`,
    cadence: "per person / month",
    who: "For when the record has to outlive one laptop.",
    dbPlan: "team",
    featured: true,
    includes: [
      "Everything in Personal",
      "Sync your meetings across your own devices",
      "A shared team library — meetings you choose to share, searchable by everyone",
      "Agent access: connect Claude, ChatGPT or Cursor to your meetings over MCP",
      "Ask questions across everything the team has ever discussed",
      "Email support",
    ],
    note: "14-day free trial. Cancel any time — your meetings stay on your device either way.",
    cta: { label: "Start the free trial", kind: "checkout" },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: null,
    cadence: "let's talk",
    who: "For organisations that need to run it themselves.",
    dbPlan: "company",
    includes: [
      "Self-hosting, with help — Ledgeur is MIT-licensed, so this is always possible without us",
      "A deployment of Supabase and the sync layer inside your own network",
      "A support agreement and a named contact",
      "Input on the roadmap",
    ],
    note: "We will tell you plainly what we do and do not have. We do not currently ship SSO/SAML, SCIM or an admin audit console — if you need those, say so and we will tell you where they sit.",
    cta: { label: "Talk to us", kind: "contact" },
  },
];

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id) ?? PLANS[0];

/**
 * The honest comparison against a hosted notetaker.
 *
 * Every row is a factual difference in architecture, not a claim about a
 * competitor's quality. `them` describes the general shape of a cloud AI
 * notetaker; the per-competitor pages in lib/competitors.ts get specific.
 */
export const COMPARISON: readonly { point: string; ledgeur: string; them: string }[] = [
  { point: "Where the audio goes", ledgeur: "Nowhere. Transcribed in your browser.", them: "Uploaded to the vendor's servers." },
  { point: "Who joins the call", ledgeur: "Nobody. It captures the tab's audio.", them: "A bot appears in the participant list." },
  { point: "Minutes per month", ledgeur: "Unlimited — it is your CPU.", them: "Capped, then metered." },
  { point: "Cost for one person", ledgeur: "Free, permanently.", them: "Per seat, after a trial." },
  { point: "If the company disappears", ledgeur: "MIT source, local files. It keeps working.", them: "Export before the lights go out." },
  { point: "Reading your data with an agent", ledgeur: "An MCP endpoint you point Claude at.", them: "Whatever the vendor's integrations allow." },
];
