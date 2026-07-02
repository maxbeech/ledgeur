// Proactive in-meeting coaching: given the tail of the live transcript, the
// local model proposes a few concise things the user could say next. Runs
// against the on-device llama.cpp endpoint only — if it isn't running the
// caller shows an explicit "model unavailable" state, never canned tips.

import { parseSuggestions } from "@parleynotes/core";
import { CONFIG } from "./config.ts";
import { postToLocalModel } from "./modelFetch.ts";

const SYSTEM =
  "You are a discreet meeting coach. Given the live transcript of an ongoing " +
  "meeting, suggest exactly 3 short, specific things the user could say next — " +
  "e.g. a clarifying question, a decision to push for, or a commitment to " +
  "capture. Each suggestion must be one sentence the user could say out loud, " +
  "grounded in what was actually discussed. Reply with ONLY a JSON array of 3 strings.";

export async function suggestNext(transcriptTail: string, signal?: AbortSignal): Promise<string[]> {
  const tail = transcriptTail.slice(-6000).trim();
  if (!tail) throw new Error("Not enough transcript yet — let the conversation run a moment.");
  const res = await postToLocalModel(`${CONFIG.localLlmUrl}/chat/completions`, {
    model: "local",
    temperature: 0.6,
    stream: false,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Live transcript (most recent last):\n\n${tail}` },
    ],
  }, signal);
  if (!res.ok) throw new Error(`On-device model unavailable (${res.status}). Start the local model to get suggestions.`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("The model returned an empty reply.");
  return parseSuggestions(content);
}
