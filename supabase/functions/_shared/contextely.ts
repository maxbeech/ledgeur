// Contextely v2, as far as Ledgeur needs it. Pure: `fetch` and the base URL are
// passed in, so it runs under Deno (the edge functions) and under tsx (tests)
// with no Deno globals.
//
// CODED AGAINST CONTEXTELY'S TOOL CATALOGUE (`src/lib/api/catalogue.ts` in that
// repo), snake_case on the wire. Three tools are used:
//   whoami      GET /v1/me          verify a pasted key, name its workspace
//   search      GET /v1/search      titles + a snippet per hit
//   record_get  GET /v1/records/:id one record in full (properties + page text)
//
// A key acts as ONE PERSON and sees only what that person can see in Contextely.
// Nothing is said about what is hidden, so Ask can never claim a complete picture:
// the copy in the app says "limited to what you can see".
//
// The v1 API (`/usage`, `POST /search` with a `results` array of summaries) is gone
// with no shim. The base URL keeps the old convention of including `/api/v1`, so the
// CONTEXTELY_BASE_URL secret already set on a deployment keeps meaning the same thing.

export const DEFAULT_BASE_URL = "https://www.contextely.com/api/v1";

/** Hits asked of `search`. */
export const SEARCH_LIMIT = 6;
/** Top hits fetched in full with `record_get` (each is a metered agent read). */
export const RECORDS_TO_READ = 3;
/** Per-record cap on text handed to the model. */
export const MAX_RECORD_CHARS = 2500;
/** `search`'s `query` is capped at 500 characters server-side. */
export const MAX_QUERY_CHARS = 500;

/** Ask has a five-second deadline for all its sources, so each call gets less. */
const CALL_TIMEOUT_MS = 2500;

export interface ContextBlock { source: string; text: string }

type Fetch = typeof fetch;

export function contextelyBaseUrl(env: string | undefined): string {
  return (env?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** A refusal or failure from Contextely, with the reason a person can act on. */
export class ContextelyHttpError extends Error {
  constructor(readonly code: string, message: string, readonly status: number | null) {
    super(message);
    this.name = "ContextelyHttpError";
  }
}

async function get<T>(base: string, key: string, path: string, query: Record<string, string> | undefined, fetchImpl: Fetch): Promise<T> {
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (e) {
    throw new ContextelyHttpError("connection_error", `Could not reach Contextely (${e instanceof Error ? e.message : String(e)}).`, null);
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ContextelyHttpError(err?.code ?? `http_${res.status}`, err?.message ?? `Contextely rejected this key (${res.status}).`, res.status);
  }
  if (!body || typeof body !== "object") throw new ContextelyHttpError("malformed_response", "Contextely's response was not understood.", res.status);
  return body as T;
}

export interface VerifiedKey { workspaceId: string | null; workspaceName: string | null }

/** `GET /v1/me`. Throws ContextelyHttpError with Contextely's own reason on a bad key. */
export async function verifyKey(base: string, key: string, fetchImpl: Fetch = fetch): Promise<VerifiedKey> {
  const me = await get<{ workspace?: { id?: string; name?: string } }>(base, key, "/me", undefined, fetchImpl);
  return { workspaceId: me.workspace?.id ?? null, workspaceName: me.workspace?.name ?? null };
}

interface Hit { id: string; title?: string; collection?: string | null; kind?: string | null; snippet?: string }
interface RecordDetail {
  properties?: Array<{ name?: string; value?: unknown }>;
  content?: string | null;
}

/**
 * Ask context for a question: `search`, then `record_get` for the top hits.
 * Each block is headed by the record's title so an answer can cite it, carries the
 * matching snippet plus the record's text, and is marked when it is AI-derived.
 *
 * Throws on a failed `search` (the caller decides that is non-fatal for Ask). A
 * `record_get` that fails leaves that hit as its snippet alone: it is still real
 * text Contextely returned.
 */
export async function searchContext(base: string, key: string, question: string, fetchImpl: Fetch = fetch): Promise<ContextBlock[]> {
  const query = question.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
  if (!query) return [];
  const found = await get<{ hits?: Hit[] }>(base, key, "/search", { query, limit: String(SEARCH_LIMIT) }, fetchImpl);
  if (!Array.isArray(found.hits)) throw new ContextelyHttpError("malformed_response", "Contextely's search response had no hits list.", 200);

  const details = await Promise.all(found.hits.slice(0, RECORDS_TO_READ).map(async (hit) => {
    try { return await get<RecordDetail>(base, key, `/records/${encodeURIComponent(hit.id)}`, undefined, fetchImpl); }
    catch { return null; }
  }));

  return found.hits.flatMap((hit, i): ContextBlock[] => {
    const parts = [hit.snippet?.trim(), recordText(details[i] ?? null)].filter(Boolean) as string[];
    if (parts.length === 0) return [];
    let text = parts.join("\n\n");
    if (text.length > MAX_RECORD_CHARS) text = `${text.slice(0, MAX_RECORD_CHARS)} [truncated]`;
    if (hit.kind === "derived") text += "\n(AI-derived in Contextely: lower confidence than something a person wrote.)";
    const title = hit.title?.trim() || "Untitled";
    return [{ source: `Contextely: ${hit.collection ? `${title} — ${hit.collection}` : title}`, text }];
  });
}

function recordText(d: RecordDetail | null): string {
  if (!d) return "";
  const props = (d.properties ?? []).flatMap((p) => {
    const v = plain(p.value);
    return p.name && v ? [`${p.name}: ${v}`] : [];
  });
  return [props.join("\n"), typeof d.content === "string" ? d.content.trim() : ""].filter(Boolean).join("\n\n");
}

function plain(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return v.map((x) => typeof x === "string" ? x : x && typeof x === "object" && "title" in x ? String((x as { title: unknown }).title) : "").filter(Boolean).join(", ");
  }
  return "";
}
