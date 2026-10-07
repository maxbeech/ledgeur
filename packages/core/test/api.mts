// The public Meetings API's pure core: row mapping, list cursors, the webhook
// outbox (coalescing and event decisions), retry schedule, SSRF guard, and the
// signature check shared with the SDK.
import {
  DEBOUNCE_MS, coalesce, decideEvent, retryDelaySeconds, subscribersFor, webhookTargetBlocked, isPrivateAddress, normaliseHost,
  toApiSummary, toApiActionItems, toApiTranscript, toApiNotes, toApiMetadata, encodeCursor, decodeCursor, countWords,
  checkWebhookSignature, signWebhook, webhookHeaders, type ApiMeetingRow, type OutboxRow,
} from "../src/index.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;

const meeting = (over: Partial<ApiMeetingRow> = {}): ApiMeetingRow => ({
  id: "m1", title: "Review", status: "complete", started_at: "2026-03-01T10:00:00+00:00",
  ended_at: "2026-03-01T10:30:00+00:00", lang: "en", updated_at: "2026-03-01T10:31:00.123456+00:00", deleted_at: null, ...over,
});

export async function runApiTests(ok: Ok) {
  // --- mapping
  const s = toApiSummary(meeting());
  ok("summary: ISO times, duration and url", s.started_at === "2026-03-01T10:00:00.000Z" && s.duration_ms === 1_800_000
    && s.url === "https://www.ledgeur.com/app/meetings/m1" && s.deleted_at === null && s.updated_at === "2026-03-01T10:31:00.123Z", JSON.stringify(s));
  ok("summary: no end means no duration", toApiSummary(meeting({ ended_at: null })).duration_ms === null);
  ok("summary: an unknown status never leaks out", toApiSummary(meeting({ status: "weird" })).status === "failed");

  ok("notes: null stays null, empty markdown becomes null",
    toApiNotes(null) === null && toApiNotes({ summary: ["a"], decisions: null, questions: [], markdown: "", word_count: 3 })?.markdown === null
    && toApiNotes({ summary: ["a"], decisions: null, questions: [], markdown: "", word_count: 3 })?.decisions.length === 0);

  const items = toApiActionItems([
    { id: "1", title: "Send pack", status: "open", due_date: "2026-03-05", assignee: { full_name: "Ann", email: "a@x.co" } },
    { id: "2", title: "Chase", status: "done", due_date: null, assignee: [{ full_name: null, email: "b@x.co" }] },
    { id: "3", title: "Dropped", status: "cancelled", due_date: null, assignee: null },
    { id: "4", title: "Free", status: "in_progress", due_date: null },
  ]);
  ok("action items: owner name, then email, else null; cancelled dropped", items.length === 3 && items[0].owner === "Ann" && items[1].owner === "b@x.co" && items[2].owner === null);
  ok("action items: done reflects status", items[1].done === true && items[0].done === false && items[0].due === "2026-03-05");

  const t = toApiTranscript("m1",
    [{ id: "g1", speaker_id: "s1", start_ms: 0, end_ms: 5, text: "Hello", confidence: 0.9 }, { id: "g2", speaker_id: "s2", start_ms: 5, end_ms: 9, text: "Hi", confidence: null }, { id: "g3", speaker_id: null, start_ms: 9, end_ms: 10, text: "?", confidence: null }],
    [{ id: "s1", label: "Speaker 1", identified_name: "Ann", identity_confidence: 0.8 }, { id: "s2", label: "Speaker 2", identified_name: null, identity_confidence: null }]);
  ok("transcript: identified name, else label, else Speaker", t.segments.map((g) => g.speaker).join() === "Ann,Speaker 2,Speaker");
  ok("transcript: text is Speaker: text lines", t.text === "Ann: Hello\nSpeaker 2: Hi\nSpeaker: ?", t.text);
  const md = toApiMetadata(meeting(), null, 2, null);
  ok("metadata: shape", md.word_count === null && md.speaker_count === 2 && md.calendar_event === null && md.duration_ms === 1_800_000);
  ok("countWords", countWords(["one two", "  three  ", ""]) === 3);

  // --- cursor
  const c = { u: "2026-03-01T10:31:00.123456+00:00", i: "m1", d: true };
  const back = decodeCursor(encodeCursor(c));
  ok("cursor round-trips, keeping microseconds", back?.u === c.u && back.i === "m1" && back.d === true);
  ok("cursor rejects junk", decodeCursor("%%%") === null && decodeCursor(btoa("{}")) === null && decodeCursor(btoa(JSON.stringify({ u: "nope", i: "x", d: false }))) === null);

  // --- outbox coalescing (mirrors webhook_enqueue in migration 0010)
  const t0 = Date.parse("2026-03-01T12:00:00Z");
  const first = coalesce(null, "m1", "change", t0);
  ok("a first change is due after the debounce window", Date.parse(first.due_at) === t0 + DEBOUNCE_MS && first.kind === "change");
  // A sync burst: 1000 touches in 10 seconds is still ONE row, due 2 min after the LAST.
  let row: OutboxRow | null = null;
  for (let i = 0; i < 1000; i++) row = coalesce(row, "m1", "change", t0 + i * 10);
  ok("a burst coalesces into one row due 2 minutes after the last touch", row?.kind === "change" && Date.parse(row.due_at) === t0 + 999 * 10 + DEBOUNCE_MS);
  const del = coalesce(row, "m1", "deleted", t0 + 5000);
  ok("a deletion is due immediately and wins", del.kind === "deleted" && Date.parse(del.due_at) === t0 + 5000);
  const after = coalesce(del, "m1", "change", t0 + 9000);
  ok("a later change cannot undo a pending deletion or delay it", after.kind === "deleted" && after.due_at === del.due_at);

  // --- event decisions
  const now = t0;
  const fresh = decideEvent("change", meeting(), null, null, now);
  ok("first quiet complete meeting is meeting.completed", fresh?.type === "meeting.completed" && fresh.meeting.id === "m1");
  ok("after completion, changes are meeting.updated", decideEvent("change", meeting(), null, { completed_at: "x", deleted_notified_at: null }, now)?.type === "meeting.updated");
  ok("a meeting still processing sends nothing", decideEvent("change", meeting({ status: "processing" }), null, null, now) === null);
  ok("a recording that has not completed sends nothing, even with state", decideEvent("change", meeting({ status: "recording" }), null, { completed_at: "x", deleted_notified_at: null }, now) === null);
  const soft = decideEvent("change", meeting({ deleted_at: "2026-03-01T11:00:00+00:00" }), null, null, now);
  ok("a tombstone is meeting.deleted with deleted_at set", soft?.type === "meeting.deleted" && soft.meeting.deleted_at === "2026-03-01T11:00:00.000Z");
  const hard = decideEvent("deleted", null, meeting(), null, now);
  ok("a hard delete uses the saved snapshot and stamps deleted_at", hard?.type === "meeting.deleted" && hard.meeting.deleted_at === new Date(now).toISOString() && hard.meeting.title === "Review");
  ok("a deletion is announced once", decideEvent("deleted", null, meeting(), { completed_at: null, deleted_notified_at: "x" }, now) === null);
  ok("a hard delete with no snapshot sends nothing", decideEvent("deleted", null, null, null, now) === null);

  // --- retries
  ok("retry schedule is 1m, 5m, 30m, 2h, 12h then give up",
    [1, 2, 3, 4, 5].map((n) => retryDelaySeconds(n)).join() === "60,300,1800,7200,43200" && retryDelaySeconds(6) === null);

  // --- who receives it
  const subs = [
    { id: "a", user_id: "owner", events: ["meeting.completed"] },
    { id: "b", user_id: "colleague", events: ["meeting.completed", "meeting.deleted"] },
    { id: "c", user_id: "stranger", events: ["meeting.completed"] },
    { id: "d", user_id: "owner", events: ["meeting.deleted"] },
  ];
  const members = new Set(["owner", "colleague"]);
  ok("a private meeting goes only to its owner's subscriptions",
    subscribersFor("meeting.completed", { owner_id: "owner", visibility: "private" }, subs, members).map((x) => x.id).join() === "a");
  ok("an org-visible meeting also goes to members, never to strangers",
    subscribersFor("meeting.completed", { owner_id: "owner", visibility: "org" }, subs, members).map((x) => x.id).join() === "a,b");
  ok("subscriptions only get the events they asked for",
    subscribersFor("meeting.deleted", { owner_id: "owner", visibility: "org" }, subs, members).map((x) => x.id).join() === "b,d");

  // --- SSRF guard
  const blocked = (u: string, local = false) => webhookTargetBlocked(u, local) !== null;
  ok("blocks localhost and private addresses in production",
    ["https://localhost/x", "https://127.0.0.1/x", "https://10.1.2.3/x", "https://192.168.0.5/x", "https://169.254.169.254/latest", "https://172.20.0.1/", "https://[::1]/", "https://db.internal/", "http://example.com/"].every((u) => blocked(u)));
  ok("allows public https hosts", !blocked("https://hooks.example.com/ledgeur") && !blocked("https://172.32.0.1/"));
  ok("allows localhost when local targets are enabled", !blocked("http://localhost:4000/hook", true));

  const priv = (ip: string) => isPrivateAddress(ip);
  ok("isPrivateAddress: private, loopback, link-local, CGNAT, reserved IPv4",
    ["0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "100.127.255.255", "198.18.0.1", "224.0.0.1", "255.255.255.255", "192.0.2.1"].every(priv));
  ok("isPrivateAddress: public IPv4 passes, including the edges of private ranges",
    ["93.184.216.34", "8.8.8.8", "172.15.255.255", "172.32.0.0", "100.63.255.255", "100.128.0.0", "169.253.0.1", "11.0.0.1"].every((ip) => !priv(ip)));
  ok("isPrivateAddress: IPv6 loopback, unspecified, ULA, link-local, multicast, documentation",
    ["::", "::1", "fc00::1", "fd12:3456:789a::1", "fe80::1", "febf::1", "ff02::1", "2001:db8::1"].every(priv));
  ok("isPrivateAddress: IPv4-mapped, compatible, NAT64 and 6to4 forms of private addresses",
    ["::ffff:10.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8", "::10.0.0.1", "64:ff9b::a00:1", "64:ff9b::8.8.8.8", "2002:0a00:0001::1", "0:0:0:0:0:ffff:a00:1"].every(priv));
  ok("isPrivateAddress: public IPv6 passes", !priv("2606:2800:220:1:248:1893:25c8:1946") && !priv("2a00:1450:4009:81f::200e") && !priv("2002:0808:0808::1"));
  ok("isPrivateAddress: junk is treated as blocked", priv("not-an-ip") && priv("1.2.3") && priv("999.1.1.1") && priv("1::2::3"));
  ok("normaliseHost lowercases, unbrackets and strips trailing dots", normaliseHost("[::1]") === "::1" && normaliseHost("LocalHost.") === "localhost" && normaliseHost("a.b..") === "a.b");
  ok("webhookTargetBlocked sees through a trailing dot and IPv4-mapped literals",
    blocked("https://localhost./x") && blocked("https://[::ffff:10.0.0.1]/x") && blocked("https://[fd00::1]/x") && blocked("https://100.64.0.1/x") && blocked("https://[64:ff9b::a00:1]/x"));

  // --- signature check (the SDK's verifier must agree with this)
  const secret = "whsec_a", ts = "2026-03-01T12:00:00.000Z", body = '{"a":1}';
  const sig = await signWebhook(secret, ts, body);
  const h = await webhookHeaders(body, ts, secret, "meeting.updated", "evt1");
  ok("headers carry event, delivery id, timestamp and signature",
    h["X-Ledgeur-Event"] === "meeting.updated" && h["X-Ledgeur-Delivery"] === "evt1" && h["X-Ledgeur-Timestamp"] === ts && h["X-Ledgeur-Signature"] === sig);
  ok("client-side webhook headers are unchanged by default", (await webhookHeaders(body, ts, secret))["X-Ledgeur-Event"] === "meeting.completed" && !("X-Ledgeur-Delivery" in (await webhookHeaders(body, ts, secret))));
  const at = Date.parse(ts);
  ok("checkWebhookSignature: ok / bad / stale / malformed",
    (await checkWebhookSignature(secret, ts, body, sig, { now: at })) === "ok"
    && (await checkWebhookSignature(secret, ts, body + " ", sig, { now: at })) === "bad_signature"
    && (await checkWebhookSignature(secret, ts, body, sig, { now: at + 3_600_000 })) === "stale"
    && (await checkWebhookSignature(secret, null, body, sig)) === "malformed");
}
