// Note templates — what a meeting's notes should pay attention to.
//
// A sales call, a 1:1 and a user interview produce very different notes from
// the same summariser, and which one you wanted is not recoverable from the
// transcript. A template says so up front.
//
// ── What a template does and does not change ────────────────────────────────
// It steers CONTENT and EMPHASIS, not the storage schema. Notes are stored,
// rendered, exported to Notion, synced and read back as `MeetingNotes` —
// summary, action items, decisions, open questions — and every one of those
// consumers would have to change to accept a per-template section list. So a
// template contributes prompt instructions and a set of named things to look
// for, which the model folds into those four buckets, and the record stays one
// shape everywhere. That is a deliberate ceiling, not an oversight: a "sales
// call" note whose objections land under `summary` is still searchable,
// exportable and diffable, where a free-form section list would not be.
//
// Pure data + a pure prompt builder, so the set is shared by every surface and
// testable without a model.

/** One note style. `id` is persisted, so it must stay stable. */
export interface NoteTemplate {
  id: string;
  name: string;
  /** One line, shown under the name in the picker. */
  description: string;
  /**
   * What this kind of meeting is for. Sets the model's frame before it is told
   * what to extract. Empty for the general template, which adds no framing.
   */
  focus: string;
  /** Specific things to look for, in priority order. */
  looksFor: string[];
}

/**
 * The built-in set. Deliberately small: six templates somebody can actually
 * choose between beats thirty they scroll past.
 */
export const NOTE_TEMPLATES: readonly NoteTemplate[] = Object.freeze([
  {
    id: "general",
    name: "General meeting",
    description: "Balanced notes. The default.",
    focus: "",
    looksFor: [],
  },
  {
    id: "sales",
    name: "Sales call",
    description: "Pain, objections, budget, next step.",
    focus: "This is a sales conversation between a seller and a prospective customer.",
    looksFor: [
      "the problem the prospect described, in their own words",
      "objections or hesitations they raised, and how each was answered",
      "anything said about budget, timeline, or who else has to approve",
      "the concrete next step and who owns it",
    ],
  },
  {
    id: "one-on-one",
    name: "1:1",
    description: "Blockers, growth, follow-ups.",
    focus: "This is a one-to-one between a manager and someone on their team.",
    looksFor: [
      "what is blocking them right now",
      "how they said they are doing, including workload and morale",
      "feedback given in either direction",
      "commitments made by either person before the next 1:1",
    ],
  },
  {
    id: "standup",
    name: "Stand-up",
    description: "Per-person progress and blockers.",
    focus: "This is a team stand-up: each person reports briefly.",
    looksFor: [
      "what each named person said they finished",
      "what each named person is working on next",
      "every blocker raised, attributed to whoever raised it",
    ],
  },
  {
    id: "discovery",
    name: "User interview",
    description: "Verbatim pain, workarounds, requests.",
    focus: "This is a user or customer interview aimed at understanding how they work.",
    looksFor: [
      "problems described in the interviewee's own words — quote them where the wording matters",
      "workarounds they have built, and what those cost them",
      "features or changes they asked for, kept separate from problems they described",
      "anything that contradicts an assumption the interviewer stated",
    ],
  },
  {
    id: "project",
    name: "Project sync",
    description: "Status, risks, decisions, owners.",
    focus: "This is a project status meeting.",
    looksFor: [
      "status against what was planned, including anything now late",
      "risks and dependencies raised",
      "decisions taken, and what was explicitly deferred",
      "every action item with a named owner and a date where one was given",
    ],
  },
]);

export const DEFAULT_TEMPLATE_ID = "general";

/** Look a template up by id, falling back to the general one. A persisted id
 *  for a template that no longer exists must not break note generation. */
export function templateById(id: string | undefined | null): NoteTemplate {
  return NOTE_TEMPLATES.find((t) => t.id === id) ?? NOTE_TEMPLATES[0];
}

/**
 * The template's contribution to the system prompt, or "" for the general one.
 *
 * Separate from the prompt itself so the caller keeps ownership of the JSON
 * contract and the never-invent rule, which no template may override.
 */
export function templateInstruction(template: NoteTemplate): string {
  if (!template.focus && template.looksFor.length === 0) return "";
  const looks = template.looksFor.length
    ? ` Give priority to, in this order: ${template.looksFor.join("; ")}.`
      + " Fold each into whichever of the four fields fits it best, and leave out anything"
      + " the transcript does not actually cover — an empty section is correct when the"
      + " meeting did not go there."
    : "";
  return ` ${template.focus}${looks}`;
}
