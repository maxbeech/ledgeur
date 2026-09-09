// The meeting-notes templates, as public pages.
//
// ── Where the content comes from ────────────────────────────────────────────
// NOT from here. The six templates are `NOTE_TEMPLATES` in @ledgeur/core, which
// is what the app actually uses to steer a summary. This file adds only what a
// web page needs and the app does not: a slug, the search phrase the page is
// answering, and the headings a person would put in a blank document if they
// were doing this by hand.
//
// That direction matters. "Meeting notes template" is the largest single search
// number anywhere in this site's keyword research (22,200 a month, and the same
// figure for "meeting minutes template"), and the honest way to serve it is to
// publish the templates the product genuinely runs on. If somebody copies the
// headings into a Google Doc and never installs anything, the page did its job
// and the copy they took is real.
//
// So a template that is removed from core disappears from the site, and a
// seventh added there needs one entry here to get a page. A test asserts that
// every core template has one, because the failure mode is silent: the page
// simply never appears and nobody notices.

import { NOTE_TEMPLATES, type NoteTemplate } from "@ledgeur/core";

/** What a page needs beyond the template itself. */
interface TemplatePage {
  /** Matches a NOTE_TEMPLATES id. */
  id: string;
  slug: string;
  /** The H1, written as the thing somebody searched for. */
  headline: string;
  /** Why this meeting is different from any other meeting. */
  why: string;
  /** The headings, in the order they belong in a document. This is the part
   *  people copy, so it is written to be copied rather than to read well. */
  headings: readonly string[];
  /** Monthly US search volume for the page's phrase, from Keyword Planner on
   *  2026-09-09. Kept so a future prioritisation is made against a number
   *  somebody measured rather than a hunch. */
  demand: string;
}

const PAGES: readonly TemplatePage[] = [
  {
    id: "general",
    slug: "meeting-notes",
    headline: "Meeting notes template",
    why:
      "Most meetings are not a category. They are a conversation with a few decisions in them, and the only thing a template has to do is make sure the decisions do not get lost among the discussion.",
    headings: [
      "Date, attendees, and what this meeting was for",
      "What was discussed",
      "Decisions made",
      "Open questions, still unresolved",
      "Action items: who, what, by when",
    ],
    demand: "22,200/mo",
  },
  {
    id: "project",
    slug: "project-status-meeting",
    headline: "Project status meeting template",
    why:
      "A status meeting fails in one specific way: everybody reports, nobody records what slipped, and the same risk is raised again three weeks later as a surprise. The template exists to make late things and deferred decisions impossible to leave out.",
    headings: [
      "Status against the plan",
      "Anything now late, and by how much",
      "Risks and dependencies raised",
      "Decisions taken",
      "Decisions explicitly deferred, and until when",
      "Action items with a named owner and a date",
    ],
    demand: "10/mo",
  },
  {
    id: "one-on-one",
    slug: "one-on-one",
    headline: "1:1 meeting template",
    why:
      "A 1:1 is the meeting most damaged by note-taking, because a manager typing is a manager not listening. The headings are what you want afterwards, not a script to work through in the room.",
    headings: [
      "What is blocking them right now",
      "How they said they are doing: workload, morale",
      "Feedback given, in both directions",
      "Growth and what they want next",
      "Commitments made before the next 1:1",
    ],
    demand: "1,300/mo",
  },
  {
    id: "standup",
    slug: "standup",
    headline: "Standup meeting template",
    why:
      "Fifteen people, ninety seconds each, and by the fourth person nobody remembers the first blocker. A standup template is per-person by necessity: the value is in attribution, not in the summary.",
    headings: [
      "Per person: what they finished",
      "Per person: what they are on next",
      "Every blocker raised, attributed to whoever raised it",
      "Anything that needs a conversation after this call",
    ],
    demand: "260/mo",
  },
  {
    id: "sales",
    slug: "sales-call",
    headline: "Sales call notes template",
    why:
      "The two things a CRM entry is usually missing are the prospect's own words and who else has to approve. Both are said out loud on the call and neither survives being written from memory an hour later.",
    headings: [
      "The problem, in the prospect's own words",
      "Objections raised, and how each was answered",
      "Budget, timeline, and who else has to approve",
      "The concrete next step, and who owns it",
    ],
    demand: "10/mo",
  },
  {
    id: "discovery",
    slug: "user-interview",
    headline: "User interview template",
    why:
      "A research interview is the one meeting where paraphrasing destroys the evidence. What somebody actually said, in the words they chose, is the finding. Keep the quotes.",
    headings: [
      "Problems described, quoted verbatim",
      "Workarounds they have built, and what those cost",
      "Features or changes they asked for, kept apart from problems they described",
      "Anything that contradicts an assumption we walked in with",
    ],
    demand: "40/mo",
  },
];

export interface MeetingTemplate extends TemplatePage {
  template: NoteTemplate;
}

/** Every template that has both an implementation and a page. Built from core,
 *  so the site cannot advertise a template the product does not run. */
export const TEMPLATES: readonly MeetingTemplate[] = PAGES.flatMap((page) => {
  const template = NOTE_TEMPLATES.find((t) => t.id === page.id);
  return template ? [{ ...page, template }] : [];
});

export const templateBySlug = (slug: string): MeetingTemplate | undefined =>
  TEMPLATES.find((t) => t.slug === slug);

/** The plain-text version, for the copy button and the Markdown a person takes
 *  away. Built from the same headings the page renders, so what they copy is
 *  what they read. */
export function templateMarkdown(t: MeetingTemplate): string {
  const lines = [`# ${t.template.name}`, "", "**Date:**  ", "**Attendees:**  ", ""];
  for (const heading of t.headings) {
    lines.push(`## ${heading}`, "", "- ", "");
  }
  return lines.join("\n");
}
