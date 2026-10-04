// What reaches Sentry: warnings are breadcrumbs, only errors are issues, and a
// developer's own `pnpm dev` session reports nothing. Plus the clipboard helper
// that stops a refused write from becoming an unhandled rejection.
import { createLogger, type Reporter } from "../src/lib/logger.ts";
import { shouldReport } from "../src/lib/sentry.ts";
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
}
