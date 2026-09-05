// Post-meeting notes. Once a recording ends we ask the on-device model to write
// the summary, action items, decisions and open questions from the real
// transcript. If no model is available we fall back to the local heuristic
// extractor (packages/core) so the app still produces honest notes offline —
// never fabricated, always grounded in what was actually said.
//
// ── Notes the user typed ────────────────────────────────────────────────────
// Anything jotted in the notes panel during the meeting is passed to the model
// alongside the transcript, and steers it. That is the whole point of typing
// during a meeting: shorthand like "pricing — Sam pushing back" marks what
// mattered to *this* person, which no summariser can infer from the transcript
// alone. The model fills those fragments out from what was actually said and
// leads with them, rather than producing a generic recap that happens to sit
// next to the user's notes in the saved record. Those notes used to be stored
// and rendered but never actually used, which made typing them pointless.
//
// The instruction to expand rather than invent is load-bearing: a fragment the
// transcript does not support has to stay as the user wrote it, not get
// elaborated into a plausible-sounding sentence nobody said.

import { summarizeTranscript, type MeetingNotes } from "@ledgeur/core";
import { chatComplete } from "./llm.ts";

// The on-device model has no cancellation and can legitimately take a while on
// slower hardware; an unreachable HTTP fallback can hang on connect too. Neither
// should make "Finishing the record" wait forever — past this, fall back to the
// local heuristic extractor exactly as on any other model failure.
const NOTES_TIMEOUT_MS = 45_000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Notes generation timed out.")), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

const BASE_SYSTEM =
  "You are an expert meeting-notes writer. From a raw speech-to-text transcript, " +
  "extract structured notes. Be faithful to the transcript — never invent facts, " +
  "names, numbers or commitments that are not present. Reply with ONLY a JSON object " +
  'of this exact shape: {"summary": string[], "actionItems": string[], "decisions": ' +
  'string[], "questions": string[]}. "summary" is 3–6 concise bullet points. ' +
  '"actionItems" are concrete follow-ups (include an owner where stated). ' +
  '"decisions" are things the group agreed. "questions" are open questions raised. ' +
  "Use empty arrays for sections with no content.";

/** Appended only when the user actually typed something. */
const NOTES_SYSTEM =
  " The user also typed their own rough notes during the meeting. Those notes are " +
  "the priority: they mark what mattered to the person who was there. Cover every " +
  "point they made, in their order, near the top of the summary, expanding each " +
  "shorthand fragment into a full point using the detail from the transcript. " +
  "Keep their wording and emphasis where you can. If a fragment is not supported " +
  "by the transcript, keep it as they wrote it rather than elaborating on it — " +
  "never invent detail to fill a fragment out. Add points from the transcript that " +
  "they did not note only after theirs.";

interface RawNotes {
  summary?: unknown;
  actionItems?: unknown;
  decisions?: unknown;
  questions?: unknown;
}

/** Coerce a parsed value into a clean string[] (trimmed, non-empty, capped). */
function strings(v: unknown, limit: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.trim()) out.push(x.trim());
    if (out.length >= limit) break;
  }
  return out;
}

/** Parse the model's JSON reply into MeetingNotes. Throws if it isn't usable so
 *  the caller falls back to the heuristic extractor rather than saving nothing. */
export function parseAiNotes(raw: string, transcript: string): MeetingNotes {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model did not return JSON notes.");
  const obj = JSON.parse(match[0]) as RawNotes;
  const summary = strings(obj.summary, 8);
  if (summary.length === 0) throw new Error("Model returned an empty summary.");
  const wordCount = (transcript.match(/[a-z0-9']+/gi) ?? []).length;
  return {
    summary,
    actionItems: strings(obj.actionItems, 12),
    decisions: strings(obj.decisions, 8),
    questions: strings(obj.questions, 10),
    wordCount,
  };
}

/**
 * Build the two messages sent to the model.
 *
 * Exported so the prompt is testable: that the user's notes actually reach the
 * model, and that the extra instruction only appears when there are notes to
 * apply it to, are both things that broke silently before.
 */
export function buildNotesPrompt(transcript: string, manualNotes = ""): { role: "system" | "user"; content: string }[] {
  const notes = manualNotes.trim();
  const clipped = transcript.length > 48000 ? `${transcript.slice(0, 48000)}\n…(truncated)` : transcript;
  const user = notes
    ? `The user's own notes from the meeting:\n\n${notes}\n\nTranscript:\n\n${clipped}`
    : `Transcript:\n\n${clipped}`;
  return [
    { role: "system", content: notes ? BASE_SYSTEM + NOTES_SYSTEM : BASE_SYSTEM },
    { role: "user", content: user },
  ];
}

/**
 * Generate meeting notes: on-device model first, heuristic extractor as the
 * offline fallback. Always resolves — never throws — so a meeting always saves.
 *
 * `manualNotes` is whatever the user typed during the meeting; see the header.
 */
export async function generateMeetingNotes(transcript: string, manualNotes = ""): Promise<MeetingNotes> {
  const text = transcript.trim();
  const notes = manualNotes.trim();
  // Nothing said and nothing typed: there is genuinely nothing to summarise.
  if (!text && !notes) return summarizeTranscript(transcript);
  try {
    const reply = await withTimeout(
      chatComplete(buildNotesPrompt(text, notes), { temperature: 0.2, maxTokens: 768 }),
      NOTES_TIMEOUT_MS,
    );
    return parseAiNotes(reply, transcript);
  } catch {
    // No model, unreachable endpoint, or unparseable reply — use the local
    // deterministic extractor so notes are still real and grounded. The user's
    // own notes are kept verbatim at the top rather than dropped: they are the
    // one part of the record that is definitely theirs.
    const fallback = summarizeTranscript(transcript);
    if (!notes) return fallback;
    const typed = notes.split("\n").map((l) => l.replace(/^[-*•]\s*/, "").trim()).filter(Boolean);
    return { ...fallback, summary: [...typed, ...fallback.summary].slice(0, 12) };
  }
}
