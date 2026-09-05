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

/**
 * Where a meeting can be opened by a person. Emitted as `url` on every record so
 * anything that ingests these can cite back to the source.
 */
const APP_BASE_URL = "https://ledgeur.com/app";
const meetingUrl = (id: string) => `${APP_BASE_URL}/meetings/${id}`;

/**
 * The wire shape of a meeting record.
 *
 * Deliberately FLAT, with `id`, `title`, `url` and the text in named top-level
 * fields. The repository's own `FullMeeting` is nested (`{ meeting, note,
 * speakers, segments }`), and returning that directly is what broke ingestion
 * into Contextely: a generic MCP consumer is configured with field paths — the
 * Ledgeur preset reads `id`, `title`, `notes,transcript,summary` — and against
 * a nested record every one of those resolved to nothing, so meetings arrived
 * with no identifier, no title and no content. Anything reading these tools
 * conversationally is unaffected (it was reading JSON either way); anything
 * reading them by path now works.
 *
 * The nested detail is kept alongside, under `speakers` and `segments`, because
 * an agent asking "who said what" still needs it.
 */
interface MeetingRecord {
  id: string;
  title: string;
  url: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  lang: string;
}

function toRecord(m: {
  id: string; title: string; status: string; lang: string;
  startedAt: string | null; endedAt: string | null; createdAt: string;
}): MeetingRecord {
  return {
    id: m.id,
    title: m.title,
    url: meetingUrl(m.id),
    status: m.status,
    startedAt: m.startedAt,
    endedAt: m.endedAt,
    createdAt: m.createdAt,
    lang: m.lang,
  };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_meetings",
    description:
      "List the user's most recent meetings (title, date, status). Use to browse before drilling into one.",
    input: { limit: z.number().int().min(1).max(100).optional().describe("How many to return, up to 100.") },
    run: async (db, args) => (await listMeetings(db, clamp(args.limit, 25, 100))).map(toRecord),
  },
  {
    name: "search_meetings",
    description: "Search the user's meetings by keyword in the title. Returns matching meetings.",
    input: { query: z.string().min(1).describe("Words to look for in the title.") },
    run: async (db, args) => (await searchMeetings(db, String(args.query ?? ""))).map(toRecord),
  },
  {
    name: "get_meeting",
    description:
      "Get a single meeting by id: its summary, decisions, open questions, the full Markdown notes, "
      + "the whole transcript as text, and the speakers and timed segments behind it.",
    input: { id: z.string().min(1).describe("The meeting id, as returned by list_meetings.") },
    run: async (db, args) => {
      const full = await getMeeting(db, String(args.id ?? ""));
      if (!full) throw new Error(`No meeting ${args.id} is visible to you.`);
      const speakerName = new Map(full.speakers.map((s) => [s.id, s.label]));
      return {
        ...toRecord(full.meeting),
        // Named, top-level and plain text: this is what gets condensed into
        // memory, and what a field-path consumer is configured to read.
        summary: full.note?.summary.join("\n") ?? "",
        decisions: full.note?.decisions.join("\n") ?? "",
        questions: full.note?.questions.join("\n") ?? "",
        notes: full.note?.markdown ?? "",
        transcript: full.segments
          .map((s) => `${speakerName.get(s.speakerId ?? "") ?? "Speaker"}: ${s.text}`)
          .join("\n"),
        wordCount: full.note?.wordCount ?? 0,
        speakers: full.speakers,
        segments: full.segments,
      };
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
