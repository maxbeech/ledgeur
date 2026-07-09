// HTTP fallback to an OpenAI-compatible endpoint (a BYO cloud key or an
// external llama.cpp), used only when the in-process native engine isn't
// available. Fails the same honest, actionable way everywhere instead of
// leaking "Failed to fetch" — answers are never invented without a model.

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
      "The on-device model isn't ready yet. Open Settings → On-device AI to " +
      "finish downloading it (a one-time ~1 GB download) — answers are never invented without it.",
    );
  }
}
