// @ledgeur/sdk tests. Run: pnpm --filter @ledgeur/sdk test
import { Ledgeur, LedgeurError, LedgeurWebhookError, verifyWebhook, type LedgeurEvent, type Meeting, type MeetingSummary, type Webhook } from "../src/index.ts";
// The server signs with this; the SDK must verify what it produces.
import { signWebhook, webhookHeaders } from "../../core/src/notes/webhook.ts";
import type {
  ApiMeeting, ApiMeetingSummary, ApiTranscript, ApiMeetingMetadata, ApiEvent, ApiWebhook,
  ApiCreateMeetingInput, ApiParticipant,
} from "../../core/src/api/contract.ts";
import type { Transcript, MeetingMetadata, CreateMeetingInput, Participant } from "../src/types.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};

// Compile-time: the SDK's types and the server's contract are mutually
// assignable. If either side changes alone, typecheck fails here.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same: [
  Same<Meeting, ApiMeeting>, Same<MeetingSummary, ApiMeetingSummary>, Same<Transcript, ApiTranscript>,
  Same<MeetingMetadata, ApiMeetingMetadata>, Same<LedgeurEvent, ApiEvent>, Same<Webhook, ApiWebhook>,
  Same<CreateMeetingInput, ApiCreateMeetingInput>, Same<Participant, ApiParticipant>,
] = [true, true, true, true, true, true, true, true];
ok("SDK types match the server contract", same.every(Boolean));

interface Call { url: URL; init: RequestInit }
function fakeFetch(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url: new URL(url), init });
    const r = responses.shift();
    if (!r) throw new Error("no response queued");
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { f, calls };
}
const jres = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const summary = (id: string): MeetingSummary => ({
  id, title: id, status: "complete", started_at: null, ended_at: null, duration_ms: null, lang: "en",
  updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null, url: `https://www.ledgeur.com/app/meetings/${id}`,
});

// --- request building -------------------------------------------------------
{
  const { f, calls } = fakeFetch([jres({ data: [], next_cursor: null })]);
  const l = new Ledgeur({ apiKey: "ldg_x", fetch: f });
  await l.listMeetings({ updatedSince: new Date("2026-02-03T04:05:06Z"), limit: 10, cursor: "abc" });
  const c = calls[0];
  ok("lists from the default base url under /api/v1", c.url.origin === "https://www.ledgeur.com" && c.url.pathname === "/api/v1/meetings");
  ok("sends updated_since (ISO), limit and cursor", c.url.searchParams.get("updated_since") === "2026-02-03T04:05:06.000Z" && c.url.searchParams.get("limit") === "10" && c.url.searchParams.get("cursor") === "abc");
  ok("sends the bearer key", (c.init.headers as Record<string, string>).Authorization === "Bearer ldg_x");
  ok("a GET has no body or content-type", c.init.body === undefined && !("Content-Type" in (c.init.headers as object)));
}
{
  const { f, calls } = fakeFetch([jres({ data: [], next_cursor: null })]);
  await new Ledgeur({ apiKey: "k", baseUrl: "http://localhost:3000/", fetch: f }).listMeetings();
  ok("honours baseUrl and drops a trailing slash", calls[0].url.href === "http://localhost:3000/api/v1/meetings");
  ok("omits unset query parameters", calls[0].url.search === "");
}
{
  const { f, calls } = fakeFetch([jres({ id: "a/b" }), jres({ meeting_id: "x", segments: [], text: "" }), jres({ data: [] }), jres({})]);
  const l = new Ledgeur({ apiKey: "k", fetch: f });
  await l.getMeeting("a/b"); await l.getTranscript("m1"); await l.getMeetingParticipants("m1"); await l.getMeetingMetadata("m1");
  ok("encodes ids in the path", calls[0].url.pathname === "/api/v1/meetings/a%2Fb");
  ok("hits transcript, participants and metadata paths",
    calls[1].url.pathname.endsWith("/m1/transcript") && calls[2].url.pathname.endsWith("/m1/participants") && calls[3].url.pathname.endsWith("/m1/metadata"));
}
{
  const { f, calls } = fakeFetch([jres({ data: [{ id: "p1", label: "Speaker 1", name: null, identity_confidence: null }] })]);
  const people = await new Ledgeur({ apiKey: "k", fetch: f }).getMeetingParticipants("m");
  ok("unwraps participants from { data }", Array.isArray(people) && people[0].id === "p1" && calls.length === 1);
}
{
  const input = { title: "Review", segments: [{ speaker: "Ann", start_ms: 0, end_ms: 10, text: "hi" }] };
  const { f, calls } = fakeFetch([jres({ id: "m" }, 201)]);
  await new Ledgeur({ apiKey: "k", fetch: f }).createMeeting(input);
  ok("createMeeting POSTs JSON", calls[0].init.method === "POST" && calls[0].url.pathname === "/api/v1/meetings"
    && (calls[0].init.headers as Record<string, string>)["Content-Type"] === "application/json" && calls[0].init.body === JSON.stringify(input));
}

// --- webhooks ---------------------------------------------------------------
{
  const { f, calls } = fakeFetch([
    jres({ id: "w", url: "https://x", events: ["meeting.completed"], created_at: "t", secret: "whsec_1" }, 201),
    jres({ id: "w2", url: "https://y", events: ["meeting.completed"], created_at: "t", secret: "whsec_2" }, 201),
    jres({ data: [{ id: "w" }] }),
    new Response(null, { status: 204 }),
  ]);
  const l = new Ledgeur({ apiKey: "k", fetch: f });
  const w = await l.webhooks.create({ url: "https://x", events: ["meeting.completed"] });
  const s = await l.subscribeToMeetingComplete("https://y");
  const list = await l.webhooks.list();
  const del = await l.webhooks.delete("w");
  ok("webhooks.create returns the secret", w.secret === "whsec_1");
  ok("subscribeToMeetingComplete posts the single event", JSON.parse(calls[1].init.body as string).events.join() === "meeting.completed" && s.secret === "whsec_2");
  ok("webhooks.list unwraps data", list.length === 1);
  ok("webhooks.delete sends DELETE and resolves on 204", calls[3].init.method === "DELETE" && calls[3].url.pathname === "/api/v1/webhooks/w" && del === undefined);
}

// --- pagination -------------------------------------------------------------
{
  const { f, calls } = fakeFetch([
    jres({ data: [summary("a"), summary("b")], next_cursor: "c1" }),
    jres({ data: [summary("c")], next_cursor: "c2" }),
    jres({ data: [], next_cursor: null }),
  ]);
  const seen: string[] = [];
  for await (const m of new Ledgeur({ apiKey: "k", fetch: f }).iterateMeetings({ updatedSince: "2026-01-01T00:00:00Z", limit: 2 })) seen.push(m.id);
  ok("iterateMeetings walks every page in order", seen.join() === "a,b,c", seen.join());
  ok("it follows next_cursor and keeps updated_since and limit", calls.length === 3 && calls[1].url.searchParams.get("cursor") === "c1"
    && calls[2].url.searchParams.get("cursor") === "c2" && calls[2].url.searchParams.get("updated_since") === "2026-01-01T00:00:00Z" && calls[2].url.searchParams.get("limit") === "2");
}

// --- error mapping ----------------------------------------------------------
{
  const e = async (res: Response | Error) => {
    const { f } = fakeFetch([res]);
    try { await new Ledgeur({ apiKey: "k", fetch: f }).getMeeting("x"); return null; } catch (x) { return x as LedgeurError; }
  };
  const a = await e(jres({ error: { code: "plan_required", message: "Upgrade." } }, 402));
  ok("maps the error envelope to LedgeurError", a instanceof LedgeurError && a.status === 402 && a.code === "plan_required" && a.message === "Upgrade.");
  const b = await e(jres({ error: { code: "unauthorized", message: "no" } }, 401));
  ok("maps 401", b?.status === 401 && b.code === "unauthorized");
  const c = await e(new Response("<html>bad gateway</html>", { status: 502 }));
  ok("copes with a non-JSON error body", c instanceof LedgeurError && c.status === 502 && c.code === "unknown");
  const d = await e(new Error("connect ECONNREFUSED"));
  ok("wraps network failures", d instanceof LedgeurError && d.status === 0 && d.code === "network_error");
  ok("LedgeurError is an Error with a name", a instanceof Error && a.name === "LedgeurError");
}
ok("apiKey is required", (() => { try { new Ledgeur({ apiKey: "" }); return false; } catch { return true; } })());

// --- verifyWebhook ----------------------------------------------------------
{
  const secret = "whsec_test";
  const event: LedgeurEvent = { id: "e1", type: "meeting.completed", created_at: "2026-01-01T00:00:00.000Z", data: { meeting_id: "m", meeting: summary("m") } };
  const body = JSON.stringify(event);
  const now = Date.parse("2026-01-01T00:00:10.000Z");
  const ts = "2026-01-01T00:00:00.000Z";
  // Signed by the shared server-side signer.
  const headers = await webhookHeaders(body, ts, secret, "meeting.completed", "e1");
  ok("the shared signer emits the headers the SDK reads", headers["X-Ledgeur-Signature"] === await signWebhook(secret, ts, body) && headers["X-Ledgeur-Delivery"] === "e1");

  const got = await verifyWebhook(body, headers, secret, { now });
  ok("accepts a valid delivery (record headers) and returns the event", got.id === "e1" && got.data.meeting_id === "m");
  const got2 = await verifyWebhook(body, new Headers(headers), secret, { now });
  ok("accepts a Headers object", got2.type === "meeting.completed");
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  ok("header names are case-insensitive", (await verifyWebhook(body, lower, secret, { now })).id === "e1");

  const expect = async (fn: () => Promise<unknown>, reason: string) => {
    try { await fn(); return false; } catch (x) { return x instanceof LedgeurWebhookError && x.reason === reason; }
  };
  ok("rejects a tampered body", await expect(() => verifyWebhook(body.replace('"m"', '"z"'), headers, secret, { now }), "bad_signature"));
  ok("rejects the wrong secret", await expect(() => verifyWebhook(body, headers, "whsec_other", { now }), "bad_signature"));
  ok("rejects a swapped timestamp", await expect(() => verifyWebhook(body, { ...headers, "X-Ledgeur-Timestamp": "2026-01-01T00:00:05.000Z" }, secret, { now }), "bad_signature"));
  ok("rejects an expired delivery", await expect(() => verifyWebhook(body, headers, secret, { now: now + 10 * 60_000 }), "stale"));
  ok("tolerance is configurable", (await verifyWebhook(body, headers, secret, { now: now + 10 * 60_000, toleranceSeconds: 3600 })).id === "e1");
  ok("rejects a missing signature", await expect(() => verifyWebhook(body, { "X-Ledgeur-Timestamp": ts }, secret, { now }), "malformed"));
  ok("rejects a garbage timestamp", await expect(() => verifyWebhook(body, { ...headers, "X-Ledgeur-Timestamp": "soon" }, secret, { now }), "malformed"));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
