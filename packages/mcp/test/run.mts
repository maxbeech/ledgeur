// @ledgeur/mcp test suite. Run: pnpm --filter @ledgeur/mcp test
//
// The property that matters most here is that the two transports expose the
// SAME tools. They were defined inline in the stdio server, so when a hosted
// HTTP endpoint appeared there were briefly two sources for four tools, which
// is exactly the drift nobody notices until a client switches transport.

import { TOOLS, jsonSchemaFor, toolByName } from "../src/tools.ts";
import { bearerFrom } from "../src/auth.ts";
import { handleBody, handleRpc, SUPPORTED_PROTOCOLS } from "../src/jsonrpc.ts";

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

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
