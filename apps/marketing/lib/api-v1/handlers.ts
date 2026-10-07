// The public Meetings API, v1. One router over plain Request/Response so it is
// testable without Next, with every dependency injected.
//
// Authentication is the same `ldg_` key the hosted MCP endpoint takes, resolved
// by @ledgeur/mcp into an RLS session for the key's owner. Meeting reads go
// through that session, so row-level security, not this file, decides what a
// key can see. The only service-role use here is the webhook tables, which have
// no policies; every query on them is scoped to the key's owner.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WEBHOOK_EVENTS, nonCanonicalNumericHost, countWords, decodeCursor, encodeCursor, toApiActionItems, toApiMeeting,
  toApiMetadata, toApiNotes, toApiParticipant, toApiSummary, toApiTranscript, webhookUrlError,
  type ApiMeetingRow, type ApiSegmentRow, type ApiSpeakerRow, type ApiWebhook, type WebhookEventType,
} from "@ledgeur/core";
import { bearerFrom, type McpAuthError, type Authenticated } from "@ledgeur/mcp/auth";
import { ApiError, badRequest, errorResponse, isIsoDate, isUuid, json, notFound } from "./http.ts";

export interface ApiDeps {
  /** Resolve a presented key. Throws McpAuthError. */
  authenticate(token: string): Promise<Authenticated>;
  /** Called with errors that are our fault (5xx), for Sentry. */
  report?(e: unknown, scope: string): void;
  randomId?(): string;
  now?(): Date;
}

const MEETING_COLS = "id,title,status,started_at,ended_at,lang,updated_at,deleted_at";
const PAID = ["team", "company"];
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_SEGMENTS = 20_000;
const MAX_WEBHOOKS_PER_USER = 20;
const PAGE = 1000; // PostgREST's default row cap

type Row = Record<string, unknown>;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

/** Page through a query that could exceed PostgREST's 1000-row cap. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = must(await build(from, from + PAGE - 1), what) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

interface PaidOrg { org_id: string; orgs: { plan: string; default_meeting_visibility: string } | { plan: string; default_meeting_visibility: string }[] }

/** Workspaces the key's owner belongs to that are on a paid plan. */
async function paidOrgs(db: SupabaseClient, userId: string) {
  const rows = must(
    await db.from("org_members").select("org_id, orgs!inner(plan, default_meeting_visibility)").eq("user_id", userId),
    "org_members",
  ) as unknown as PaidOrg[];
  return rows
    .map((r) => ({ org_id: r.org_id, org: Array.isArray(r.orgs) ? r.orgs[0] : r.orgs }))
    .filter((r) => r.org && PAID.includes(r.org.plan));
}

export async function handleApi(req: Request, path: string[], deps: ApiDeps): Promise<Response> {
  try {
    const token = bearerFrom(req.headers.get("authorization"));
    if (!token) throw new ApiError(401, "unauthorized", "Send your Ledgeur API key as an Authorization: Bearer header. Generate one under Account, Agent access.");

    let auth: Authenticated;
    try {
      auth = await deps.authenticate(token);
    } catch (e) {
      // By name rather than instanceof: the class can be loaded twice when a
      // bundler or test runner resolves the workspace package through two paths.
      if (e instanceof Error && e.name === "McpAuthError") {
        const authErr = e as McpAuthError;
        if (authErr.status >= 500) { deps.report?.(e, "api.v1.auth"); throw new ApiError(500, "internal", "Could not check the API key."); }
        throw new ApiError(401, "unauthorized", authErr.message);
      }
      throw e;
    }

    // Unknown routes answer 404 after auth, so the surface is not probeable.
    const route = matchRoute(req.method, path);
    if (!route) throw new ApiError(404, "not_found", "No such endpoint.");

    // The whole API is part of the paid tier, like sync and the MCP endpoint.
    const paid = await paidOrgs(auth.client, auth.userId);
    if (paid.length === 0) throw new ApiError(402, "plan_required", "The Meetings API is part of the paid plans. Upgrade to use it.");

    return await route(req, { auth, paid, deps });
  } catch (e) {
    if (e instanceof ApiError) return errorResponse(e);
    deps.report?.(e, "api.v1");
    return errorResponse(new ApiError(500, "internal", "Something went wrong on our side."));
  }
}

interface Ctx { auth: Authenticated; paid: Awaited<ReturnType<typeof paidOrgs>>; deps: ApiDeps }
type Handler = (req: Request, ctx: Ctx) => Promise<Response>;

function matchRoute(method: string, p: string[]): Handler | null {
  const [a, b, c] = p;
  const isGet = method === "GET";
  if (a === "meetings") {
    if (p.length === 1) {
      if (isGet) return listMeetings;
      if (method === "POST") return createMeeting;
      throw new ApiError(405, "bad_request", "Method not allowed.");
    }
    if (!isGet) return null;
    if (p.length === 2) return (r, x) => getMeeting(b, x);
    if (p.length === 3 && c === "transcript") return (r, x) => getTranscript(b, x);
    if (p.length === 3 && c === "participants") return (r, x) => getParticipants(b, x);
    if (p.length === 3 && c === "metadata") return (r, x) => getMetadata(b, x);
    return null;
  }
  if (a === "webhooks") {
    if (p.length === 1 && isGet) return listWebhooks;
    if (p.length === 1 && method === "POST") return createWebhook;
    if (p.length === 2 && method === "DELETE") return (r, x) => deleteWebhook(b, x);
    return null;
  }
  return null;
}

// --- meetings: reads ------------------------------------------------------

const listMeetings: Handler = async (req, { auth }) => {
  const q = new URL(req.url).searchParams;

  let limit = 50;
  if (q.has("limit")) {
    const n = Number(q.get("limit"));
    if (!Number.isInteger(n) || n < 1 || n > 100) throw badRequest("limit must be a whole number from 1 to 100.");
    limit = n;
  }
  const since = q.get("updated_since");
  if (since !== null && !isIsoDate(since)) throw badRequest("updated_since must be an ISO 8601 timestamp.");

  let includeDeleted = since !== null;
  let after: { u: string; i: string } | null = since ? { u: new Date(since).toISOString(), i: "00000000-0000-0000-0000-000000000000" } : null;
  // `updated_since` is exclusive of the instant itself, so a poller that stores
  // the last updated_at it saw does not receive that meeting again.
  let sinceExclusive = since !== null;
  const rawCursor = q.get("cursor");
  if (rawCursor) {
    const c = decodeCursor(rawCursor);
    if (!c) throw badRequest("cursor is not valid.");
    includeDeleted = c.d;
    after = { u: c.u, i: c.i };
    sinceExclusive = false;
  }

  let query = auth.client.from("meetings").select(MEETING_COLS);
  if (!includeDeleted) query = query.is("deleted_at", null);
  if (after) {
    query = sinceExclusive
      ? query.gt("updated_at", after.u)
      : query.or(`updated_at.gt."${after.u}",and(updated_at.eq."${after.u}",id.gt.${after.i})`);
  }
  const rows = must(
    await query.order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(limit + 1),
    "meetings",
  ) as unknown as ApiMeetingRow[];

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return json({
    data: page.map(toApiSummary),
    next_cursor: rows.length > limit && last ? encodeCursor({ u: last.updated_at, i: last.id, d: includeDeleted }) : null,
  });
};

async function loadMeeting(id: string, { auth }: Ctx): Promise<ApiMeetingRow> {
  if (!isUuid(id)) throw notFound("That meeting");
  const m = must(
    await auth.client.from("meetings").select(MEETING_COLS).eq("id", id).is("deleted_at", null).maybeSingle(),
    "meeting",
  ) as unknown as ApiMeetingRow | null;
  if (!m) throw notFound("That meeting");
  return m;
}

const SPEAKER_COLS = "id,label,identified_name,identity_confidence";

async function getMeeting(id: string, ctx: Ctx) {
  const m = await loadMeeting(id, ctx);
  const db = ctx.auth.client;
  const [notes, items, speakers] = await Promise.all([
    db.from("meeting_notes").select("summary,decisions,questions,markdown,word_count").eq("meeting_id", id).maybeSingle(),
    db.from("action_items").select("id,title,status,due_date,assignee:profiles!assignee_id(full_name,email)").eq("meeting_id", id).order("created_at", { ascending: true }),
    db.from("speakers").select(SPEAKER_COLS).eq("meeting_id", id).order("created_at", { ascending: true }),
  ]);
  return json(toApiMeeting(
    m,
    toApiNotes(must(notes, "notes") as never),
    toApiActionItems((must(items, "action_items") ?? []) as never),
    ((must(speakers, "speakers") ?? []) as unknown as ApiSpeakerRow[]).map(toApiParticipant),
  ));
}

async function getTranscript(id: string, ctx: Ctx) {
  await loadMeeting(id, ctx);
  const db = ctx.auth.client;
  const segments = await fetchAll<ApiSegmentRow>(
    (from, to) => db.from("transcript_segments").select("id,speaker_id,start_ms,end_ms,text,confidence").eq("meeting_id", id)
      .order("start_ms", { ascending: true }).order("id", { ascending: true }).range(from, to) as never,
    "transcript_segments",
  );
  const speakers = must(await db.from("speakers").select(SPEAKER_COLS).eq("meeting_id", id), "speakers") as unknown as ApiSpeakerRow[];
  return json(toApiTranscript(id, segments, speakers ?? []));
}

async function getParticipants(id: string, ctx: Ctx) {
  await loadMeeting(id, ctx);
  const speakers = must(
    await ctx.auth.client.from("speakers").select(SPEAKER_COLS).eq("meeting_id", id).order("created_at", { ascending: true }),
    "speakers",
  ) as unknown as ApiSpeakerRow[];
  return json({ data: (speakers ?? []).map(toApiParticipant) });
}

async function getMetadata(id: string, ctx: Ctx) {
  const m = await loadMeeting(id, ctx);
  const db = ctx.auth.client;
  const full = must(await db.from("meetings").select("calendar_event_id").eq("id", id).maybeSingle(), "meeting") as { calendar_event_id: string | null } | null;
  const [note, speakers, cal] = await Promise.all([
    db.from("meeting_notes").select("word_count").eq("meeting_id", id).maybeSingle(),
    db.from("speakers").select("id", { count: "exact", head: true }).eq("meeting_id", id),
    full?.calendar_event_id
      ? db.from("calendar_events").select("title,starts_at,ends_at").eq("id", full.calendar_event_id).limit(1)
      : Promise.resolve({ data: null, error: null }),
  ]);
  const wc = (must(note, "notes") as { word_count: number } | null)?.word_count;
  const ev = ((must(cal as never, "calendar") ?? []) as { title: string; starts_at: string; ends_at: string }[])[0] ?? null;
  return json(toApiMetadata(m, wc ?? null, (speakers as { count: number | null }).count ?? 0, ev));
}

// --- meetings: import -----------------------------------------------------

async function readJson(req: Request): Promise<Row> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw badRequest("The request body is too large (10 MB maximum).");
  let text: string;
  try { text = await req.text(); } catch { throw badRequest("Could not read the request body."); }
  if (text.length > MAX_BODY_BYTES) throw badRequest("The request body is too large (10 MB maximum).");
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw badRequest("The request body must be JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("The request body must be a JSON object.");
  return body as Row;
}

interface ParsedSegment { speaker: string; start_ms: number; end_ms: number; text: string }

/** Validate the import body. Exported for tests. */
export function parseCreateMeeting(body: Row, now = new Date()) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) throw badRequest("title is required.");
  if (title.length > 500) throw badRequest("title is too long (500 characters maximum).");

  if (!Array.isArray(body.segments) || body.segments.length === 0) throw badRequest("segments must be an array with at least one segment.");
  if (body.segments.length > MAX_SEGMENTS) throw badRequest(`segments is too long (${MAX_SEGMENTS} maximum).`);
  const segments: ParsedSegment[] = body.segments.map((s: unknown, i: number) => {
    const g = s as Row;
    if (!g || typeof g !== "object") throw badRequest(`segments[${i}] must be an object.`);
    if (typeof g.speaker !== "string" || !g.speaker.trim()) throw badRequest(`segments[${i}].speaker must be a non-empty string.`);
    if (!Number.isInteger(g.start_ms) || (g.start_ms as number) < 0) throw badRequest(`segments[${i}].start_ms must be a whole number of milliseconds, 0 or more.`);
    if (!Number.isInteger(g.end_ms) || (g.end_ms as number) < (g.start_ms as number)) throw badRequest(`segments[${i}].end_ms must be a whole number, not before start_ms.`);
    if (typeof g.text !== "string" || !g.text.trim()) throw badRequest(`segments[${i}].text must be a non-empty string.`);
    return { speaker: g.speaker.trim(), start_ms: g.start_ms as number, end_ms: g.end_ms as number, text: g.text };
  });

  for (const k of ["started_at", "ended_at"] as const) {
    if (body[k] !== undefined && body[k] !== null && !isIsoDate(body[k])) throw badRequest(`${k} must be an ISO 8601 timestamp.`);
  }
  if (body.lang !== undefined && (typeof body.lang !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(body.lang))) throw badRequest("lang must be a language code such as en or en-GB.");
  if (body.notes_markdown !== undefined && body.notes_markdown !== null && typeof body.notes_markdown !== "string") throw badRequest("notes_markdown must be a string.");

  const startedAt = (body.started_at as string | undefined | null) ? new Date(body.started_at as string).toISOString() : null;
  let endedAt = (body.ended_at as string | undefined | null) ? new Date(body.ended_at as string).toISOString() : null;
  if (startedAt && !endedAt) endedAt = new Date(Date.parse(startedAt) + Math.max(...segments.map((s) => s.end_ms))).toISOString();
  if (startedAt && endedAt && Date.parse(endedAt) < Date.parse(startedAt)) throw badRequest("ended_at must not be before started_at.");

  return {
    title, segments, startedAt, endedAt,
    lang: (body.lang as string | undefined) ?? "en",
    notesMarkdown: ((body.notes_markdown as string | undefined | null) ?? "").trim(),
    nowIso: now.toISOString(),
  };
}

const createMeeting: Handler = async (req, { auth, paid, deps }) => {
  const input = parseCreateMeeting(await readJson(req), deps.now?.());
  // The key's own workspace when it is paid, otherwise any paid one: the RLS
  // insert policy wants the meeting's workspace to be on a paid plan.
  const target = paid.find((p) => p.org_id === auth.orgId) ?? paid[0];
  const db = auth.client;
  const uuid = deps.randomId ?? (() => crypto.randomUUID());
  const meetingId = uuid();

  const labels = [...new Set(input.segments.map((s) => s.speaker))];
  const speakerIds = new Map(labels.map((l) => [l, uuid()]));

  const ins = await db.from("meetings").insert({
    id: meetingId, org_id: target.org_id, owner_id: auth.userId, title: input.title, status: "complete",
    visibility: target.org.default_meeting_visibility, started_at: input.startedAt, ended_at: input.endedAt,
    lang: input.lang, created_at: input.nowIso, updated_at: input.nowIso,
  });
  if (ins.error) throw new Error(`meetings insert: ${ins.error.message}`);

  try {
    must(await db.from("speakers").insert(labels.map((label) => ({ id: speakerIds.get(label), meeting_id: meetingId, label }))), "speakers insert");
    for (let i = 0; i < input.segments.length; i += 500) {
      const chunk = input.segments.slice(i, i + 500).map((s) => ({
        id: uuid(), meeting_id: meetingId, speaker_id: speakerIds.get(s.speaker), start_ms: s.start_ms, end_ms: s.end_ms, text: s.text,
      }));
      must(await db.from("transcript_segments").insert(chunk), "segments insert");
    }
    must(await db.from("meeting_notes").insert({
      meeting_id: meetingId, markdown: input.notesMarkdown, generator: "api-import",
      word_count: countWords(input.segments.map((s) => s.text)), updated_at: input.nowIso,
    }), "notes insert");
  } catch (e) {
    // Not atomic over REST, so a half-imported meeting is removed rather than
    // left to appear in the owner's library. Children cascade.
    await db.from("meetings").delete().eq("id", meetingId);
    throw e;
  }
  return json(await getMeeting(meetingId, { auth, paid, deps }).then((r) => r.json()), 201);
};

// --- webhooks -------------------------------------------------------------

function toApiWebhook(r: Row): ApiWebhook {
  return {
    id: r.id as string,
    url: r.url as string,
    events: r.events as WebhookEventType[],
    created_at: new Date(r.created_at as string).toISOString(),
    last_delivery_at: r.last_delivery_at ? new Date(r.last_delivery_at as string).toISOString() : null,
    last_status: (r.last_status as ApiWebhook["last_status"]) ?? null,
    last_status_code: (r.last_status_code as number | null) ?? null,
  };
}

function newSecret(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `whsec_${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

const createWebhook: Handler = async (req, { auth }) => {
  const body = await readJson(req);
  if (typeof body.url !== "string" || !body.url) throw badRequest("url is required.");
  const urlProblem = webhookUrlError(body.url);
  if (urlProblem) throw badRequest(urlProblem);
  if (nonCanonicalNumericHost(body.url)) throw badRequest("Write the address in its usual form, for example 203.0.113.7, or use a hostname.");
  if (new URL(body.url).username || new URL(body.url).password) throw badRequest("url must not contain credentials.");
  if (!Array.isArray(body.events) || body.events.length === 0) throw badRequest(`events is required: one or more of ${WEBHOOK_EVENTS.join(", ")}.`);
  const bad = body.events.find((e: unknown) => !(WEBHOOK_EVENTS as readonly unknown[]).includes(e));
  if (bad !== undefined) throw badRequest(`Unknown event ${JSON.stringify(bad)}. Use ${WEBHOOK_EVENTS.join(", ")}.`);
  const events = [...new Set(body.events as WebhookEventType[])];

  const { count } = await auth.admin.from("webhook_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", auth.userId);
  if ((count ?? 0) >= MAX_WEBHOOKS_PER_USER) throw badRequest(`You can have at most ${MAX_WEBHOOKS_PER_USER} webhooks. Delete one first.`);

  const secret = newSecret();
  const row = must(
    await auth.admin.from("webhook_subscriptions").insert({ user_id: auth.userId, url: body.url, events, secret }).select("id,url,events,created_at").single(),
    "webhook insert",
  ) as Row;
  const w = toApiWebhook(row);
  return json({ id: w.id, url: w.url, events: w.events, created_at: w.created_at, secret }, 201);
};

const listWebhooks: Handler = async (_req, { auth }) => {
  const rows = must(
    await auth.admin.from("webhook_subscriptions")
      .select("id,url,events,created_at,last_delivery_at,last_status,last_status_code")
      .eq("user_id", auth.userId).order("created_at", { ascending: true }),
    "webhooks",
  ) as Row[];
  return json({ data: (rows ?? []).map(toApiWebhook) });
};

async function deleteWebhook(id: string, { auth }: Ctx) {
  if (!isUuid(id)) throw notFound("That webhook");
  const rows = must(
    await auth.admin.from("webhook_subscriptions").delete().eq("id", id).eq("user_id", auth.userId).select("id"),
    "webhook delete",
  ) as Row[];
  if (!rows || rows.length === 0) throw notFound("That webhook");
  return new Response(null, { status: 204 });
}
