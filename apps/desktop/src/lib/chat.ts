// Context-grounded chat over an OpenAI-compatible endpoint. Defaults to the
// on-device llama.cpp sidecar (task #8); also works with a BYO-key cloud model.
// It never fabricates: if the endpoint is unreachable the caller surfaces an
// explicit failure state rather than a canned answer.

import { postToLocalModel } from "./modelFetch.ts";

export interface ContextBlock {
  source: string; // e.g. "Live transcript", "Meeting: Q3 planning", "Notion: Roadmap"
  text: string;
}

const SYSTEM =
  "You are ParleyNotes, an assistant with access to the user's meeting knowledge base. " +
  "Answer using ONLY the provided context blocks. Cite the source name in parentheses. " +
  "If the answer is not in the context, say you don't have that information yet — never guess.";

export function buildChatBody(model: string, question: string, context: ContextBlock[]) {
  const ctx = context.length
    ? context.map((c) => `### ${c.source}\n${c.text}`).join("\n\n").slice(0, 48000)
    : "(no context available)";
  return {
    model,
    temperature: 0.2,
    stream: false,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Context:\n\n${ctx}\n\n---\nQuestion: ${question}` },
    ],
  };
}

export async function askWithContext(opts: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  question: string;
  context: ContextBlock[];
  signal?: AbortSignal;
}): Promise<string> {
  let res: Response;
  const body = buildChatBody(opts.model || "local", opts.question, opts.context);
  if (opts.apiKey) {
    // BYO-key cloud model — plain fetch so auth headers are included.
    res = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } else {
    res = await postToLocalModel(`${opts.baseUrl}/chat/completions`, body, opts.signal);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Model error ${res.status}: ${detail.slice(0, 160)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No answer returned from the model.");
  return content;
}
