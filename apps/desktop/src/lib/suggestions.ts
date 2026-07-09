// Proactive in-meeting coaching: given the tail of the live transcript, the
// local model proposes a few concise things the user could say next. Runs on
// the in-process on-device model (falling back to a configured endpoint) — if
// no model can answer the caller shows an explicit "model unavailable" state,
// never canned tips.

import { parseSuggestions } from "@ledgeur/core";
import { chatComplete } from "./llm.ts";

const SYSTEM =
  "You are a discreet meeting coach. Given the live transcript of an ongoing " +
  "meeting, suggest exactly 3 short, specific things the user could say next — " +
  "e.g. a clarifying question, a decision to push for, or a commitment to " +
  "capture. Each suggestion must be one sentence the user could say out loud, " +
  "grounded in what was actually discussed. Reply with ONLY a JSON array of 3 strings.";

export async function suggestNext(transcriptTail: string, signal?: AbortSignal): Promise<string[]> {
  const tail = transcriptTail.slice(-6000).trim();
  if (!tail) throw new Error("Not enough transcript yet — let the conversation run a moment.");
  const content = await chatComplete(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Live transcript (most recent last):\n\n${tail}` },
    ],
    { temperature: 0.6, maxTokens: 256, signal },
  );
  return parseSuggestions(content);
}
