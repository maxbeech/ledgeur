// Context-grounded chat. Runs on the in-process on-device model by default (no
// server, no third-party app), and also works with a BYO-key cloud model. It
// never fabricates: if no model can answer the caller surfaces an explicit
// failure state rather than a canned answer.

import { chatComplete, type ChatMessage } from "./llm.ts";

export interface ContextBlock {
  source: string; // e.g. "Live transcript", "Meeting: Q3 planning", "Notion: Roadmap"
  text: string;
}

const SYSTEM =
  "You are Ledgeur, an assistant with access to the user's meeting knowledge base. " +
  "Answer using ONLY the provided context blocks. Cite the source name in parentheses. " +
  "If the answer is not in the context, say you don't have that information yet — never guess.";

/** Pure — the grounded chat messages for a question. Unit-tested. */
export function buildChatMessages(question: string, context: ContextBlock[]): ChatMessage[] {
  const ctx = context.length
    ? context.map((c) => `### ${c.source}\n${c.text}`).join("\n\n").slice(0, 48000)
    : "(no context available)";
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Context:\n\n${ctx}\n\n---\nQuestion: ${question}` },
  ];
}

export async function askWithContext(opts: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  question: string;
  context: ContextBlock[];
  signal?: AbortSignal;
}): Promise<string> {
  return chatComplete(buildChatMessages(opts.question, opts.context), {
    temperature: 0.2,
    signal: opts.signal,
    http: opts.baseUrl ? { baseUrl: opts.baseUrl, apiKey: opts.apiKey, model: opts.model } : undefined,
  });
}
