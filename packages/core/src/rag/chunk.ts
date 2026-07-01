// Text chunking for embeddings/RAG. Word-based windows with overlap so context
// isn't lost at boundaries. Pure and deterministic — unit-tested.

export interface Chunk {
  index: number;
  text: string;
}

/** Split text into overlapping word windows. `size`/`overlap` are word counts. */
export function chunkText(text: string, size = 180, overlap = 30): Chunk[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= size) return [{ index: 0, text: words.join(" ") }];

  const step = Math.max(1, size - overlap);
  const chunks: Chunk[] = [];
  let index = 0;
  for (let i = 0; i < words.length; i += step) {
    chunks.push({ index: index++, text: words.slice(i, i + size).join(" ") });
    if (i + size >= words.length) break; // this window already reaches the end
  }
  return chunks;
}

/** Build the corpus for a meeting: title + notes + transcript, chunked. */
export function meetingChunks(input: {
  title: string;
  summary: string[];
  transcript: string;
}): Chunk[] {
  const corpus = [
    input.title,
    input.summary.join(". "),
    input.transcript,
  ].filter((s) => s && s.trim().length > 0).join("\n\n");
  return chunkText(corpus);
}
