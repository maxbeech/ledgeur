// What reaches Sentry: warnings are breadcrumbs, only errors are issues, and a
// developer's own `pnpm dev` session reports nothing. Plus the clipboard helper
// that stops a refused write from becoming an unhandled rejection.
import { createLogger, type Reporter } from "../src/lib/logger.ts";
import { shouldReport, scrubText, scrubLog, scrubEvent, scrubTransaction, scrubBreadcrumb, sentryOptions, openFeedbackForm } from "../src/lib/sentry.ts";
import { readFileSync } from "node:fs";
import { copyText } from "../src/lib/clipboard.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;

export async function runReportingTests(ok: Ok): Promise<void> {
  const crumbs: Parameters<Reporter["breadcrumb"]>[0][] = [];
  const errors: Error[] = [];
  const reporter: Reporter = {
    breadcrumb: (b) => crumbs.push(b),
    exception: (e) => errors.push(e),
  };
  const quiet = console.warn, quietErr = console.error, quietLog = console.log, quietInfo = console.info;
  console.warn = console.error = console.log = console.info = () => {};
  try {
    const log = createLogger("notes", reporter);
    log.debug("local only");
    log.info("started");
    log.warn("falling back to the extractive summariser", { reason: "timeout" });
    log.warn("speaker naming did not run", new Error("Identifying speakers timed out."));
    log.warn("plain string detail", "boom");
    ok("a warning never opens an issue", errors.length === 0, String(errors.length));
    ok("debug stays out of Sentry", !crumbs.some((c) => c.message === "local only"));
    ok("a warning leaves a warning-level breadcrumb", crumbs.filter((c) => c.level === "warning").length === 3);
    ok("an object detail travels as breadcrumb data", crumbs[1].data?.reason === "timeout");
    ok("an Error detail travels as its message", crumbs[2].data?.error === "Identifying speakers timed out.");
    ok("a string detail is kept", crumbs[3].data?.detail === "boom");
    log.warn("nested", { count: 2, nested: { text: "hello" }, long: "y".repeat(500) });
    const nestedCrumb = crumbs[crumbs.length - 1].data as Record<string, unknown>;
    ok("breadcrumb data drops nested objects and caps long strings", nestedCrumb.count === 2 && !("nested" in nestedCrumb) && String(nestedCrumb.long).length <= 201);

    log.error("render crash", new Error("kaboom"));
    log.error("no error object");
    ok("an error is reported", errors.length === 2 && errors[0].message === "kaboom");
    ok("a bare message still becomes an Error", errors[1].message === "no error object");

    const silent = createLogger("x", null);
    silent.warn("w"); silent.error("e", new Error("e")); silent.info("i");
    ok("with no reporter nothing throws", true);
  } finally {
    console.warn = quiet; console.error = quietErr; console.log = quietLog; console.info = quietInfo;
  }

  ok("a dev build never reports, even with a DSN", !shouldReport({ sentryDsn: "https://k@o.ingest.sentry.io/1", mode: "development" }));
  ok("a production build with no DSN does not report", !shouldReport({ sentryDsn: "", mode: "production" }));
  ok("a production build with a DSN reports", shouldReport({ sentryDsn: "https://k@o.ingest.sentry.io/1", mode: "production" }));

  const written: string[] = [];
  ok("copyText reports a successful write",
    (await copyText("hello", { writeText: async (t) => { written.push(t); } })) === true && written[0] === "hello");
  const denied = new DOMException("Write permission denied.", "NotAllowedError");
  const prevWarn = console.warn; console.warn = () => {};
  const refused = await copyText("x", { writeText: async () => { throw denied; } });
  const missing = await copyText("x", undefined);
  console.warn = prevWarn;
  ok("copyText turns a refused write into false instead of throwing", refused === false);
  ok("copyText reports a missing clipboard as false", missing === false);

  // --- logs, scrubbing and feedback
  const opts = sentryOptions({ sentryDsn: "https://k@o1.ingest.sentry.io/1", mode: "production" });
  ok("logs are on and PII is off", opts.enableLogs === true && opts.sendDefaultPii === false);
  ok("log messages are scrubbed", opts.beforeSendLog === scrubLog);
  ok("scrubText redacts emails", scrubText("hi jo@example.com") === "hi [email]");
  ok("scrubText redacts access tokens", scrubText("token ldg_abcdef123456") === "token [token]");
  ok("scrubText redacts bearer tokens", !scrubText("Bearer abcdefghijkl123").includes("abcdefghijkl"));
  ok("scrubLog scrubs the message", (scrubLog({ message: "a@b.co" }) as { message: string }).message === "[email]");
  ok("the init options scrub events, transactions and breadcrumbs",
    opts.beforeSend === scrubEvent && opts.beforeSendTransaction === scrubTransaction && opts.beforeBreadcrumb === scrubBreadcrumb);
  ok("a throwing event is dropped, not sent raw", opts.beforeSend({ get message(): string { throw new Error("x"); } }) === null);
  const crumb = opts.beforeBreadcrumb({ category: "navigation", message: "a@b.co", data: { to: "/meeting/1?token=abc", from: "/a?b=1" } }) as { message: string; data: { to: string; from: string } };
  ok("breadcrumb urls lose their query strings and messages are scrubbed", crumb.data.to === "/meeting/1" && crumb.data.from === "/a" && crumb.message === "[email]");
  const tx = opts.beforeSendTransaction({ request: { url: "https://app.test/x?token=abc" }, spans: [{ data: { "http.url": "https://api.test/y?k=1", "url.query": "k=1" } }] }) as
    { request: { url: string }; spans: { data: Record<string, string> }[] };
  ok("transaction and span urls lose their query strings", tx.request.url === "https://app.test/x" && tx.spans[0].data["http.url"] === "https://api.test/y" && !("url.query" in tx.spans[0].data));
  ok("feedback events keep contexts.feedback but their breadcrumbs are scrubbed",
    (() => {
      const e = opts.beforeSend({ type: "feedback", contexts: { feedback: { contact_email: "a@b.co" } }, breadcrumbs: [{ data: { url: "/a?token=abc" } }], request: { cookies: { s: "1" } } }) as
        { contexts: { feedback: { contact_email: string } }; breadcrumbs: { data: { url: string } }[]; request: { cookies?: unknown } };
      return e.contexts.feedback.contact_email === "a@b.co" && e.breadcrumbs[0].data.url === "/a" && !e.request.cookies;
    })());
  ok("feedback reports unavailable when this build does not report", (await openFeedbackForm({ email: "a@b.co" })) === false);
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const init = read("../src/lib/sentry.ts");
  ok("init forwards console output", /consoleLoggingIntegration\(\{ levels: \["log", "info", "warn", "error"\] \}\)/.test(init));
  ok("feedback does not auto-inject", /autoInject: false/.test(init));
  ok("the sidebar carries the feedback control", /<FeedbackButton \/>/.test(read("../src/components/Sidebar.tsx")));
  ok("settings carries the feedback control (covers phones)", /<FeedbackButton variant="card"/.test(read("../src/screens/Integrations.tsx")));
  ok("the error boundary reports render crashes", /log\.error\("render crash"/.test(read("../src/components/shell/AppErrorBoundary.tsx")));
  ok("the window reports uncaught errors and rejections",
    /unhandledrejection/.test(read("../src/main.tsx")) && /uncaught error/.test(read("../src/main.tsx")));
}
