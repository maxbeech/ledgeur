// The shared Sentry scrubber: secrets, ReDoS, fail-closed, breadcrumbs, transactions, feedback.
import {
  scrubText, scrubValue, scrubEvent, scrubTransaction, scrubBreadcrumb, scrubLog, safeContext,
  stripQuery, failClosed, sentryScrubHooks, MAX_SCAN_CHARS,
} from "../src/sentry/scrub.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;

// Built at runtime so the file itself never contains a literal that trips secret scanners.
const SAMPLES: [string, string][] = [
  ["email", "mail jo.bloggs+x@example.co.uk now"],
  ["phone intl", "call +44 20 7946 0958 please"],
  ["phone grouped", "call (415) 555-0132 please"],
  ["phone uk mobile", "call 07700 900123 please"],
  ["bearer", "Authorization: Bearer abcdefghijklmnop1234"],
  ["jwt", "t=" + ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dozjgNryP4J3jVmNHl0w5N"].join(".")],
  ["stripe sk", "key " + "sk_" + "live_" + "A1b2C3d4E5f6G7h8"],
  ["stripe pk", "key " + "pk_" + "test_" + "A1b2C3d4E5f6G7h8"],
  ["whsec", "wh " + "whsec_" + "A1b2C3d4E5f6G7h8i9"],
  ["helm7", "k " + "hlm_" + "sk_" + "abcdef123456XYZ"],
  ["sentry", "k " + "sntrys_" + "eyJpYXQiOjE2OTk5fQ=="],
  ["ledgeur", "k ldg_abcdef123456"],
  ["github", "k " + "ghp_" + "A".repeat(36)],
  ["aws", "k " + "AKIA" + "ABCDEFGHIJKLMNOP"],
  ["anthropic", "k " + "sk-" + "ant-api03-abcdefghijklmnop"],
  ["password field", "login password=hunter2hunter2 ok"],
  ["json secret", '{"client_secret":"zzzzzzzzzzzz","a":1}'],
  ["token field", "token: abcd1234efgh"],
];
const LEAKS = ["jo.bloggs", "7946", "555-0132", "900123", "abcdefghijklmnop1234", "dozjgNry", "A1b2C3d4E5f6G7h8", "abcdef123456", "hunter2", "zzzzzzzzzzzz", "abcd1234efgh", "ABCDEFGHIJKLMNOP", "eyJpYXQ"];

export function runSentryScrubTests(ok: Ok): void {
  // --- secrets samples
  for (const [name, text] of SAMPLES) {
    const out = scrubText(text);
    ok(`scrubText redacts ${name}`, !LEAKS.some((l) => out.includes(l)) && out !== text, out);
  }
  ok("scrubText leaves dates, counts and ordinary text alone", scrubText("saved 12 meetings on 2026-10-07 in 340ms") === "saved 12 meetings on 2026-10-07 in 340ms");
  const nested = scrubValue({ a: { password: "x1", b: [{ authorization: "Bearer zzzzzzzzzzzz" }], note: "ok" }, email: "a@b.co" }) as any;
  ok("scrubValue redacts sensitive keys at depth and inside arrays", nested.a.password === "[redacted]" && nested.a.b[0].authorization === "[redacted]" && nested.email === "[redacted]" && nested.a.note === "ok");
  const log = scrubLog({ message: "hi a@b.co", attributes: { token: "t", who: "a@b.co", count: 3 } }) as any;
  ok("scrubLog scrubs message and attributes", log.message === "hi [email]" && log.attributes.token === "[redacted]" && log.attributes.who === "[email]" && log.attributes.count === 3);

  // --- long adversarial strings: truncation + linear time
  const long = scrubText("x".repeat(MAX_SCAN_CHARS * 5));
  ok("strings are truncated to ~10k before matching", long.length < MAX_SCAN_CHARS + 50 && long.endsWith("[truncated]"), String(long.length));
  const adversarial: [string, string][] = [
    ["at-signs", "a@".repeat(500_000)],
    ["dotted domain", "a@" + "a.".repeat(500_000)],
    ["local part", "a.".repeat(500_000)],
    ["bearer", "bearer " + "a".repeat(1_000_000)],
    ["bearer spaces", "bearer" + " ".repeat(1_000_000)],
    ["jwt", "eyJ" + "a".repeat(1_000_000)],
    ["jwt dots", "eyJaaaaaaaaaaaa." + "a.".repeat(500_000)],
    ["secret field", "password" + " ".repeat(1_000_000) + "=x"],
    ["phone digits", "1 ".repeat(500_000)],
    ["plus digits", "+" + "1 ".repeat(500_000)],
    ["key prefix", "sk_live_" + "!".repeat(1_000_000)],
  ];
  for (const [name, input] of adversarial) {
    const t0 = performance.now();
    scrubText(input);
    scrubText(input.slice(0, MAX_SCAN_CHARS)); // exactly the cap: no help from truncation
    const ms = performance.now() - t0;
    ok(`adversarial ${name} scrubs in well under 250ms`, ms < 250, `${ms.toFixed(0)}ms`);
  }

  // --- fail closed
  const hostile = { get message(): string { throw new Error("boom"); } };
  ok("scrubEvent drops (null) when scrubbing throws", scrubEvent(hostile) === null);
  ok("scrubTransaction drops when scrubbing throws", scrubTransaction(hostile) === null);
  ok("scrubBreadcrumb drops when scrubbing throws", scrubBreadcrumb({ get data(): object { throw new Error("boom"); } }) === null);
  ok("scrubLog drops when scrubbing throws", scrubLog({ get attributes(): object { throw new Error("boom"); } }) === null);
  const proxy = new Proxy({}, { ownKeys() { throw new Error("nope"); }, getOwnPropertyDescriptor() { throw new Error("nope"); } });
  ok("a throwing proxy in extra drops the event, not the raw object", scrubEvent({ extra: proxy }) === null);
  let reported = 0;
  ok("failClosed returns null and reports", failClosed(() => { throw new Error("x"); }, () => { reported++; })(1) === null && reported === 1);
  ok("hooks are all wired", Object.keys(sentryScrubHooks).sort().join() === "beforeBreadcrumb,beforeSend,beforeSendLog,beforeSendTransaction");

  // --- error events
  const ev = scrubEvent({
    message: "failed for a@b.co",
    exception: { values: [{ type: "Error", value: "bad Bearer abcdefghijklmnop1234" }] },
    request: { url: "https://x.test/p?token=abc#frag", query_string: "token=abc", cookies: { s: "1" }, headers: { Cookie: "s=1" }, data: { text: "ledger" } },
    user: { id: "u1", email: "a@b.co", ip_address: "1.2.3.4", username: "jo" },
    extra: { secret: "s", n: 2 },
    breadcrumbs: [{ message: "to a@b.co", data: { url: "/a?token=abc", to: "/b?x=1#y", from: "/c?z=1", email: "a@b.co" } }],
  }) as any;
  ok("event message and exception are scrubbed", ev.message === "failed for [email]" && !ev.exception.values[0].value.includes("abcdefghijklmnop1234"));
  ok("event request: query/cookies/body stripped", ev.request.url === "https://x.test/p" && !ev.request.query_string && !ev.request.cookies && !ev.request.data && ev.request.headers.Cookie === "[redacted]");
  ok("event user keeps the id only", JSON.stringify(ev.user) === '{"id":"u1"}');
  ok("event extra is scrubbed", ev.extra.secret === "[redacted]" && ev.extra.n === 2);
  ok("breadcrumbs inside events are scrubbed", ev.breadcrumbs[0].message === "to [email]" && ev.breadcrumbs[0].data.url === "/a");

  // --- breadcrumbs
  const crumb = scrubBreadcrumb({
    category: "navigation", message: "Bearer abcdefghijklmnop1234 a@b.co",
    data: { url: "https://x.test/a?token=abc", to: "/dash?session=1", from: "/login?next=/x#h", status_code: 200, email: "a@b.co" },
  }) as any;
  ok("breadcrumb message is scrubbed", crumb.message === "[token] [email]", crumb.message);
  ok("breadcrumb url/to/from lose their query strings", crumb.data.url === "https://x.test/a" && crumb.data.to === "/dash" && crumb.data.from === "/login");
  ok("breadcrumb data keeps counts and redacts emails", crumb.data.status_code === 200 && crumb.data.email === "[redacted]");
  ok("stripQuery strips ? and #", stripQuery("/a?b=1") === "/a" && stripQuery("/a#b") === "/a" && stripQuery("/a") === "/a");

  // --- transactions and spans
  const tx = scrubTransaction({
    type: "transaction", transaction: "GET https://x.test/api?token=abc",
    request: { url: "https://x.test/api?token=abc&u=a@b.co", query_string: "token=abc", cookies: "s=1" },
    contexts: { trace: { data: { "http.url": "https://x.test/api?token=abc", "url.query": "token=abc", "http.status_code": 200 } } },
    spans: [
      { description: "GET https://x.test/v1?token=abc", data: { "http.url": "https://x.test/v1?token=abc", url: "/v1?a=b", "url.query": "token=abc", "url.full": "https://x.test/v1?a=b", "http.response.status_code": 200 } },
      { description: "db.select", data: { count: 3 } },
    ],
  }) as any;
  ok("transaction request url loses its query string", tx.request.url === "https://x.test/api" && !tx.request.query_string && !tx.request.cookies);
  ok("transaction name loses a url query string", tx.transaction === "GET https://x.test/api");
  ok("span http.url / url / url.full are stripped and url.query dropped", tx.spans[0].data["http.url"] === "https://x.test/v1" && tx.spans[0].data.url === "/v1" && tx.spans[0].data["url.full"] === "https://x.test/v1" && !("url.query" in tx.spans[0].data));
  ok("span description loses a url query string", tx.spans[0].description === "GET https://x.test/v1");
  ok("span counts survive", tx.spans[0].data["http.response.status_code"] === 200 && tx.spans[1].data.count === 3);
  ok("trace context data is stripped too", tx.contexts.trace.data["http.url"] === "https://x.test/api" && !("url.query" in tx.contexts.trace.data) && tx.contexts.trace.data["http.status_code"] === 200);

  // --- feedback is not a bypass: contexts.feedback + user intact, the rest scrubbed
  const fb = scrubEvent({
    type: "feedback",
    contexts: { feedback: { name: "Jo", contact_email: "jo@example.com", message: "love it, call me on +44 20 7946 0958" }, app: { secret: "s" } },
    user: { id: "u1", email: "jo@example.com", username: "Jo" },
    breadcrumbs: [{ message: "nav", data: { url: "/a?token=abc" } }],
    request: { url: "https://x.test/p?token=abc", cookies: { s: "1" }, headers: { cookie: "s=1" } },
    tags: { token: "t" }, extra: { apiKey: "k", mail: "jo@example.com" },
  }) as any;
  ok("feedback keeps contexts.feedback verbatim", fb.contexts.feedback.name === "Jo" && fb.contexts.feedback.contact_email === "jo@example.com" && fb.contexts.feedback.message.includes("7946"));
  ok("feedback keeps the user name and email", fb.user.email === "jo@example.com" && fb.user.username === "Jo");
  ok("feedback breadcrumb url query is stripped", fb.breadcrumbs[0].data.url === "/a");
  ok("feedback request cookies and query are stripped", fb.request.url === "https://x.test/p" && !fb.request.cookies && fb.request.headers.cookie === "[redacted]");
  ok("feedback tags, extra and other contexts are still scrubbed", fb.tags.token === "[redacted]" && fb.extra.apiKey === "[redacted]" && fb.extra.mail === "[email]" && fb.contexts.app.secret === "[redacted]");
  ok("a feedback event that fails to scrub is dropped", scrubEvent({ type: "feedback", get extra(): object { throw new Error("x"); } }) === null);

  // --- capture-helper context: ids, codes, counts, enums only
  const ctx = safeContext({ scope: "api.x", status: 502, ok: false, orgId: "3f2a-4b", note: "the Q3 ledger for Acme", who: "a@b.co", obj: { a: 1 }, list: [1], token: "abc" });
  ok("safeContext keeps ids, codes, counts and flags", ctx.scope === "api.x" && ctx.status === 502 && ctx.ok === false && ctx.orgId === "3f2a-4b");
  ok("safeContext omits free text, emails, objects, arrays and secret-named keys", [ctx.note, ctx.who, ctx.obj, ctx.list, ctx.token].every((v) => String(v).startsWith("[omitted")));
}
