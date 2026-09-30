// Keeps Vercel-only behaviour out of the site.
//
// The site is served by Helm7 (a plain Node container behind Cloudflare). Code
// that reads a Vercel-injected variable or header quietly returns undefined
// there, which turns into a wrong Sentry environment or a missing client IP
// with nothing failing. Statically forbidding the names is cheaper than
// finding that in production.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";

const repoRoot = new URL("../../../", import.meta.url).pathname;
const ROOTS = ["apps/marketing", "apps/mcp-server", "packages", "lib"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "test", ".turbo"]);
// lib/openhelm-* are generated copies of the shared _services files, rewritten
// by the next install; one of them names @vercel/analytics in a comment only.
const GENERATED = /(^|\/)lib\/openhelm-[^/]+$/;
const SOURCE = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".json"]);

// `VERCEL_` covers VERCEL_ENV and NEXT_PUBLIC_VERCEL_*; the header and package
// names are what would otherwise creep back in through copied snippets.
const FORBIDDEN: readonly [string, RegExp][] = [
  ["a @vercel/* package", /@vercel\//],
  ["a VERCEL_* variable", /VERCEL_[A-Z_]+/],
  ["an x-vercel-* header", /x-vercel-/i],
  ["maxDuration (Cloudflare cuts requests at 100 s regardless)", /\bmaxDuration\b/],
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (SOURCE.has(extname(name))) yield path;
  }
}

export function runNoVercelTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  const hits: string[] = [];
  let scanned = 0;
  for (const root of ROOTS) {
    const dir = join(repoRoot, root);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      if (GENERATED.test(relative(repoRoot, file))) continue;
      scanned++;
      const text = readFileSync(file, "utf8");
      for (const [label, pattern] of FORBIDDEN) {
        if (pattern.test(text)) hits.push(`${relative(repoRoot, file)}: ${label}`);
      }
    }
  }
  ok("the no-vercel scan actually read source files", scanned > 50, `scanned ${scanned}`);
  ok("no Vercel-only package, variable, header or maxDuration in the source", hits.length === 0, hits.join("; "));

  ok("no vercel.json in the app or the repository root",
    !existsSync(join(repoRoot, "vercel.json")) && !existsSync(join(repoRoot, "apps/marketing/vercel.json")));

  // Sentry's environment label must come from NODE_ENV, the one thing every
  // host sets.
  for (const file of ["sentry.server.config.ts", "sentry.edge.config.ts", "instrumentation-client.ts"]) {
    const source = readFileSync(join(repoRoot, "apps/marketing", file), "utf8");
    ok(`${file} labels the Sentry environment from NODE_ENV`, /environment: process\.env\.NODE_ENV,/.test(source));
  }

  // Helm7 runs `next start` and hands the port over as $PORT; `next start`
  // reads it itself, so the script must not pin one.
  const pkg = JSON.parse(readFileSync(join(repoRoot, "apps/marketing/package.json"), "utf8")) as { scripts: Record<string, string> };
  ok("npm start honours $PORT (no hard-coded port)", pkg.scripts.start === "next start", pkg.scripts.start);
}
