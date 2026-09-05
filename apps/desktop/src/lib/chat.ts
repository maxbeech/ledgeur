// Context-grounded chat. Runs on the in-process on-device model by default (no
// server, no third-party app), and also works with a BYO-key cloud model. It
// never fabricates: if no model can answer the caller surfaces an explicit
// failure state rather than a canned answer.
//
// The prompt itself lives in @ledgeur/core (context/prompt.ts) so the live
// meeting copilot and the app-wide Ask are built by the same code and can be
// tested without a model. This module is the thin part: send it, return the
// answer, and report which context the answer was actually allowed to see.

import { buildGroundedPrompt, type ContextBlock, type GroundingMode } from "@ledgeur/core";
import { chatComplete, type ChatMessage } from "./llm.ts";

export type { ContextBlock, GroundingMode };

/** Pure — the grounded chat messages for a question. Unit-tested in core. */
export function buildChatMessages(question: string, context: ContextBlock[]): ChatMessage[] {
  return buildGroundedPrompt(question, context).messages;
}

export interface GroundedAnswer {
  text: string;
  /** Source names the answer could see, in prompt order. Shown under the
   *  bubble — the honest version of "where did that come from?". */
  sources: string[];
  /** Sources that existed but did not fit the budget. */
  dropped: string[];
}

export async function askWithContext(opts: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  question: string;
  context: ContextBlock[];
  /** "meeting" answers as the live copilot; "library" (default) as app-wide Ask. */
  mode?: GroundingMode;
  /** Extra framing for the user turn, e.g. the meeting title and elapsed time. */
  situation?: string;
  signal?: AbortSignal;
}): Promise<GroundedAnswer> {
  const prompt = buildGroundedPrompt(opts.question, opts.context, {
    mode: opts.mode,
    situation: opts.situation,
  });
  const text = await chatComplete(prompt.messages, {
    temperature: 0.2,
    signal: opts.signal,
    http: opts.baseUrl ? { baseUrl: opts.baseUrl, apiKey: opts.apiKey, model: opts.model } : undefined,
  });
  return { text, sources: prompt.used.map((b) => b.source), dropped: prompt.dropped };
}
