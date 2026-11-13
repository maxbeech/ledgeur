// Optional AI notes. Two providers:
//  - "local": the on-device llama.cpp server, which speaks the OpenAI
//    chat-completions shape (that is a property of llama.cpp, not a cloud
//    dependency).
//  - "anthropic": the user's own Anthropic API key (bring your own key),
//    called through the official @anthropic-ai/sdk.
// Pure request builders are unit-tested. A failed call throws; there is no
// keyword/heuristic fallback.

import Anthropic from "@anthropic-ai/sdk";

export interface AiProvider {
  id: "local" | "anthropic";
  label: string;
  baseUrl: string;
  defaultModel: string;
  keyHint: string;
}

export const ANTHROPIC_NOTES_MODEL = "claude-sonnet-5-5";

export const AI_PROVIDERS: AiProvider[] = [
  { id: "local", label: "On-device (llama.cpp)", baseUrl: "http://127.0.0.1:8081/v1", defaultModel: "local", keyHint: "no key needed" },
  { id: "anthropic", label: "Anthropic (Claude)", baseUrl: "https://api.anthropic.com", defaultModel: ANTHROPIC_NOTES_MODEL, keyHint: "sk-ant-..." },
];

export const providerById = (id: string) =>
  AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];

const SYSTEM_PROMPT =
  "You are an expert meeting-notes writer. Given a raw, possibly messy speech-to-text " +
  "transcript, produce clear, accurate Markdown notes. Use these sections, omitting any " +
  "that have no content: ## Summary (3-6 bullets), ## Decisions, ## Action items " +
  "(format each as '- [ ] owner — task'), ## Open questions. Be faithful to the transcript; " +
  "never invent facts, names, numbers or commitments that are not present.";

function clipTranscript(transcript: string) {
  return transcript.length > 48000 ? transcript.slice(0, 48000) + "\n…(truncated)" : transcript;
}

/** Anthropic Messages API params. Pure, so it is unit-tested. */
export function buildAnthropicNotesParams(model: string, transcript: string) {
  return {
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content: `Transcript:\n\n${clipTranscript(transcript)}` }],
  };
}

/** Build the OpenAI-shaped chat-completions body for the local llama.cpp server. Pure, so it is unit-tested. */
export function buildNotesRequest(model: string, transcript: string) {
  const clipped = clipTranscript(transcript);
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
  if (opts.provider.id === "anthropic") return generateAnthropicNotes({ ...opts, model });
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
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content returned from provider.");
  return content;
}

/** Extract text from an Anthropic response; throws on refusal or empty output. */
export function textFromAnthropicMessage(msg: { stop_reason?: string | null; content: { type: string; text?: string }[] }): string {
  if (msg.stop_reason === "refusal") throw new Error("Anthropic declined to write notes for this transcript.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  if (!text) throw new Error("No content returned from provider.");
  return text;
}

async function generateAnthropicNotes(opts: { apiKey: string; model: string; transcript: string; signal?: AbortSignal }): Promise<string> {
  // The key is the user's own (BYOK) and is used straight from their device.
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  try {
    const msg = await client.messages.create(buildAnthropicNotesParams(opts.model, opts.transcript), { signal: opts.signal });
    return textFromAnthropicMessage(msg);
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      throw new Error(`Anthropic error ${e.status ?? ""}: ${String(e.message).slice(0, 200)}`);
    }
    throw e;
  }
}
