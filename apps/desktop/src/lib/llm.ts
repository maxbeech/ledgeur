// Unified access to the on-device LLM. Prefers the in-process native engine
// (a Tauri command — no separate server, no third-party app to install), and
// falls back to a configured OpenAI-compatible HTTP endpoint (a BYO cloud key
// or an external llama.cpp) when the native engine isn't available. It never
// fabricates: if nothing can answer it throws an honest, actionable error so
// the caller surfaces a failure state instead of a canned reply.
//
// The native model is downloaded once, on demand, and cached in the app data
// dir — the user never installs or launches anything themselves (task #1).

import { isTauri } from "./runtime.ts";
import { CONFIG } from "./config.ts";
import { postToLocalModel } from "./modelFetch.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** BYO cloud fallback — used only if the native engine isn't available. */
  http?: { baseUrl: string; apiKey?: string; model?: string };
}

/** On-device model lifecycle, reported by the native core. */
export interface LlmStatus {
  /** Built with `--features native-ai` (the engine is compiled in). */
  compiled: boolean;
  /** The GGUF weights are present on disk and ready to run. */
  modelReady: boolean;
  /** A download is currently in flight. */
  downloading: boolean;
  /** 0–100 while downloading. */
  progress: number;
  /** Human-readable model name, e.g. "Qwen2.5 1.5B Instruct". */
  modelName: string;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Native engine status, or null when running outside the desktop shell. */
export async function llmStatus(): Promise<LlmStatus | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<LlmStatus>("llm_status");
  } catch {
    return null;
  }
}

/** Kick off (or resume) the one-time model download. Resolves when ready.
 *  Progress is polled from `llmStatus()` by the UI. Desktop shell only. */
export async function downloadLlmModel(): Promise<void> {
  if (!isTauri()) throw new Error("The on-device model runs in the desktop app.");
  await invoke<void>("download_llm");
}

/** True when the native engine can answer right now (compiled + weights ready). */
export async function nativeLlmReady(): Promise<boolean> {
  const st = await llmStatus();
  return Boolean(st?.compiled && st.modelReady);
}

async function nativeChat(messages: ChatMessage[], opts: ChatOptions): Promise<string | null> {
  if (!isTauri()) return null;
  const st = await llmStatus();
  if (!st?.compiled || !st.modelReady) return null; // let the HTTP path (or an honest error) take over
  return invoke<string>("llm_chat", {
    messages,
    temperature: opts.temperature ?? 0.2,
    maxTokens: opts.maxTokens ?? 512,
  });
}

async function httpChat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const http = opts.http;
  const baseUrl = http?.baseUrl ?? CONFIG.localLlmUrl;
  const body = {
    model: http?.model || "local",
    temperature: opts.temperature ?? 0.2,
    stream: false,
    messages,
  };
  let res: Response;
  if (http?.apiKey) {
    // BYO-key cloud model — plain fetch so the auth header is included.
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${http.apiKey}` },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } else {
    res = await postToLocalModel(`${baseUrl}/chat/completions`, body, opts.signal);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Model error ${res.status}: ${detail.slice(0, 160)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No answer returned from the model.");
  return content;
}

/** Run a chat completion: native engine first, then an HTTP fallback, then an
 *  explicit error. The single entry point for every LLM feature (chat, coaching
 *  suggestions, post-meeting notes). */
export async function chatComplete(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const native = await nativeChat(messages, opts);
  if (native != null) return native.trim();
  return (await httpChat(messages, opts)).trim();
}

// ---- Embeddings (RAG) ------------------------------------------------------
// Native embedding support is a follow-up; today embeddings go through the
// OpenAI-compatible endpoint. Callers already degrade to keyword search when
// this is unavailable, so a thrown error here is non-fatal for Ask.

export async function embedText(text: string): Promise<number[]> {
  const res = await postToLocalModel(`${CONFIG.localLlmUrl}/embeddings`, { model: "nomic-embed-text", input: text });
  if (!res.ok) throw new Error(`Embedding model unavailable (${res.status}).`);
  const data = (await res.json()) as { data?: { embedding: number[] }[] };
  const emb = data.data?.[0]?.embedding;
  if (!emb) throw new Error("Embedding endpoint returned no vector.");
  return emb;
}
