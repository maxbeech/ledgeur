// A stateless JSON-RPC 2.0 handler for MCP over Streamable HTTP.
//
// WHY NOT THE SDK'S SERVER TRANSPORT. The stdio server uses it and should: it
// is a long-lived process with a session. A Next.js route handler on Vercel is
// neither, and the SDK's HTTP transport wants a session lifecycle that a
// serverless function cannot honour without external state. Every method below
// is a pure function of one request, so a stateless handler is both smaller and
// more honest about what the deployment actually is.
//
// The tool definitions are NOT duplicated here: they come from ./tools.ts, the
// same array the stdio server registers. That is the whole point of the split.

import type { SupabaseClient } from "@supabase/supabase-js";
import { TOOLS, jsonSchemaFor, toolByName } from "./tools.ts";

/** Protocol revisions this endpoint will speak, newest first. */
export const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

const SERVER_INFO = { name: "ledgeur", version: "0.2.0" };

const INSTRUCTIONS = [
  "Ledgeur holds this person's meetings: the notes taken during them, who spoke, and the full transcript.",
  "",
  "Browse with list_meetings or narrow with search_meetings, then call get_meeting for the one you want. Do not",
  "guess a meeting id: they come from the list and search tools.",
  "",
  "You are reading as one person. Row level security decides what is visible, so an empty result means this person",
  "cannot see it, not that it does not exist.",
].join("\n");

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const result = (id: JsonRpcRequest["id"], value: unknown) => ({ jsonrpc: "2.0", id, result: value });
const error = (id: JsonRpcRequest["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/**
 * Handle one JSON-RPC message. Returns null for a notification, which the
 * caller answers with 202 and no body.
 */
export async function handleRpc(message: JsonRpcRequest, db: SupabaseClient): Promise<unknown | null> {
  const { id, method, params } = message;
  // A notification has no id AT ALL. `id: null` is a request, and answering it
  // with silence is the mistake every hand-rolled implementation makes once.
  const isNotification = !("id" in message);

  switch (method) {
    case "initialize": {
      const asked = String((params as { protocolVersion?: string })?.protocolVersion ?? "");
      // An unknown version falls back to the newest we speak rather than
      // failing: a client that asks for something newer can still talk to us.
      const negotiated = SUPPORTED_PROTOCOLS.includes(asked as (typeof SUPPORTED_PROTOCOLS)[number])
        ? asked
        : SUPPORTED_PROTOCOLS[0];
      return result(id, {
        protocolVersion: negotiated,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    case "notifications/initialized":
      return null;

    case "tools/list":
      return result(id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: jsonSchemaFor(t) })),
      });

    case "tools/call": {
      const { name, arguments: args } = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const tool = toolByName(String(name ?? ""));
      if (!tool) {
        // A wrong tool name is the CALLER's mistake to fix, so it comes back as
        // a tool error rather than a transport fault: an agent can read it and
        // try something else.
        return result(id, {
          content: [{ type: "text", text: `No tool called "${name}". Available: ${TOOLS.map((t) => t.name).join(", ")}` }],
          isError: true,
        });
      }
      try {
        const value = await tool.run(db, args ?? {});
        const text = JSON.stringify(value, null, 2);
        return result(id, { content: [{ type: "text", text }], structuredContent: value });
      } catch (e) {
        return result(id, {
          content: [{ type: "text", text: (e as Error).message }],
          isError: true,
        });
      }
    }

    default:
      if (isNotification) return null;
      return error(id, -32601, `Unknown method "${method}".`);
  }
}

/** Handle a whole POST body, which may be one message or a batch. */
export async function handleBody(body: unknown, db: SupabaseClient): Promise<unknown | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return error(null, -32600, "An empty batch is not a valid request.");
    const answers = (await Promise.all(body.map((m) => handleRpc(m as JsonRpcRequest, db)))).filter(
      (a) => a !== null,
    );
    return answers.length > 0 ? answers : null;
  }
  return handleRpc(body as JsonRpcRequest, db);
}
