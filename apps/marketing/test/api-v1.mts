/* eslint-disable @typescript-eslint/no-explicit-any -- loose fakes standing in for supabase-js */
// The public Meetings API (app/api/v1) and the webhook dispatcher, against a
// fake Supabase. Shapes, auth failures, the plan gate, validation and delivery.
import { McpAuthError } from "@ledgeur/mcp/auth";
import type { Authenticated } from "@ledgeur/mcp/auth";
import { checkWebhookSignature } from "@ledgeur/core";
import { handleApi, parseCreateMeeting } from "../lib/api-v1/handlers.ts";
import { runDispatch, safeAddress, type SendFn } from "../lib/webhooks/dispatch.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;
type Op = { fn: string; args: unknown[] };
type Result = { data?: unknown; error?: { message: string } | null; count?: number | null };

/** A chainable stand-in for a supabase-js query. Every call is recorded; the
 *  handler decides what the table answers. */
function fakeDb(answer: (table: string, ops: Op[]) => Result, log: { table: string; ops: Op[] }[] = []) {
  const from = (table: string) => {
    const ops: Op[] = [];
    const q: Record<string, unknown> = {};
    for (const fn of ["select", "eq", "neq", "is", "gt", "lt", "or", "in", "contains", "order", "limit", "range", "insert", "update", "upsert", "delete"]) {
      q[fn] = (...args: unknown[]) => { ops.push({ fn, args }); return q; };
    }
    q.maybeSingle = () => { ops.push({ fn: "maybeSingle", args: [] }); return done(); };
    q.single = () => { ops.push({ fn: "single", args: [] }); return done(); };
    const done = () => { log.push({ table, ops }); const r = answer(table, ops); return Promise.resolve({ data: null, error: null, count: null, ...r }); };
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => done().then(res, rej);
    return q;
  };
  return { from, rpc: (name: string, args: unknown) => { const r = answer(`rpc:${name}`, [{ fn: "rpc", args: [args] }]); return Promise.resolve({ data: null, error: null, ...r }); } } as never;
}

const UID = "11111111-1111-4111-8111-111111111111";
const MID = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const KEY = "ldg_" + "a".repeat(64);
const meetingRow = (over: Record<string, unknown> = {}) => ({
  id: MID, title: "Annual review", status: "complete", started_at: "2026-03-01T10:00:00+00:00",
  ended_at: "2026-03-01T11:00:00+00:00", lang: "en", updated_at: "2026-03-01T11:05:00.5+00:00", deleted_at: null, ...over,
});
const paidMembership = [{ org_id: ORG, orgs: { plan: "team", default_meeting_visibility: "private" } }];

function api(userAnswer: (t: string, ops: Op[]) => Result, adminAnswer: (t: string, ops: Op[]) => Result = () => ({ data: [] }), opts: { auth?: () => Promise<Authenticated> } = {}) {
  const userLog: { table: string; ops: Op[] }[] = [];
  const adminLog: { table: string; ops: Op[] }[] = [];
  const authed: Authenticated = { client: fakeDb(userAnswer, userLog), admin: fakeDb(adminAnswer, adminLog), userId: UID, orgId: ORG };
  const ids = (function* () { let n = 0; while (true) yield `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })();
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = { Authorization: `Bearer ${KEY}` }) => {
    const u = new URL(`https://www.ledgeur.com/api/v1${path}`);
    return handleApi(
      new Request(u, { method, headers: { ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }),
      u.pathname.replace("/api/v1/", "").split("/").filter(Boolean),
      { authenticate: opts.auth ?? (async () => authed), randomId: () => ids.next().value as string },
    );
  };
  return { call, userLog, adminLog };
}
const paidUser = (t: string, ops: Op[]): Result => (t === "org_members" ? { data: paidMembership } : { data: [], ...({} as object) });
const errOf = async (r: Response) => ((await r.json()) as { error: { code: string; message: string } }).error;

export async function runApiV1Tests(ok: Ok) {
  // --- auth and plan gate
  {
    const { call } = api(paidUser);
    const r = await call("GET", "/meetings", undefined, {});
    const e = await errOf(r);
    ok("no key: 401 with the error envelope and a WWW-Authenticate header", r.status === 401 && e.code === "unauthorized" && !!e.message && r.headers.get("www-authenticate")!.startsWith("Bearer"));
    ok("responses are JSON and uncached", r.headers.get("content-type")!.includes("application/json") && r.headers.get("cache-control") === "no-store");
  }
  {
    const { call } = api(paidUser, undefined, { auth: async () => { throw new McpAuthError("That access token is not valid.", 401); } });
    const r = await call("GET", "/meetings");
    ok("invalid key: 401 unauthorized", r.status === 401 && (await errOf(r)).code === "unauthorized");
  }
  {
    const { call } = api(paidUser, undefined, { auth: async () => { throw new McpAuthError("boom", 500); } });
    const r = await call("GET", "/meetings");
    ok("auth infrastructure failure is a 500, not a 401", r.status === 500 && (await errOf(r)).code === "internal");
  }
  {
    const { call } = api((t) => (t === "org_members" ? { data: [{ org_id: ORG, orgs: { plan: "free", default_meeting_visibility: "private" } }] } : { data: [] }));
    const r = await call("GET", "/meetings");
    const e = await errOf(r);
    ok("free plan: 402 plan_required", r.status === 402 && e.code === "plan_required");
    const w = await call("POST", "/webhooks", { url: "https://x.example.com", events: ["meeting.completed"] });
    ok("free plan cannot create webhooks or import either", w.status === 402 && (await call("POST", "/meetings", {})).status === 402);
  }
  {
    const { call } = api(paidUser);
    ok("unknown endpoint: 404 not_found", (await call("GET", "/nothing")).status === 404 && (await call("DELETE", "/meetings/x")).status === 404);
  }

  // --- GET /meetings
  {
    const rows = [meetingRow({ id: "a1", updated_at: "2026-03-01T10:00:00+00:00" }), meetingRow({ id: "a2", updated_at: "2026-03-01T10:01:00+00:00" }), meetingRow({ id: "a3", updated_at: "2026-03-01T10:02:00+00:00", deleted_at: "2026-03-01T10:02:00+00:00" })];
    const { call, userLog } = api((t) => (t === "org_members" ? { data: paidMembership } : t === "meetings" ? { data: rows } : { data: [] }));
    const r = await call("GET", "/meetings?limit=2&updated_since=2026-01-01T00:00:00Z");
    const b = (await r.json()) as { data: { id: string; url: string; deleted_at: string | null }[]; next_cursor: string | null };
    ok("list: 200, a page of summaries and a cursor when there is more", r.status === 200 && b.data.length === 2 && b.data[0].id === "a1" && typeof b.next_cursor === "string" && b.data[0].url.endsWith("/app/meetings/a1"));
    const ops = userLog.find((l) => l.table === "meetings")!.ops;
    ok("list: orders by updated_at then id, asks for limit+1, includes deleted when updated_since is given",
      ops.some((o) => o.fn === "order" && o.args[0] === "updated_at") && ops.some((o) => o.fn === "limit" && o.args[0] === 3) && !ops.some((o) => o.fn === "is") && ops.some((o) => o.fn === "gt"));
    const r2 = await call("GET", `/meetings?cursor=${b.next_cursor}`);
    ok("list: a cursor continues with the same visibility rule and the keyset filter", r2.status === 200 && userLog.filter((l) => l.table === "meetings")[1].ops.some((o) => o.fn === "or" && String(o.args[0]).includes("a2")));
    const plain = api((t) => (t === "org_members" ? { data: paidMembership } : { data: [] }));
    await plain.call("GET", "/meetings");
    ok("list: without updated_since soft-deleted meetings are hidden", plain.userLog.find((l) => l.table === "meetings")!.ops.some((o) => o.fn === "is" && o.args[0] === "deleted_at"));
    const last = await plain.call("GET", "/meetings");
    ok("list: next_cursor is null on the last page", ((await last.json()) as { next_cursor: unknown }).next_cursor === null);
    for (const bad of ["limit=0", "limit=101", "limit=x", "updated_since=yesterday", "cursor=%25%25"]) {
      const x = await plain.call("GET", `/meetings?${bad}`);
      ok(`list: ${bad} is a 400 bad_request`, x.status === 400 && (await errOf(x)).code === "bad_request");
    }
  }

  // --- GET /meetings/{id} and friends
  {
    const answer = (t: string): Result => {
      switch (t) {
        case "org_members": return { data: paidMembership };
        case "meetings": return { data: { ...meetingRow(), calendar_event_id: "ev1" } };
        case "meeting_notes": return { data: { summary: ["Agreed fees"], decisions: ["Move to ISA"], questions: [], markdown: "# Notes", word_count: 120 } };
        case "action_items": return { data: [{ id: "i1", title: "Send letter", status: "open", due_date: "2026-03-08", assignee: { full_name: "Ann Adviser", email: "a@x.co" } }] };
        case "speakers": return { data: [{ id: "s1", label: "Speaker 1", identified_name: "Ann Adviser", identity_confidence: 0.91 }, { id: "s2", label: "Speaker 2", identified_name: null, identity_confidence: null }], count: 2 };
        case "transcript_segments": return { data: [{ id: "g1", speaker_id: "s1", start_ms: 0, end_ms: 1000, text: "Welcome", confidence: 0.99 }] };
        case "calendar_events": return { data: [{ title: "Review", starts_at: "2026-03-01T10:00:00+00:00", ends_at: "2026-03-01T11:00:00+00:00" }] };
        default: return { data: [] };
      }
    };
    const { call } = api(answer);
    const r = await call("GET", `/meetings/${MID}`);
    const m = (await r.json()) as Record<string, any>;
    ok("meeting: summary fields plus notes, action_items, participants",
      r.status === 200 && m.id === MID && m.duration_ms === 3_600_000 && m.notes.summary[0] === "Agreed fees" && m.notes.markdown === "# Notes"
      && m.action_items[0].owner === "Ann Adviser" && m.action_items[0].done === false && m.participants[0].name === "Ann Adviser" && m.participants[1].name === null, JSON.stringify(m));
    const t = (await (await call("GET", `/meetings/${MID}/transcript`)).json()) as Record<string, any>;
    ok("transcript: segments with speaker names and the joined text", t.meeting_id === MID && t.segments[0].speaker === "Ann Adviser" && t.text === "Ann Adviser: Welcome");
    const p = (await (await call("GET", `/meetings/${MID}/participants`)).json()) as { data: unknown[] };
    ok("participants: wrapped in data", p.data.length === 2);
    const md = (await (await call("GET", `/meetings/${MID}/metadata`)).json()) as Record<string, any>;
    ok("metadata: word_count, speaker_count and the calendar event",
      md.word_count === 120 && md.speaker_count === 2 && md.calendar_event.title === "Review" && md.calendar_event.starts_at === "2026-03-01T10:00:00.000Z" && !("notes" in md));
  }
  {
    const { call } = api((t) => (t === "org_members" ? { data: paidMembership } : { data: null }));
    const r = await call("GET", `/meetings/${MID}`);
    ok("a meeting the key cannot see (RLS returns nothing) is 404 not_found", r.status === 404 && (await errOf(r)).code === "not_found");
    ok("a malformed id is 404, not a database error", (await call("GET", "/meetings/not-a-uuid/transcript")).status === 404);
  }

  // --- POST /meetings
  {
    const good = { title: "Imported call", started_at: "2026-02-01T09:00:00Z", lang: "en-GB", notes_markdown: "# Notes", segments: [{ speaker: "Ann", start_ms: 0, end_ms: 4000, text: "Hello there" }, { speaker: "Bob", start_ms: 4000, end_ms: 9000, text: "Hi Ann" }, { speaker: "Ann", start_ms: 9000, end_ms: 9500, text: "Right" }] };
    const parsed = parseCreateMeeting(good);
    ok("import: ended_at defaults to start plus the last segment", parsed.endedAt === "2026-02-01T09:00:09.500Z" && parsed.lang === "en-GB");
    const { call, userLog } = api((t, ops) => {
      if (t === "org_members") return { data: paidMembership };
      if (t === "meetings" && ops.some((o) => o.fn === "insert")) return { data: null };
      if (t === "meetings") return { data: meetingRow({ id: "00000000-0000-4000-8000-000000000001", title: "Imported call" }) };
      return { data: [] };
    });
    const r = await call("POST", "/meetings", good);
    const m = (await r.json()) as Record<string, any>;
    ok("import: 201 and a Meeting", r.status === 201 && m.title === "Imported call" && Array.isArray(m.participants));
    const ins = (t: string) => userLog.filter((l) => l.table === t && l.ops.some((o) => o.fn === "insert")).map((l) => l.ops.find((o) => o.fn === "insert")!.args[0] as any);
    const mi = ins("meetings")[0];
    ok("import: a complete meeting owned by the key's user in a paid workspace", mi.status === "complete" && mi.owner_id === UID && mi.org_id === ORG);
    ok("import: one speaker per distinct label, segments linked to them", ins("speakers")[0].length === 2 && ins("transcript_segments")[0].length === 3
      && ins("transcript_segments")[0][0].speaker_id === ins("transcript_segments")[0][2].speaker_id && ins("transcript_segments")[0][0].speaker_id !== ins("transcript_segments")[0][1].speaker_id);
    ok("import: notes row carries the markdown and a word count", ins("meeting_notes")[0].markdown === "# Notes" && ins("meeting_notes")[0].word_count === 5);

    const bad: [string, unknown][] = [
      ["a missing title", { ...good, title: " " }], ["no segments", { ...good, segments: [] }], ["segments not an array", { ...good, segments: "x" }],
      ["a segment with no speaker", { ...good, segments: [{ start_ms: 0, end_ms: 1, text: "a" }] }],
      ["end before start", { ...good, segments: [{ speaker: "A", start_ms: 5, end_ms: 1, text: "a" }] }],
      ["fractional ms", { ...good, segments: [{ speaker: "A", start_ms: 0.5, end_ms: 1, text: "a" }] }],
      ["empty text", { ...good, segments: [{ speaker: "A", start_ms: 0, end_ms: 1, text: "" }] }],
      ["a bad date", { ...good, started_at: "soon" }], ["end before start date", { ...good, started_at: "2026-02-02T00:00:00Z", ended_at: "2026-02-01T00:00:00Z" }],
      ["a bad lang", { ...good, lang: "english please" }], ["notes_markdown not a string", { ...good, notes_markdown: 4 }],
    ];
    for (const [name, body] of bad) {
      const x = await call("POST", "/meetings", body);
      ok(`import: ${name} is a 400`, x.status === 400 && (await errOf(x)).code === "bad_request");
    }
    ok("import: a non-JSON body is a 400", (await call("POST", "/meetings", "{nope")).status === 400);
  }
  {
    // A failure part-way removes the half-imported meeting.
    const { call, userLog } = api((t, ops) => {
      if (t === "org_members") return { data: paidMembership };
      if (t === "transcript_segments") return { error: { message: "rls" } };
      return { data: null };
    });
    const r = await call("POST", "/meetings", { title: "x", segments: [{ speaker: "A", start_ms: 0, end_ms: 1, text: "a" }] });
    ok("import: a failure part-way is a 500 and the partial meeting is deleted", r.status === 500 && userLog.some((l) => l.table === "meetings" && l.ops.some((o) => o.fn === "delete")));
  }

  // --- webhooks
  {
    const { call, adminLog } = api(paidUser, (t, ops) => {
      if (ops.some((o) => o.fn === "delete")) return { data: [{ id: "x" }] };
      if (ops.some((o) => o.fn === "insert")) return { data: { id: "w1", url: "https://hooks.example.com/l", events: ["meeting.completed", "meeting.deleted"], created_at: "2026-03-01T12:00:00+00:00" } };
      if (ops.some((o) => o.fn === "select" && (o.args[1] as { head?: boolean } | undefined)?.head)) return { count: 0 };
      return { data: [{ id: "w1", url: "https://hooks.example.com/l", events: ["meeting.completed"], created_at: "2026-03-01T12:00:00+00:00", last_delivery_at: null, last_status: null, last_status_code: null }] };
    });
    const r = await call("POST", "/webhooks", { url: "https://hooks.example.com/l", events: ["meeting.completed", "meeting.deleted", "meeting.deleted"] });
    const w = (await r.json()) as Record<string, any>;
    ok("webhook create: 201 with id, url, events, created_at and a whsec_ secret", r.status === 201 && w.id === "w1" && /^whsec_[0-9a-f]{64}$/.test(w.secret) && w.events.length === 2);
    const stored = adminLog.flatMap((l) => l.ops).find((o) => o.fn === "insert")!.args[0] as any;
    ok("webhook create: stored for the key's user, secret kept for signing, events deduplicated", stored.user_id === UID && stored.secret === w.secret && stored.events.length === 2);
    const list = (await (await call("GET", "/webhooks")).json()) as { data: Record<string, unknown>[] };
    ok("webhook list: never includes the secret", list.data.length === 1 && !("secret" in list.data[0]) && "last_status" in list.data[0] && "last_delivery_at" in list.data[0]);
    ok("webhook list is scoped to the key's user", adminLog.some((l) => l.ops.some((o) => o.fn === "eq" && o.args[0] === "user_id" && o.args[1] === UID)));
    const d = await call("DELETE", "/webhooks/44444444-4444-4444-8444-444444444444");
    ok("webhook delete: 204 with no body", d.status === 204 && (await d.text()) === "");
    ok("webhook delete is scoped to the key's user", adminLog.some((l) => l.ops.some((o) => o.fn === "delete")) && adminLog.filter((l) => l.ops.some((o) => o.fn === "delete"))[0].ops.some((o) => o.fn === "eq" && o.args[0] === "user_id"));
    for (const [name, body] of [["http url", { url: "http://hooks.example.com", events: ["meeting.completed"] }], ["junk url", { url: "nope", events: ["meeting.completed"] }], ["no events", { url: "https://x.example.com", events: [] }], ["unknown event", { url: "https://x.example.com", events: ["meeting.exploded"] }], ["credentials in url", { url: "https://u:p@x.example.com", events: ["meeting.completed"] }]] as [string, unknown][]) {
      const x = await call("POST", "/webhooks", body);
      ok(`webhook create: ${name} is a 400`, x.status === 400 && (await errOf(x)).code === "bad_request");
    }
    ok("webhook create: http://localhost is allowed for development", (await call("POST", "/webhooks", { url: "http://localhost:4000/hook", events: ["meeting.updated"] })).status === 201);
  }
  {
    const { call } = api(paidUser, () => ({ data: [] }));
    const r = await call("DELETE", "/webhooks/44444444-4444-4444-8444-444444444444");
    ok("webhook delete: someone else's or unknown id is 404", r.status === 404 && (await errOf(r)).code === "not_found");
  }

  // --- dispatcher
  await runDispatcherTests(ok);
}

async function runDispatcherTests(ok: Ok) {
  const t0 = Date.parse("2026-03-01T12:00:00Z");
  const state = {
    outbox: [{ meeting_id: MID, kind: "change", due_at: "x", owner_id: UID, org_id: ORG, visibility: "private", snapshot: null }] as any[],
    deliveries: [] as any[], subUpdates: [] as any[], meetingState: {} as any, deliveryUpdates: [] as any[],
  };
  const admin = (() => {
    const from = (table: string) => {
      const ops: Op[] = [];
      const q: any = {};
      for (const fn of ["select", "eq", "neq", "lt", "in", "contains", "insert", "update", "upsert", "delete"]) q[fn] = (...a: unknown[]) => { ops.push({ fn, args: a }); return q; };
      const res = () => {
        const has = (f: string) => ops.find((o) => o.fn === f);
        if (table === "meetings") return { data: { ...meetingRow(), owner_id: UID, org_id: ORG, visibility: "private" } };
        if (table === "webhook_meeting_state") { if (has("upsert")) state.meetingState = has("upsert")!.args[0]; return { data: null }; }
        if (table === "webhook_subscriptions") {
          if (has("update")) { state.subUpdates.push(has("update")!.args[0]); return { data: null }; }
          if (has("contains")) return { data: [{ id: "sub1", user_id: UID, events: ["meeting.completed"] }] };
          return { data: [{ id: "sub1", url: "https://hooks.example.com/ledgeur", secret: "whsec_s" }] };
        }
        if (table === "org_members") return { data: [{ user_id: UID }] };
        if (table === "webhook_deliveries") {
          if (has("insert")) { state.deliveries.push(has("insert")!.args[0]); return { data: null }; }
          if (has("update")) { state.deliveryUpdates.push(has("update")!.args[0]); return { data: null }; }
        }
        return { data: null };
      };
      q.maybeSingle = () => Promise.resolve({ error: null, ...res() });
      q.then = (a: any, b: any) => Promise.resolve({ error: null, ...res() }).then(a, b);
      return q;
    };
    const rpc = (name: string) => {
      if (name === "webhook_claim_outbox") { const rows = state.outbox; state.outbox = []; return Promise.resolve({ data: rows, error: null }); }
      if (name === "webhook_claim_deliveries") {
        return Promise.resolve({ data: state.deliveries.splice(0).map((d) => ({ ...d, attempts: d.attempts ?? 0 })), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    return { from, rpc } as never;
  })();

  const sent: { url: string; headers: Record<string, string>; body: string; address: string }[] = [];
  let status = 200;
  const sendFake: SendFn = async (r) => { sent.push(r); return { status }; };
  let resolved = [{ address: "93.184.216.34" }];
  const lookup = async () => resolved;
  const fetchFake = { send: sendFake, lookup };

  const run1 = await runDispatch({ admin, ...fetchFake, now: () => t0 });
  ok("dispatch: a due outbox row for a complete meeting becomes a meeting.completed delivery", run1.events === 1 && run1.deliveries_created === 1);
  ok("dispatch: completion is recorded so it fires once", !!state.meetingState.completed_at);
  // The fake returns deliveries claimed in the same run, so the first run both created and sent.
  ok("dispatch: the delivery went to the subscription's url, pinned to the address we checked", sent.length === 1 && sent[0].url === "https://hooks.example.com/ledgeur" && sent[0].address === "93.184.216.34", JSON.stringify(run1));
  const d = sent[0];
  const payload = JSON.parse(d.body);
  ok("delivery: body is { id, type, created_at, data: { meeting_id, meeting } }", payload.type === "meeting.completed" && payload.data.meeting_id === MID && payload.data.meeting.id === MID && payload.id === d.headers["X-Ledgeur-Delivery"]);
  ok("delivery: headers include content type, event, delivery id, timestamp, signature",
    d.headers["Content-Type"] === "application/json" && d.headers["X-Ledgeur-Event"] === "meeting.completed" && !!d.headers["X-Ledgeur-Timestamp"] && d.headers["X-Ledgeur-Signature"].startsWith("sha256="));
  ok("delivery: the signature verifies with the subscription secret (shared scheme)",
    (await checkWebhookSignature("whsec_s", d.headers["X-Ledgeur-Timestamp"], d.body, d.headers["X-Ledgeur-Signature"], { now: t0 })) === "ok");
  ok("delivery: success is recorded on the delivery and the subscription",
    state.deliveryUpdates.at(-1).status === "delivered" && state.subUpdates.at(-1).last_status === "delivered" && state.subUpdates.at(-1).last_status_code === 200);

  // Failure and retry schedule.
  const failing = async (attempts: number) => {
    state.deliveries.push({ id: "e1", subscription_id: "sub1", event_type: "meeting.completed", meeting_id: MID, payload: { id: "e1" }, attempts });
    status = 500;
    state.deliveryUpdates.length = 0; state.subUpdates.length = 0;
    const r = await runDispatch({ admin, ...fetchFake, now: () => t0 });
    return { r, upd: state.deliveryUpdates.at(-1), sub: state.subUpdates.at(-1) };
  };
  const f0 = await failing(0);
  ok("retry: the first failure retries in 1 minute", f0.r.retrying === 1 && f0.upd.status === "pending" && f0.upd.attempts === 1 && Date.parse(f0.upd.next_attempt_at) === t0 + 60_000 && f0.sub.last_status === "retrying" && f0.upd.last_status_code === 500);
  const f3 = await failing(3);
  ok("retry: the fourth failure waits 2 hours", Date.parse(f3.upd.next_attempt_at) === t0 + 7_200_000);
  const f5 = await failing(5);
  ok("retry: after the fifth retry it gives up and records failed", f5.r.failed === 1 && f5.upd.status === "failed" && f5.sub.last_status === "failed");

  // SSRF: a name that resolves to a private address is never contacted.
  const sendWith = async (url: string, addrs: { address: string }[] | Error) => {
    sent.length = 0;
    state.deliveries.push({ id: "e2", subscription_id: "sub1", event_type: "meeting.completed", meeting_id: MID, payload: { id: "e2" }, attempts: 0 });
    const origFrom = (admin as any).from;
    const priv: any = { rpc: (admin as any).rpc, from: (t: string) => { const q = origFrom(t); if (t === "webhook_subscriptions") q.then = (a: any, b: any) => Promise.resolve({ data: [{ id: "sub1", url, secret: "s" }], error: null }).then(a, b); return q; } };
    status = 200;
    await runDispatch({ admin: priv, send: sendFake, lookup: async () => { if (addrs instanceof Error) throw addrs; return addrs; }, now: () => t0 });
    return { sent: sent.length, err: state.deliveryUpdates.at(-1).last_error as string | null, code: state.deliveryUpdates.at(-1).last_status_code };
  };
  for (const [name, addrs] of [
    ["a name resolving to a private IPv4", [{ address: "10.0.0.5" }]], ["to loopback", [{ address: "127.0.0.1" }]],
    ["to cloud metadata", [{ address: "169.254.169.254" }]], ["to CGNAT", [{ address: "100.64.1.1" }]],
    ["to a ULA IPv6", [{ address: "fd12:3456::1" }]], ["to an IPv4-mapped IPv6", [{ address: "::ffff:10.0.0.1" }]],
    ["to NAT64", [{ address: "64:ff9b::a00:1" }]], ["with one public and one private record", [{ address: "93.184.216.34" }, { address: "192.168.1.1" }]],
  ] as [string, { address: string }[]][]) {
    const r = await sendWith("https://rebind.example.com/hook", addrs);
    ok(`dispatch: ${name} is refused with no request and a generic reason`, r.sent === 0 && r.err === "target not allowed" && r.code === null, JSON.stringify(r));
  }
  ok("dispatch: a failed DNS lookup is refused", (await sendWith("https://nx.example.com/", new Error("ENOTFOUND"))).sent === 0);
  ok("dispatch: a trailing-dot internal name is refused", (await sendWith("https://metadata.internal./x", [{ address: "93.184.216.34" }])).sent === 0);
  ok("dispatch: a public name still goes out", (await sendWith("https://ok.example.com/hook", [{ address: "93.184.216.34" }, { address: "2606:2800:220:1::1" }])).sent === 1);
  ok("safeAddress: literal public IP passes, literal private blocked, no lookup needed",
    JSON.stringify(await safeAddress("https://93.184.216.34/x", false, async () => { throw new Error("no"); })) === '{"address":"93.184.216.34"}'
    && "blocked" in (await safeAddress("https://[::1]/x", false, async () => [])));
}
