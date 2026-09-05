// The follow-up email — the thing you were going to write after the meeting and
// didn't.
//
// Two paths, same output shape, so the caller never has to branch:
//
//   with a model   a prompt that writes the note as the person would, from the
//                  real notes and transcript.
//   without one    a deterministic draft assembled from the notes themselves.
//                  Not a template with blanks — an actual sendable recap built
//                  from real decisions and real action items. It is plainer
//                  than the model's version and says nothing the meeting did
//                  not contain, which is the correct failure mode.
//
// Neither path invents a recipient, a date, or a commitment. If the meeting had
// no action items, the draft has no action items section.

import type { MeetingNotes } from "./summarize.ts";

export interface FollowUpEmail {
  subject: string;
  body: string;
  /** How it was produced, so the UI can say "written on-device by the model"
   *  vs "assembled from your notes". */
  source: "model" | "local";
}

export interface FollowUpOptions {
  /** What to sign off as. Empty when unknown — the draft then ends without a
   *  fabricated name rather than with "Best, [Your name]". */
  senderName?: string;
  /** Who it is going to, if the caller knows. Only used to set the tone. */
  audience?: string;
  tone?: "warm" | "neutral" | "brief";
}

const TONE_NOTE: Record<NonNullable<FollowUpOptions["tone"]>, string> = {
  warm: "Friendly and personal, but not effusive.",
  neutral: "Professional and plain.",
  brief: "As short as possible — someone scanning on a phone.",
};

/**
 * The prompt for a model-written follow-up. Pure, so it is unit-tested.
 *
 * The transcript is included as well as the notes: the notes say what was
 * decided, the transcript says how people talked about it, and a recap that
 * uses the room's own words for the thing they agreed reads like a person
 * wrote it. The strict rules stay on the notes' side — nothing may be
 * introduced that is not in one of the two.
 */
export function buildFollowUpPrompt(
  title: string,
  notes: MeetingNotes,
  transcript: string,
  options: FollowUpOptions = {},
): { role: "system" | "user"; content: string }[] {
  const { senderName, audience, tone = "neutral" } = options;
  const system =
    "You write the follow-up email after a meeting, as the person who was in it. " +
    `${TONE_NOTE[tone]} ` +
    "Structure: one sentence of thanks or context, then what was decided, then who is doing what by when. " +
    "Use ONLY what is in the notes and transcript below. Never invent an owner, a date, a number or a " +
    "commitment; if an action item has no owner or no date, write it without one rather than guessing. " +
    (senderName ? `Sign off as ${senderName}. ` : "Do not sign off with a name — end after the last line of content. ") +
    "Reply with a subject line on the first line prefixed exactly with 'Subject: ', then a blank line, then the email body. " +
    "No preamble, no explanation, no markdown headings.";

  const clipped = transcript.length > 24_000 ? `${transcript.slice(0, 24_000)}\n…(truncated)` : transcript;
  const user = [
    `Meeting: ${title}`,
    audience ? `Sending to: ${audience}` : "",
    notes.summary.length ? `\nSummary:\n${notes.summary.map((s) => `- ${s}`).join("\n")}` : "",
    notes.decisions.length ? `\nDecisions:\n${notes.decisions.map((s) => `- ${s}`).join("\n")}` : "",
    notes.actionItems.length ? `\nAction items:\n${notes.actionItems.map((s) => `- ${s}`).join("\n")}` : "",
    notes.questions.length ? `\nOpen questions:\n${notes.questions.map((s) => `- ${s}`).join("\n")}` : "",
    `\nTranscript:\n${clipped}`,
  ].filter(Boolean).join("\n");

  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/** Split a model reply into subject and body. Tolerant: a model that forgets
 *  the prefix still yields a usable draft rather than an error. */
export function parseFollowUp(reply: string, fallbackTitle: string): FollowUpEmail {
  const text = reply.trim();
  const match = /^subject:\s*(.+)$/im.exec(text);
  if (match) {
    const body = text.slice(text.indexOf(match[0]) + match[0].length).trim();
    if (body) return { subject: match[1].trim(), body, source: "model" };
  }
  return { subject: `Follow-up: ${fallbackTitle}`, body: text, source: "model" };
}

/**
 * A sendable recap with no model at all, assembled from the notes.
 *
 * Deterministic and unit-tested. Sections the meeting did not produce are
 * absent, not empty — an email with a bare "Decisions:" heading under it reads
 * as broken software.
 */
export function localFollowUp(
  title: string,
  notes: MeetingNotes,
  options: FollowUpOptions = {},
): FollowUpEmail {
  const parts: string[] = [];
  parts.push(`Thanks all — quick recap of ${title}.`);
  if (notes.summary.length) parts.push(notes.summary.map((s) => `• ${s}`).join("\n"));
  if (notes.decisions.length) parts.push(`What we decided:\n${notes.decisions.map((s) => `• ${s}`).join("\n")}`);
  if (notes.actionItems.length) parts.push(`Next steps:\n${notes.actionItems.map((s) => `• ${s}`).join("\n")}`);
  if (notes.questions.length) parts.push(`Still open:\n${notes.questions.map((s) => `• ${s}`).join("\n")}`);
  if (!notes.summary.length && !notes.decisions.length && !notes.actionItems.length) {
    parts.push("(The recording produced no summary — the transcript is attached to the meeting in Ledgeur.)");
  }
  parts.push("Shout if I've missed anything.");
  if (options.senderName) parts.push(options.senderName);
  return { subject: `Follow-up: ${title}`, body: parts.join("\n\n"), source: "local" };
}

/** A `mailto:` for the draft, so it opens in whatever mail app they use. */
export function mailtoUrl(email: FollowUpEmail, to = ""): string {
  const q = new URLSearchParams({ subject: email.subject, body: email.body });
  // URLSearchParams encodes spaces as "+", which mail clients render literally
  // in the body. Percent-encoding is what mailto expects.
  return `mailto:${encodeURIComponent(to)}?${q.toString().replace(/\+/g, "%20")}`;
}
