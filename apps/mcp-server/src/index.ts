// Entry point for the Ledgeur MCP server (stdio transport — the shape Claude
// Desktop, Cursor and other MCP clients expect). Fails loudly if unconfigured.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getClientFromEnv } from "./config.ts";
import { buildServer } from "./server.ts";

async function main() {
  const db = await getClientFromEnv();
  const server = buildServer(db);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr — stdout is reserved for the MCP protocol stream.
  console.error("Ledgeur MCP server ready (stdio).");
}

main().catch((err) => {
  console.error("Ledgeur MCP server failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
