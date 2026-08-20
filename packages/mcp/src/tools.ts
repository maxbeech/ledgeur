// The Ledgeur tool set, defined ONCE.
//
// Two servers expose these: the stdio server in apps/mcp-server, which is what
// Claude Desktop and Cursor speak to, and the hosted HTTP endpoint in
// apps/marketing, which is what a remote client such as Contextely speaks to.
// Neither owns the definitions, because a tool that exists over one transport
// and not the other is a bug nobody notices until somebody switches.
//
// Every tool reads through @ledgeur/core's repository, so RLS decides what a
// caller can see. A tool never widens visibility; it only shapes it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { z, type ZodRawShape } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getMeeting, listActionItems, listMeetings, searchMeetings } from "@ledgeur/core";

/**
 * ONE definition per tool, in zod.
 *
 * The two transports want different things from it: the SDK's `registerTool`
 * takes a zod shape, and the JSON-RPC wire format takes JSON Schema. Rather
 * than write both and add a test that they agree, the zod shape is the source
 * and `jsonSchemaFor` derives the wire form, so they cannot disagree.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** The zod shape, for the SDK. */
  input: ZodRawShape;
  run(db: SupabaseClient, args: Record<string, unknown>): Promise<unknown>;
}

/** The wire form of a tool's input, derived rather than written twice. */
export function jsonSchemaFor(tool: ToolDefinition): Record<string, unknown> {
  const schema = zodToJsonSchema(z.object(tool.input), { target: "jsonSchema7" }) as Record<string, unknown>;
  // MCP wants a bare object schema; the converter adds a $schema preamble.
  delete schema.$schema;
  return schema;
}

const clamp = (v: unknown, fallback: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
};

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_meetings",
    description:
      "List the user's most recent meetings (title, date, status). Use to browse before drilling into one.",
    input: { limit: z.number().int().min(1).max(100).optional().describe("How many to return, up to 100.") },
    run: (db, args) => listMeetings(db, clamp(args.limit, 25, 100)),
  },
  {
    name: "search_meetings",
    description: "Search the user's meetings by keyword in the title. Returns matching meetings.",
    input: { query: z.string().min(1).describe("Words to look for in the title.") },
    run: (db, args) => searchMeetings(db, String(args.query ?? "")),
  },
  {
    name: "get_meeting",
    description: "Get a single meeting with its notes, speakers and full transcript by meeting id.",
    input: { id: z.string().min(1).describe("The meeting id, as returned by list_meetings.") },
    run: async (db, args) => {
      const meeting = await getMeeting(db, String(args.id ?? ""));
      if (!meeting) throw new Error(`No meeting ${args.id} is visible to you.`);
      return meeting;
    },
  },
  {
    name: "list_tasks",
    description: "List action items (tasks) extracted from meetings, optionally filtered by status.",
    input: {
      status: z
        .enum(["open", "in_progress", "done", "cancelled"])
        .optional()
        .describe("Only return action items in this state."),
    },
    run: (db, args) =>
      listActionItems(db, {
        status: args.status ? (String(args.status) as "open" | "in_progress" | "done" | "cancelled") : undefined,
      }),
  },
];

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}
