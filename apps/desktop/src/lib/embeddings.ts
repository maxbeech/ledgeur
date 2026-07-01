// RAG embeddings. Meeting text is chunked (core) and embedded on-device via the
// local llama.cpp embeddings endpoint, then upserted to Supabase (pgvector).
// Ask uses semantic search when a backend + model are available, else falls back
// to keyword search — always real, never fabricated.

import { meetingChunks, semanticSearch } from "@parleynotes/core";
import { getSupabase } from "./supabase.ts";
import { CONFIG } from "./config.ts";
import type { ContextBlock } from "./chat.ts";

/** Embed a single string via the local OpenAI-compatible embeddings endpoint. */
export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${CONFIG.localLlmUrl}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", input: text }),
  });
  if (!res.ok) throw new Error(`Local embedding model unavailable (${res.status}). Start the on-device model.`);
  const data = (await res.json()) as { data?: { embedding: number[] }[] };
  const emb = data.data?.[0]?.embedding;
  if (!emb) throw new Error("Embedding endpoint returned no vector.");
  return emb;
}

/** Chunk + embed a meeting and upsert its vectors for the org hive mind. */
export async function indexMeeting(
  orgId: string,
  meetingId: string,
  input: { title: string; summary: string[]; transcript: string },
): Promise<number> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sign in to index meetings.");
  const chunks = meetingChunks(input);
  const rows = [];
  for (const c of chunks) {
    const embedding = await embedText(c.text);
    rows.push({ org_id: orgId, meeting_id: meetingId, content: c.text, embedding });
  }
  if (rows.length) {
    const { error } = await sb.from("embeddings").insert(rows);
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

/** Semantic context blocks for a question over the org's shared knowledge. */
export async function semanticContext(orgId: string, query: string, k = 8): Promise<ContextBlock[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const queryEmbedding = await embedText(query);
  const hits = await semanticSearch(sb, orgId, queryEmbedding, k);
  return hits.map((h) => ({ source: h.meetingId ? `Meeting ${h.meetingId}` : "Knowledge base", text: h.content }));
}
