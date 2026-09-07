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

import {
  formatTranscript,
  summarizeTranscript,
  templateInstruction,
  type MeetingNotes,
  type TranscriptLine,
} from "@ledgeur/core";
import { chatComplete } from "./llm.ts";
import { createLogger } from "./logger.ts";
import { templateFor } from "./recipes.ts";

const log = createLogger("notes");

// The on-device model has no cancellation and can legitimately take a while on
// slower hardware; an unreachable HTTP fallback can hang on connect too. Neither
// should make "Finishing the record" wait forever — past this, fall back to the
// local heuristic extractor exactly as on any other model failure.
//
// Generous because the first call of a session also pays for loading ~1 GB of
// weights off disk, and a 1.5B model on CPU emits a few tokens a second. The old
// 45 s covered generation but not a cold start, so the very first meeting after
// launch tended to time out and silently fall back — which looks exactly like
// the model being bad at its job rather than never having run.
const NOTES_TIMEOUT_MS = 180_000;

/**
 * Transcript characters per model pass.
 *
 * The on-device window is 8192 tokens (N_CTX in src-tauri/src/ai/llm.rs), shared
 * between the system prompt, the transcript and a 768-token reply. Speaker- and
 * time-labelled lines tokenise densely (`[12:04] Speaker 1: ` is ~8 tokens of
 * pure scaffolding), so budget conservatively at ~2.5 chars/token and leave room
 * to spare. Anything longer is summarised in windows and then condensed — see
 * `generateMeetingNotes`.
 */
const CHUNK_CHARS = 14_000;
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
export function buildNotesPrompt(
  transcript: string,
  manualNotes = "",
  templateId?: string,
): { role: "system" | "user"; content: string }[] {
  const notes = manualNotes.trim();
  // No clipping here any more. It used to `.slice(0, 48000)`, which both
  // overflowed the model's 8k window (so the Rust side dropped the head of the
  // prompt — the instructions) and dropped the END of a long meeting, where the
  // decisions and actions live. Length is handled by windowing in
  // `generateMeetingNotes` instead, so every part of the meeting is seen.
  const user = notes
    ? `The user's own notes from the meeting:\n\n${notes}\n\nTranscript:\n\n${transcript}`
    : `Transcript:\n\n${transcript}`;
  // Order matters: the JSON contract and the never-invent rule come first and a
  // template can only add to them. The user's own notes come last, because they
  // outrank the template — a template says what this KIND of meeting is usually
  // about, and the notes say what THIS one actually was.
  // templateFor, not templateById: a recipe the user wrote has to steer the
  // notes exactly the way a built-in does, through the same prompt.
  const system = BASE_SYSTEM + templateInstruction(templateFor(templateId)) + (notes ? NOTES_SYSTEM : "");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Generate meeting notes: on-device model first, heuristic extractor as the
 * offline fallback. Always resolves — never throws — so a meeting always saves.
 *
 * `manualNotes` is whatever the user typed during the meeting; see the header.
 */
export async function generateMeetingNotes(
  lines: readonly TranscriptLine[],
  manualNotes = "",
  templateId?: string,
): Promise<MeetingNotes> {
  // Speaker- and time-labelled, not a flat wall of text. `segments.map(s =>
  // s.text).join(" ")` is what this used to be handed, and it makes "who
  // committed to what" unanswerable — the model cannot attribute an action to
  // anyone, so action items came out ownerless and the summary could not tell
  // one person's position from another's. packages/core/src/context/transcript.ts
  // has the same note about the copilot, which was fixed there and not here.
  const text = formatTranscript(lines).trim();
  // Prose, for word counts and for the extractive fallback: that summariser
  // splits on sentences and would treat every `[12:04] Speaker 1:` prefix as
  // part of the sentence it labels.
  const plain = lines.map((l) => l.text).join(" ");
  const notes = manualNotes.trim();
  // Nothing said and nothing typed: there is genuinely nothing to summarise.
  if (!text && !notes) return summarizeTranscript(plain);

  const started = Date.now();
  try {
    const reply = text.length > CHUNK_CHARS
      ? await condenseLongMeeting(text, notes, templateId)
      : await askForNotes(text, notes, templateId);
    const parsed = parseAiNotes(reply, plain);
    log.info("notes written by the on-device model", {
      ms: Date.now() - started,
      transcriptChars: text.length,
      summaryPoints: parsed.summary.length,
    });
    return { ...parsed, generator: "model" };
  } catch (e) {
    // No model, unreachable endpoint, timeout, or an unparseable reply — use the
    // local deterministic extractor so notes are still real and grounded. The
    // user's own notes are kept verbatim at the top rather than dropped: they
    // are the one part of the record that is definitely theirs.
    //
    // The reason is logged rather than swallowed. This `catch` used to be bare,
    // so a meeting that fell back was indistinguishable from one the model had
    // simply written badly — and the extractor's output (verbatim transcript
    // sentences) reads exactly like a model doing a terrible job.
    log.warn("falling back to the extractive summariser", {
      reason: e instanceof Error ? e.message : String(e),
      ms: Date.now() - started,
      transcriptChars: text.length,
    });
    const fallback = summarizeTranscript(plain);
    if (!notes) return fallback;
    const typed = notes.split("\n").map((l) => l.replace(/^[-*•]\s*/, "").trim()).filter(Boolean);
    return { ...fallback, summary: [...typed, ...fallback.summary].slice(0, 12) };
  }
}

/** One model pass over a transcript that already fits the context window. */
function askForNotes(transcript: string, manualNotes: string, templateId?: string): Promise<string> {
  return withTimeout(
    chatComplete(buildNotesPrompt(transcript, manualNotes, templateId), { temperature: 0.2, maxTokens: 768 }),
    NOTES_TIMEOUT_MS,
  );
}

/**
 * Split on line boundaries into windows that fit the context, keeping whole
 * transcript lines together so a speaker turn is never cut mid-sentence.
 * Exported for testing: getting this wrong silently loses part of a meeting.
 */
export function windowTranscript(transcript: string, chars = CHUNK_CHARS): string[] {
  const lines = transcript.split("\n");
  const out: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > chars) {
      out.push(current);
      current = "";
    }
    // A single line longer than the window is rare (one very long utterance)
    // but must not be dropped — it becomes its own oversized window and the
    // Rust side trims it rather than losing the instructions with it.
    current = current ? `${current}\n${line}` : line;
  }
  if (current) out.push(current);
  return out;
}

/**
 * Notes for a meeting too long for one pass: summarise each window, then
 * condense the collected points into the final set.
 *
 * The alternative — clipping the transcript — dropped the end of every long
 * meeting, which is exactly where decisions and next steps are agreed.
 */
async function condenseLongMeeting(
  transcript: string,
  manualNotes: string,
  templateId?: string,
): Promise<string> {
  const windows = windowTranscript(transcript);
  log.info("summarising a long meeting in windows", { windows: windows.length, chars: transcript.length });

  const parts: string[] = [];
  for (const [i, window] of windows.entries()) {
    // Manual notes go only to the final pass: they describe the meeting as a
    // whole, and repeating them per window would have each pass try to answer
    // points the window it can see has nothing to say about.
    const reply = await askForNotes(`(Part ${i + 1} of ${windows.length} of the meeting.)\n\n${window}`, "", templateId);
    try {
      const notes = parseAiNotes(reply, window);
      parts.push(
        [
          ...notes.summary,
          ...notes.decisions.map((d) => `Decision: ${d}`),
          ...notes.actionItems.map((a) => `Action: ${a}`),
          ...notes.questions.map((q) => `Open question: ${q}`),
        ].map((p) => `- ${p}`).join("\n"),
      );
    } catch (e) {
      // One bad window should not lose the rest of the meeting.
      log.warn("a transcript window produced no usable notes", {
        window: i + 1,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (parts.length === 0) throw new Error("No transcript window produced usable notes.");

  // Reduce: the collected points stand in for the transcript. They are already
  // prose, so they are far denser than raw speech and fit comfortably.
  return askForNotes(
    `These are notes taken from consecutive parts of one meeting, in order. ` +
      `Merge them into a single set of notes for the whole meeting, removing ` +
      `duplicates and keeping the wording faithful.\n\n${parts.join("\n")}`,
    manualNotes,
    templateId,
  );
}
