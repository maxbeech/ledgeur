// Ledgeur's Contextely integration against Contextely v2, through a REAL local
// HTTP server standing in for it. The shared module the two edge functions use
// (`supabase/functions/_shared/contextely.ts`) is pure, so it runs here exactly as
// it runs in Deno; the functions themselves are pinned by source assertions.
//
// Contract coded against: Contextely's `src/lib/api/catalogue.ts` and `tools.ts`
// (`whoami`, `search`, `record_get`), snake_case. NOT yet run against a live v2:
// that waits for the Contextely v2 cutover.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import {
  contextelyBaseUrl, ContextelyHttpError, MAX_QUERY_CHARS, RECORDS_TO_READ, searchContext, SEARCH_LIMIT, verifyKey,
} from "../../../supabase/functions/_shared/contextely.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;
type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void;

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

export async function runContextelyTests(ok: Ok): Promise<void> {
  let handler: Handler = (_q, res) => send(res, 500, {});
  let seen: Array<{ path: string; query: Record<string, string>; auth?: string; method?: string }> = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    seen.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, method: req.method });
    handler(req, res, url);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  const hit = (id: string, extra: Record<string, unknown> = {}) => ({
    id, title: `Title ${id}`, collection: "Policies", kind: "authored", snippet: `snippet ${id}`, ...extra,
  });
  const rec = (id: string) => ({
    id, properties: [{ name: "Owner", value: "Dana" }, { name: "Related", value: [{ id: "x", title: "Other page" }] }],
    content: `full text ${id}`,
  });
  const route = (hits: unknown[], records: Record<string, unknown> = {}): Handler => (_q, res, url) => {
    if (url.pathname === "/api/v1/search") return send(res, 200, { hits, ranking: "fused", warnings: [] });
    const m = url.pathname.match(/^\/api\/v1\/records\/(.+)$/);
    if (m && records[m[1]!]) return send(res, 200, records[m[1]!]);
    send(res, 404, { error: { code: "not_found", message: "Not found." } });
  };

  try {
    // ---- verify: GET /me ----
    handler = (_q, res) => send(res, 200, { workspace: { id: "w1", name: "Acme", plan: "free" }, member_id: "m", key_id: "k", write_mode: "none", collections: null });
    const who = await verifyKey(base, "ctx_sk_abc", fetch);
    ok("a pasted key is verified with GET /api/v1/me", seen[0]?.path === "/api/v1/me" && seen[0]?.method === "GET" && seen[0]?.auth === "Bearer ctx_sk_abc", JSON.stringify(seen[0]));
    ok("verify returns the workspace name and id", who.workspaceName === "Acme" && who.workspaceId === "w1");

    handler = (_q, res) => send(res, 401, { error: { code: "unauthorized", message: "That key is not valid." } });
    const rejected = await verifyKey(base, "bad", fetch).catch((e: unknown) => e);
    ok("a rejected key surfaces Contextely's own reason", rejected instanceof ContextelyHttpError && rejected.message === "That key is not valid." && rejected.status === 401);

    const dead = createServer(); await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
    const deadBase = `http://127.0.0.1:${(dead.address() as AddressInfo).port}/api/v1`;
    await new Promise<void>((r) => dead.close(() => r()));
    const unreachable = await verifyKey(deadBase, "k", fetch).catch((e: unknown) => e);
    ok("an unreachable host is distinguishable from a bad key (status null)", unreachable instanceof ContextelyHttpError && unreachable.status === null && unreachable.code === "connection_error");

    // ---- search + record_get ----
    seen = [];
    handler = route(["a", "b", "c", "d", "e"].map((i) => hit(i)), { a: rec("a"), b: rec("b"), c: rec("c") });
    const blocks = await searchContext(base, "ctx_sk_abc", "What is our refund policy?", fetch);
    ok("search is GET /search?query=&limit=", seen[0]?.path === "/api/v1/search" && seen[0]?.method === "GET" && seen[0]?.query.query === "What is our refund policy?" && seen[0]?.query.limit === String(SEARCH_LIMIT), JSON.stringify(seen[0]));
    ok("the top hits (and only those) are read with record_get", seen.filter((s) => s.path.startsWith("/api/v1/records/")).length === RECORDS_TO_READ);
    ok("every call carries the key as a bearer token", seen.every((s) => s.auth === "Bearer ctx_sk_abc"));
    ok("blocks are headed by the record title and collection (cited)", blocks[0]?.source === "Contextely: Title a — Policies", blocks[0]?.source);
    ok("a block carries the snippet and the record's own text", !!blocks[0]?.text.includes("snippet a") && !!blocks[0]?.text.includes("full text a") && !!blocks[0]?.text.includes("Owner: Dana"));
    ok("relation properties read as the linked titles", !!blocks[0]?.text.includes("Related: Other page"));
    ok("a hit beyond the top few keeps its snippet", blocks[4]?.text === "snippet e");

    // ---- derived is lower confidence ----
    handler = route([hit("a", { kind: "derived" }), hit("b")], { a: rec("a"), b: rec("b") });
    const mixed = await searchContext(base, "k", "q", fetch);
    ok("kind: derived is marked lower confidence", !!mixed[0]?.text.includes("AI-derived") && !mixed[1]?.text.includes("AI-derived"));

    // ---- degraded and refused reads ----
    handler = route([hit("a"), hit("b")], { b: rec("b") });
    const partial = await searchContext(base, "k", "q", fetch);
    ok("a record that cannot be read keeps its snippet instead of breaking Ask", partial[0]?.text === "snippet a" && !!partial[1]?.text.includes("full text b"));

    handler = (_q, res) => send(res, 429, { error: { code: "quota_exceeded", message: "used its agent reads" } });
    const refused = await searchContext(base, "k", "q", fetch).catch((e: unknown) => e);
    ok("a failed search throws (the edge function turns that into no context)", refused instanceof ContextelyHttpError && refused.code === "quota_exceeded");

    handler = (_q, res) => send(res, 200, { results: [] });
    const malformed = await searchContext(base, "k", "q", fetch).catch((e: unknown) => e);
    ok("a response with no hits list is malformed, not empty", malformed instanceof ContextelyHttpError && malformed.code === "malformed_response");

    handler = route([]);
    ok("an empty hits list is a real, empty answer", (await searchContext(base, "k", "q", fetch)).length === 0);

    handler = route([hit("a", { snippet: "" })], { a: { id: "a", properties: [], content: "" } });
    ok("a hit with no text at all produces no block", (await searchContext(base, "k", "q", fetch)).length === 0);

    seen = []; handler = route([]);
    await searchContext(base, "k", `${"long ".repeat(300)}`, fetch);
    ok("the query is capped at Contextely's 500 characters", (seen[0]?.query.query?.length ?? 999) <= MAX_QUERY_CHARS);
    seen = [];
    ok("a blank question is not sent", (await searchContext(base, "k", "   ", fetch)).length === 0 && seen.length === 0);

    // ---- base URL convention (kept: the deployed secret includes /api/v1) ----
    ok("base url: default includes /api/v1 and a trailing slash is trimmed",
      contextelyBaseUrl(undefined) === "https://www.contextely.com/api/v1" && contextelyBaseUrl("https://x.test/api/v1/") === "https://x.test/api/v1");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }

  // ---- the two edge functions and the copy ----
  const connect = read("../../../supabase/functions/contextely-connect/index.ts");
  const context = read("../../../supabase/functions/contextely-context/index.ts");
  ok("contextely-connect verifies through the shared v2 client, not /usage", connect.includes("verifyKey(") && !/\/usage/.test(connect));
  ok("contextely-connect keeps the workspace name for the card", /workspace_name/.test(connect));
  ok("contextely-context searches through the shared v2 client, not POST /search", context.includes("searchContext(") && !/method:\s*"POST"/.test(context) && !/summary|source_name|freshness/.test(context));
  const card = read("../src/components/integrations/ContextelyCard.tsx");
  ok("the card says Contextely gives Ask the company's knowledge, limited to what you can see",
    /gives Ask your company's knowledge, limited to what you can see/.test(card));
  ok("no copy still describes the old condensed 'memory' framing", !/condensed/.test(card));
}
