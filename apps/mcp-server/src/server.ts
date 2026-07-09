// Builds the Ledgeur MCP server and registers its tools. Each tool reads the
// user's knowledge base through @ledgeur/core's repository (RLS-enforced).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SupabaseClient } from "@ledgeur/core";
import { listMeetings, getMeeting, searchMeetings, listActionItems } from "@ledgeur/core";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

export function buildServer(db: SupabaseClient): McpServer {
  const server = new McpServer({ name: "ledgeur", version: "0.2.0" });

  server.tool(
    "list_meetings",
    "List the user's most recent meetings (title, date, status). Use to browse before drilling into one.",
    { limit: z.number().int().min(1).max(100).optional() },
    async ({ limit }) => json(await listMeetings(db, limit ?? 25)),
  );

  server.tool(
    "search_meetings",
    "Search the user's meetings by keyword in the title. Returns matching meetings.",
    { query: z.string().min(1) },
    async ({ query }) => json(await searchMeetings(db, query)),
  );

  server.tool(
    "get_meeting",
    "Get a single meeting with its notes, speakers and full transcript by meeting id.",
    { id: z.string().min(1) },
    async ({ id }) => {
      const m = await getMeeting(db, id);
      return m ? json(m) : text(`No meeting ${id} is visible to you.`);
    },
  );

  server.tool(
    "list_tasks",
    "List action items (tasks) extracted from meetings, optionally filtered by status.",
    { status: z.enum(["open", "in_progress", "done", "cancelled"]).optional() },
    async ({ status }) => json(await listActionItems(db, { status })),
  );

  return server;
}
