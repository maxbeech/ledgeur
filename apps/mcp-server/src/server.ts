// Builds the Ledgeur MCP server for the stdio transport.
//
// The TOOLS THEMSELVES LIVE IN @ledgeur/mcp, not here. They used to be defined
// inline, which was fine while stdio was the only way in; it stopped being fine
// the moment a hosted HTTP endpoint appeared, because two definitions of the
// same four tools drift and nobody notices until a client switches transport
// and a tool is missing or shaped differently.
//
// So this file is now only the stdio ADAPTER: it turns each definition into an
// SDK registration and nothing else. Adding a tool means editing
// packages/mcp/src/tools.ts, and both servers gain it.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@ledgeur/core";
import { TOOLS } from "@ledgeur/mcp";

export function buildServer(db: SupabaseClient): McpServer {
  const server = new McpServer({ name: "ledgeur", version: "0.2.0" });

  // One cast, at the boundary, with the reason. `registerTool` is generic over
  // the zod shape so that it can infer the handler's argument type. TOOLS is a
  // heterogeneous array, so there is no single shape to infer from and the
  // generic collapses to `never`. The runtime contract is exactly right; only
  // the inference has nowhere to go.
  const register = server.registerTool.bind(server) as (
    name: string,
    config: { description: string; inputSchema: unknown },
    handler: (args: Record<string, unknown>) => Promise<{
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    }>,
  ) => void;

  for (const tool of TOOLS) {
    register(
      tool.name,
      { description: tool.description, inputSchema: tool.input },
      async (args: Record<string, unknown>) => {
        try {
          const value = await tool.run(db, args ?? {});
          return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
        } catch (e) {
          // A caller-fixable problem (an id nobody can see, a bad status) comes
          // back as a tool error rather than a transport fault, so the agent
          // can read it and try something else.
          return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
        }
      },
    );
  }

  return server;
}
