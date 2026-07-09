// Post-meeting notes. Once a recording ends we ask the on-device model to write
// the summary, action items, decisions and open questions from the real
// transcript (task #3). If no model is available we fall back to the local
// heuristic extractor (packages/core) so the app still produces honest notes
// offline — never fabricated, always grounded in what was actually said.

import { summarizeTranscript, type MeetingNotes } from "@ledgeur/core";
import { chatComplete } from "./llm.ts";

const SYSTEM =
  "You are an expert meeting-notes writer. From a raw speech-to-text transcript, " +
  "extract structured notes. Be faithful to the transcript — never invent facts, " +
  "names, numbers or commitments that are not present. Reply with ONLY a JSON object " +
  'of this exact shape: {"summary": string[], "actionItems": string[], "decisions": ' +
  'string[], "questions": string[]}. "summary" is 3–6 concise bullet points. ' +
  '"actionItems" are concrete follow-ups (include an owner where stated). ' +
  '"decisions" are things the group agreed. "questions" are open questions raised. ' +
  "Use empty arrays for sections with no content.";

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

/** Generate meeting notes: on-device model first, heuristic extractor as the
 *  offline fallback. Always resolves — never throws — so a meeting always saves. */
export async function generateMeetingNotes(transcript: string): Promise<MeetingNotes> {
  const text = transcript.trim();
  if (!text) return summarizeTranscript(transcript);
  const clipped = text.length > 48000 ? `${text.slice(0, 48000)}\n…(truncated)` : text;
  try {
    const reply = await chatComplete(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Transcript:\n\n${clipped}` },
      ],
      { temperature: 0.2, maxTokens: 768 },
    );
    return parseAiNotes(reply, transcript);
  } catch {
    // No model, unreachable endpoint, or unparseable reply — use the local
    // deterministic extractor so notes are still real and grounded.
    return summarizeTranscript(transcript);
  }
}
