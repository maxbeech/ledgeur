// One place that talks HTTP to the on-device model server, so every feature
// (chat, ask, suggestions, embeddings) fails the same honest, actionable way
// when it isn't running — instead of leaking "Failed to fetch".

export async function postToLocalModel(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error(
      "The on-device model isn't running. Start a local llama.cpp server " +
      "(Settings → On-device AI) and try again — answers are never invented without it.",
    );
  }
}
