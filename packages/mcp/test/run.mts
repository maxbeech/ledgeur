// @ledgeur/mcp test suite. Run: pnpm --filter @ledgeur/mcp test
//
// The property that matters most here is that the two transports expose the
// SAME tools. They were defined inline in the stdio server, so when a hosted
// HTTP endpoint appeared there were briefly two sources for four tools, which
// is exactly the drift nobody notices until a client switches transport.

import { TOOLS, jsonSchemaFor, toolByName } from "../src/tools.ts";
import { bearerFrom } from "../src/auth.ts";
import { handleBody, handleRpc, SUPPORTED_PROTOCOLS } from "../src/jsonrpc.ts";
import { runTokenTests } from "./token.mts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};

/** A stand-in for Supabase: every tool call resolves to what it was handed. */
const fakeDb = {} as never;

// --- the tool set -----------------------------------------------------------

ok("exposes the four documented tools", TOOLS.length === 4);
ok(
  "names them what the app's own documentation says",
  ["list_meetings", "search_meetings", "get_meeting", "list_tasks"].every((n) => !!toolByName(n)),
  TOOLS.map((t) => t.name).join(", "),
);
ok("has a description on every tool, because a client shows it to a model", TOOLS.every((t) => t.description.length > 20));
ok("resolves an unknown tool to undefined rather than throwing", toolByName("nope") === undefined);

// --- the wire schema, derived rather than written twice ----------------------

const searchSchema = jsonSchemaFor(toolByName("search_meetings")!) as {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
  $schema?: string;
};
ok("derives an object schema", searchSchema.type === "object");
ok("carries the property names the handler reads", "query" in searchSchema.properties);
ok("marks a required argument required", (searchSchema.required ?? []).includes("query"));
ok("strips the $schema preamble MCP does not want", searchSchema.$schema === undefined);

const listSchema = jsonSchemaFor(toolByName("list_meetings")!) as { required?: string[] };
ok("leaves an optional argument out of required", !(listSchema.required ?? []).includes("limit"));

const tasksSchema = jsonSchemaFor(toolByName("list_tasks")!) as {
  properties: { status?: { enum?: string[] } };
};
ok(
  "carries an enum through to the wire, so a client can offer the choices",
  (tasksSchema.properties.status?.enum ?? []).includes("in_progress"),
);

// --- the record shape a field-path consumer reads --------------------------
//
// Contextely ingests Ledgeur over this endpoint using its `mcp_http` connector,
// which is configured with dotted field paths rather than a bespoke adapter —
// its Ledgeur preset reads `id`, `title`, `url` and `notes,transcript,summary`.
// These tools used to return the repository's nested `FullMeeting`
// (`{ meeting, note, speakers, segments }`), against which every one of those
// paths resolved to nothing: meetings ingested with no id, no title and no
// content at all. That is a silent failure at the far end — Contextely stores
// empty memory objects rather than erroring — so it is pinned here.

{
  const meetingRow = {
    id: "m-1", org_id: "o-1", owner_id: "u-1", title: "Pricing review", status: "complete",
    visibility: "org", calendar_event_id: null, started_at: "2026-09-01T10:00:00Z",
    ended_at: "2026-09-01T10:30:00Z", lang: "en-hq", created_at: "2026-09-01T10:30:00Z",
  };
  const noteRow = {
    meeting_id: "m-1", summary: ["Agreed the new tiers"], decisions: ["Ship Friday"],
    questions: ["What about annual?"], markdown: "# Pricing review\n- Agreed the new tiers",
    generator: "qwen2.5", word_count: 812, updated_at: "2026-09-01T10:31:00Z",
  };
  const speakerRow = { id: "sp-1", meeting_id: "m-1", label: "Sam", is_primary: false, metadata: {} };
  const segmentRow = {
    id: "seg-1", meeting_id: "m-1", speaker_id: "sp-1", start_ms: 0, end_ms: 2000,
    text: "We should raise the middle tier.", confidence: 0.94,
  };

  // A Supabase stand-in that answers the exact queries the repository makes.
  const table = (name: string) => {
    const rows = { meetings: [meetingRow], meeting_notes: [noteRow], speakers: [speakerRow], transcript_segments: [segmentRow] }[name] ?? [];
    const api: any = {
      select: () => api, eq: () => api, order: () => api, limit: () => api, ilike: () => api,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (res: any) => Promise.resolve({ data: rows, error: null }).then(res),
    };
    return api;
  };
  const db = { from: (name: string) => table(name) } as never;

  const listed = (await toolByName("list_meetings")!.run(db, {})) as Record<string, unknown>[];
  ok("list_meetings returns a flat array of records", Array.isArray(listed) && listed.length === 1);
  ok("a listed record carries a top-level id", listed[0]?.id === "m-1", JSON.stringify(listed[0]));
  ok("a listed record carries a top-level title", listed[0]?.title === "Pricing review");
  ok("a listed record carries a citable url", String(listed[0]?.url ?? "").includes("/meetings/m-1"), String(listed[0]?.url));

  const got = (await toolByName("get_meeting")!.run(db, { id: "m-1" })) as Record<string, unknown>;
  ok("get_meeting returns a flat record", got.id === "m-1" && got.title === "Pricing review", JSON.stringify(Object.keys(got)));
  ok("get_meeting exposes url for citation", String(got.url).includes("/meetings/m-1"));
  ok("get_meeting exposes notes as text", typeof got.notes === "string" && (got.notes as string).includes("Agreed the new tiers"));
  ok("get_meeting exposes summary as text", got.summary === "Agreed the new tiers", String(got.summary));
  ok("get_meeting exposes decisions as text", got.decisions === "Ship Friday", String(got.decisions));
  ok(
    "get_meeting exposes the transcript as speaker-attributed text",
    typeof got.transcript === "string" && (got.transcript as string).includes("Sam: We should raise the middle tier."),
    String(got.transcript),
  );
  // The nested detail an agent needs for "who said what" is kept alongside.
  ok("get_meeting still carries structured speakers", Array.isArray(got.speakers) && (got.speakers as unknown[]).length === 1);
  ok("get_meeting still carries structured segments", Array.isArray(got.segments) && (got.segments as unknown[]).length === 1);
  // Every path the Contextely preset is configured with must resolve.
  ok(
    "every field path the Contextely preset reads resolves",
    ["id", "title", "url", "notes", "transcript", "summary"].every((k) => {
      const v = got[k];
      return typeof v === "string" && v.length > 0;
    }),
    JSON.stringify(got),
  );
}

// --- JSON-RPC ---------------------------------------------------------------

const init = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, fakeDb)) as {
  result: { protocolVersion: string; serverInfo: { name: string }; instructions: string };
};
ok("negotiates the protocol version a client asked for", init.result.protocolVersion === "2025-06-18");
ok("identifies itself", init.result.serverInfo.name === "ledgeur");
ok("sends instructions, which is the highest-leverage prose in the server", init.result.instructions.includes("meetings"));

const unknownVersion = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } }, fakeDb)) as {
  result: { protocolVersion: string };
};
ok(
  "falls back to the newest version it speaks rather than refusing a newer client",
  unknownVersion.result.protocolVersion === SUPPORTED_PROTOCOLS[0],
);

const listed = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, fakeDb)) as {
  result: { tools: Array<{ name: string; inputSchema: { type: string } }> };
};
ok("advertises every tool over the wire", listed.result.tools.length === TOOLS.length);
ok("advertises each with a JSON Schema, not a zod shape", listed.result.tools.every((t) => t.inputSchema.type === "object"));

const unknownTool = (await handleRpc(
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "no_such_tool", arguments: {} } },
  fakeDb,
)) as { result: { isError: boolean; content: Array<{ text: string }> } };
ok("reports an unknown tool as a TOOL error an agent can act on", unknownTool.result.isError === true);
ok("names the tools that do exist, so the agent can retry", unknownTool.result.content[0].text.includes("list_meetings"));

const unknownMethod = (await handleRpc({ jsonrpc: "2.0", id: 5, method: "no/such/method" }, fakeDb)) as {
  error: { code: number };
};
ok("reports an unknown METHOD as a transport error, which is different", unknownMethod.error.code === -32601);

// A notification has no id at all. `id: null` is a request, and answering it
// with silence is the mistake every hand-rolled implementation makes once.
const notification = await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, fakeDb);
ok("answers a notification with nothing", notification === null);

const nullId = (await handleRpc({ jsonrpc: "2.0", id: null, method: "tools/list" }, fakeDb)) as { id: null } | null;
ok("answers id null, because it is a request and not a notification", nullId !== null);

const batch = (await handleBody(
  [
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ],
  fakeDb,
)) as unknown[];
ok("answers a batch as a batch", Array.isArray(batch) && batch.length === 2);

const emptyBatch = (await handleBody([], fakeDb)) as { error: { code: number } };
ok("refuses an empty batch", emptyBatch.error.code === -32600);

const allNotifications = await handleBody([{ jsonrpc: "2.0", method: "notifications/initialized" }], fakeDb);
ok("answers a batch of only notifications with nothing", allNotifications === null);

// --- auth header parsing ----------------------------------------------------

ok("reads a bearer token", bearerFrom("Bearer abc123") === "abc123");
ok("is case-insensitive about the scheme, because clients differ", bearerFrom("bearer abc") === "abc");
ok("ignores a missing header", bearerFrom(null) === null);
ok("ignores a non-bearer scheme rather than mistaking it for a token", bearerFrom("Basic abc") === null);

// --- access tokens ---
await runTokenTests(ok);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
