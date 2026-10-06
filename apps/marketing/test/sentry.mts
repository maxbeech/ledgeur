// Sentry wiring: shared options, log scrubbing, the central capture helper,
// and that the feedback control and error boundaries are actually in place.
import { readFileSync } from "node:fs";
import { scrubText, scrubLog, baseSentryOptions } from "../lib/sentry-options.ts";
import { captureServerError, captureServerMessage } from "../lib/observability.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

export function runSentryTests(ok: Ok) {
  // --- log scrubbing
  ok("scrubText redacts email addresses", scrubText("signed in as jo@example.com ok") === "signed in as [email] ok");
  ok("scrubText redacts bearer tokens", !/abcdefghijkl/.test(scrubText("Authorization: Bearer abcdefghijkl123")));
  ok("scrubText redacts Ledgeur access tokens", scrubText("token ldg_abcdef123456") === "token [token]");
  ok("scrubText leaves ordinary text alone", scrubText("meeting saved") === "meeting saved");
  ok("scrubLog scrubs the log message", scrubLog({ message: "mail a@b.co" }).message === "mail [email]");
  ok("scrubLog tolerates a non-string message", scrubLog({ message: 3 }).message === 3);
  ok("shared options turn logs on and PII off", baseSentryOptions.enableLogs === true && baseSentryOptions.sendDefaultPii === false);
  ok("shared options scrub logs", baseSentryOptions.beforeSendLog === scrubLog);

  // --- every init uses the shared options and forwards console output
  for (const file of ["instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts"]) {
    const src = read(`../${file}`);
    ok(`${file} spreads the shared options (logs on)`, /\.\.\.baseSentryOptions/.test(src));
    ok(`${file} forwards console output`, /consoleLogging\(\)/.test(src));
  }
  const client = read("../instrumentation-client.ts");
  ok("feedback does not auto-inject a floating button", /autoInject: false/.test(client));
  ok("the tunnel content-type fix is present", /application\/x-sentry-envelope/.test(client));
  const cfg = read("../next.config.ts");
  ok("the tunnel path is randomised, not /monitoring", /tunnelRoute: true/.test(cfg));
  ok("next.config names the ledgeur_web project", /"ledgeur_web"/.test(cfg) && /"maxed-labs"/.test(cfg));
  ok("instrumentation.ts exports onRequestError", /onRequestError = Sentry\.captureRequestError/.test(read("../instrumentation.ts")));

  // --- boundaries report
  ok("global-error captures the exception", /Sentry\.captureException\(error\)/.test(read("../app/global-error.tsx")));
  ok("the page error boundary captures the exception", /Sentry\.captureException\(error\)/.test(read("../app/error.tsx")));

  // --- feedback control placement
  ok("the footer carries the feedback control", /<FeedbackButton \/>/.test(read("../components/site/Chrome.tsx")));
  const shell = read("../components/app/AppShell.tsx");
  ok("the app shell carries the feedback control", /<FeedbackButton variant="row"/.test(shell));
  ok("the app shell pre-fills the signed-in email", /user=\{session\?\.user/.test(shell));
  ok("the feedback control opens Sentry's form", /createForm\(\)/.test(read("../components/feedback/open-feedback.ts")));

  // --- swallow sites report
  const sites: [string, string, RegExp][] = [
    ["lib/useWebRecorder.ts", "recorder start failure", /reportClientError\(e, "web-recorder\.start"\)/],
    ["lib/useWebRecorder.ts", "meeting save failure", /reportClientError\(e, "web-recorder\.save"\)/],
    ["lib/useImport.ts", "import failure", /reportClientError\(e, "web-import"\)/],
    ["lib/useSync.ts", "sync refresh failure", /reportClientError\(e, "sync-refresh"\)/],
    ["lib/useLibrary.ts", "library load failure", /reportClientError\(e, "library-load"\)/],
    ["components/app/SyncCard.tsx", "sync push failure", /reportClientError\(e, "sync-push"\)/],
    ["app/api/mcp/route.ts", "MCP handler failure", /captureServerError\(e, \{ scope: "api\.mcp\.handle" \}\)/],
  ];
  for (const [file, what, re] of sites) ok(`${what} reaches Sentry (${file})`, re.test(read(`../${file}`)));

  // --- the Stripe webhook (a Deno edge function) reports its failure paths
  const webhook = read("../../../supabase/functions/stripe-webhook/index.ts");
  ok("the webhook reports activation and plan-update failures to Sentry", (webhook.match(/captureEdgeError\(/g) ?? []).length === 3, String((webhook.match(/captureEdgeError\(/g) ?? []).length));
  ok("the edge reporter posts to the envelope endpoint", /\/envelope\//.test(read("../../../supabase/functions/_shared/sentry.ts")));

  // --- the capture helper degrades loudly with no DSN, and never throws
  const saved = { a: process.env.SENTRY_DSN, b: process.env.NEXT_PUBLIC_SENTRY_DSN };
  delete process.env.SENTRY_DSN; delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  const lines: unknown[][] = [];
  const realErr = console.error;
  console.error = (...a: unknown[]) => { lines.push(a); };
  try {
    captureServerError(new Error("boom"), { scope: "test" });
    captureServerMessage("refused", { scope: "test" });
  } finally {
    console.error = realErr;
    if (saved.a !== undefined) process.env.SENTRY_DSN = saved.a;
    if (saved.b !== undefined) process.env.NEXT_PUBLIC_SENTRY_DSN = saved.b;
  }
  ok("with no DSN the capture helpers log to the console instead of failing silently", lines.length === 2 && String(lines[0][0]).includes("[test]"));
}
