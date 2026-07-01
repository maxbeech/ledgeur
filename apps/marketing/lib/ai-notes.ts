// Optional "bring your own key" AI notes. The transcript is sent directly from
// the browser to the user's chosen provider — it never passes through a
// ParleyNotes server. The local summarizer (lib/summarize.ts) remains the
// zero-setup default; this is a power-user upgrade.

export interface AiProvider {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  keyHint: string;
}

export const AI_PROVIDERS: AiProvider[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", keyHint: "sk-..." },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini", keyHint: "sk-or-..." },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", keyHint: "gsk_..." },
];

export const providerById = (id: string) =>
  AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];

const SYSTEM_PROMPT =
  "You are an expert meeting-notes writer. Given a raw, possibly messy speech-to-text " +
  "transcript, produce clear, accurate Markdown notes. Use these sections, omitting any " +
  "that have no content: ## Summary (3-6 bullets), ## Decisions, ## Action items " +
  "(format each as '- [ ] owner — task'), ## Open questions. Be faithful to the transcript; " +
  "never invent facts, names, numbers or commitments that are not present.";

/** Build the chat-completions request body. Pure, so it is unit-tested. */
export function buildNotesRequest(model: string, transcript: string) {
  const clipped = transcript.length > 48000 ? transcript.slice(0, 48000) + "\n…(truncated)" : transcript;
  return {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Transcript:\n\n${clipped}` },
    ],
  };
}

export async function generateAiNotes(opts: {
  provider: AiProvider;
  apiKey: string;
  model?: string;
  transcript: string;
  signal?: AbortSignal;
}): Promise<string> {
  const model = opts.model || opts.provider.defaultModel;
  const res = await fetch(`${opts.provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(buildNotesRequest(model, opts.transcript)),
    signal: opts.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Provider error ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content returned from provider.");
  return content;
}
