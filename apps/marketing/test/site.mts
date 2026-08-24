// The website's own guardrails.
//
// Two things are asserted here that review keeps failing to catch:
//
//  1. **No unshipped feature is sold.** The pricing page used to advertise SSO,
//     SCIM, an admin audit log and a Docker/Helm self-host bundle, none of which
//     exist. A customer could pay and receive nothing that was described. The
//     plan definitions are now checked against a list of things this repository
//     does not contain.
//  2. **Nothing links to a page that is not there.** Every route named in the
//     navigation, the footer and the sitemap must exist on disk.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { PLANS, COMPARISON, TEAM_PRICE_USD } from "../lib/plans.ts";
import { NAV, SITE } from "../lib/site.ts";
import { RELEASES } from "../lib/changelog.ts";
import { DATA_FACTS, DATA_COLLECTED, POLICY_UPDATED } from "../lib/legal.ts";

const appDir = new URL("../app/", import.meta.url);

/** Does this site route resolve to a page on disk? */
function routeExists(href: string): boolean {
  if (!href.startsWith("/")) return true; // external
  const segments = href.split("/").filter(Boolean);
  if (segments.length === 0) return existsSync(new URL("page.tsx", appDir));
  // A dynamic segment ([slug]) satisfies any concrete child.
  let dir = appDir;
  for (const segment of segments) {
    const here = new URL(`${segment}/`, dir);
    if (existsSync(here)) { dir = here; continue; }
    const dynamic = readdirSync(dir).find((d) => d.startsWith("[") && d.endsWith("]"));
    if (!dynamic) return false;
    dir = new URL(`${dynamic}/`, dir);
  }
  return existsSync(new URL("page.tsx", dir));
}

export function runSiteTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- plans describe only what exists ----------
  const shipped = readFileSync(new URL("../lib/plans.ts", import.meta.url), "utf8");
  ok("plans.ts states the rule it is held to", /add the code first/i.test(shipped));

  // Words that describe capabilities this repository does not contain. Any of
  // them inside a paid plan's feature list is a promise we cannot keep.
  const VAPOUR = [
    "SSO", "SAML", "SCIM", "audit log", "admin console",
    "Helm", "Docker", "air-gapped", "SOC 2", "ISO 27001",
  ];
  for (const plan of PLANS) {
    for (const line of plan.includes) {
      const found = VAPOUR.find((word) => line.toLowerCase().includes(word.toLowerCase()));
      ok(`${plan.name} does not sell "${found ?? ""}"`, !found, `"${line}"`);
    }
  }

  // The Enterprise note is allowed to mention them, because it says we do NOT
  // have them — which is the point.
  const enterprise = PLANS.find((p) => p.id === "enterprise");
  ok("the enterprise plan says plainly what is missing",
    /do not currently ship/i.test(enterprise?.note ?? ""), enterprise?.note ?? "(no note)");

  ok("there is a free plan", PLANS.some((p) => p.price === "$0"));
  ok("the free plan needs no account",
    /no account required/i.test(PLANS.find((p) => p.id === "personal")?.note ?? ""));
  ok("every plan says who it is for", PLANS.every((p) => p.who.length > 10));
  ok("every plan lists something", PLANS.every((p) => p.includes.length >= 3));
  ok("every plan has a call to action", PLANS.every((p) => p.cta.label.length > 0));
  ok("exactly one plan is featured", PLANS.filter((p) => p.featured).length === 1);
  ok("plan ids are unique", new Set(PLANS.map((p) => p.id)).size === PLANS.length);
  ok("every plan maps to a real database plan value",
    PLANS.every((p) => ["free", "team", "company"].includes(p.dbPlan)));

  ok("the advertised price matches the shared constant",
    PLANS.find((p) => p.id === "team")?.price === `$${TEAM_PRICE_USD}`,
    PLANS.find((p) => p.id === "team")?.price ?? "(no price)");

  // The paid plan must actually name the three things it delivers.
  const teamText = (PLANS.find((p) => p.id === "team")?.includes ?? []).join(" ").toLowerCase();
  for (const promised of ["sync", "shared team library", "mcp"]) {
    ok(`the paid plan names "${promised}"`, teamText.includes(promised), teamText);
  }

  // ---------- the comparison is factual ----------
  ok("the comparison has rows", COMPARISON.length >= 4);
  ok("every comparison row describes both sides",
    COMPARISON.every((r) => r.ledgeur.length > 5 && r.them.length > 5));
  // No competitor is named in the generic comparison — the per-competitor pages
  // do that, with specifics. A generic swipe is not an argument.
  for (const row of COMPARISON) {
    ok(`the comparison row "${row.point}" names no competitor`,
      !/granola|otter|fireflies|fathom|zoom ai/i.test(`${row.ledgeur} ${row.them}`),
      `${row.ledgeur} / ${row.them}`);
  }

  // ---------- every link goes somewhere ----------
  for (const [group, links] of Object.entries(NAV)) {
    for (const [label, href] of links) {
      ok(`nav ${group}: "${label}" → ${href} exists`, routeExists(href), href);
    }
  }
  for (const plan of PLANS) {
    if (plan.cta.href) ok(`${plan.name} CTA → ${plan.cta.href} exists`, routeExists(plan.cta.href));
  }

  // Pages a product taking payments must have, and which were all missing.
  for (const required of ["/privacy", "/terms", "/security", "/changelog", "/agents", "/account", "/signin"]) {
    ok(`${required} exists`, routeExists(required));
  }

  // ---------- the sitemap covers what is indexable ----------
  const sitemapSrc = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");
  for (const route of ["/pricing", "/agents", "/privacy", "/terms", "/security", "/changelog", "/app", "/blog"]) {
    ok(`the sitemap includes ${route}`, sitemapSrc.includes(`${route}\``) || sitemapSrc.includes(`${route}/`), route);
  }
  // Authenticated pages must NOT be in the sitemap.
  for (const route of ["/account", "/signin"]) {
    ok(`the sitemap omits ${route}`, !new RegExp(`\\$\\{SITE\\.url\\}${route}\``).test(sitemapSrc), route);
  }
  ok("the sitemap does not stamp every page with the build time",
    !/lastModified:\s*now\b/.test(sitemapSrc) && !/const now = new Date\(\)/.test(sitemapSrc),
    "a build-time lastModified teaches crawlers to ignore the field");

  const robots = readFileSync(new URL("../app/robots.ts", import.meta.url), "utf8");
  ok("robots keeps crawlers out of the API", robots.includes("/api/"));
  ok("robots points at the sitemap", robots.includes("sitemap.xml"));

  // ---------- checkout cannot sell to nobody ----------
  const checkout = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
  ok("checkout requires a signed-in caller", /sign_in_required/.test(checkout));
  ok("checkout resolves the workspace server-side, not from the query string",
    !/searchParams|req\.url/.test(checkout) && /org_members/.test(checkout));
  ok("checkout refuses rather than selling to a workspace it cannot find",
    /no_workspace/.test(checkout) && /409/.test(checkout));
  ok("checkout always sets client_reference_id, which is what activates the plan",
    /client_reference_id: orgId/.test(checkout));
  ok("a billing portal exists, so cancelling does not need an email",
    existsSync(new URL("../app/api/portal/route.ts", import.meta.url)));

  // ---------- policy content ----------
  ok("the policy date is a real date", !Number.isNaN(new Date(POLICY_UPDATED).getTime()));
  ok("every data claim explains why it is true",
    DATA_FACTS.every((f) => f.because.length > 40), JSON.stringify(DATA_FACTS.map((f) => f.because.length)));
  ok("the privacy notice names the model CDN, which is the one third party on the free plan",
    readFileSync(new URL("../app/privacy/page.tsx", import.meta.url), "utf8").includes("Hugging Face"));
  ok("what we collect is enumerated", DATA_COLLECTED.length >= 3);
  ok("the terms explain how to cancel",
    /billing portal/i.test(readFileSync(new URL("../app/terms/page.tsx", import.meta.url), "utf8")));
  ok("the security page publishes what is missing",
    /No SOC 2/i.test(readFileSync(new URL("../app/security/page.tsx", import.meta.url), "utf8")));

  // ---------- changelog ----------
  ok("the changelog has entries", RELEASES.length >= 2);
  ok("changelog dates are real", RELEASES.every((r) => !Number.isNaN(new Date(r.date).getTime())));
  ok("the changelog is newest first",
    RELEASES.every((r, i) => i === 0 || RELEASES[i - 1].date >= r.date),
    RELEASES.map((r) => r.date).join(" "));
  ok("the changelog admits to bugs, not only features",
    RELEASES.some((r) => r.changes.some((c) => c.kind === "fixed")));
  ok("every change is described in a full sentence",
    RELEASES.every((r) => r.changes.every((c) => c.text.length > 30)));

  // ---------- brand consistency ----------
  // The site used to be default-Tailwind stone/emerald while the app wore the
  // design system. Anything importing raw palette colours is drifting back.
  // Every page and component, not a sample: the site was half-converted once
  // already, which reads worse than not having been converted at all.
  function tsxFiles(dir: URL): URL[] {
    const out: URL[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) out.push(...tsxFiles(child));
      else if (entry.name.endsWith(".tsx")) out.push(child);
    }
    return out;
  }
  const surfaces = [
    ...tsxFiles(new URL("../app/", import.meta.url)),
    ...tsxFiles(new URL("../components/", import.meta.url)),
  ];
  ok("there are surfaces to check", surfaces.length > 20, `${surfaces.length}`);
  for (const file of surfaces) {
    const src = readFileSync(file, "utf8");
    const raw = /\b(?:text|bg|border|ring|from|to)-(?:stone|emerald|amber|slate|gray|zinc|neutral|rose|red|green|blue|indigo|teal|orange|yellow|lime|cyan|sky|violet|purple|fuchsia|pink)-\d{2,3}\b/.exec(src);
    const name = file.pathname.split("/marketing/")[1];
    ok(`${name} uses design tokens, not raw Tailwind colours`, raw === null, raw?.[0]);
  }

  // The open-source FAQ used to promise "a supported Docker/Helm bundle,
  // SSO/SAML, an admin console and an SLA" in an answer, which the plan-data
  // check could never have caught.
  const openSource = readFileSync(new URL("../app/open-source/page.tsx", import.meta.url), "utf8");
  ok("the open-source FAQ does not promise a self-host bundle we do not ship",
    !/supported Docker\/Helm bundle|Docker and Helm bundle/i.test(openSource));
  ok("the open-source FAQ says plainly that there is no Docker image",
    /no Docker image and no Helm chart/i.test(openSource));

  // Prose is where an unshipped promise hides best. The pricing page's plan data
  // was fixed first, then the open-source FAQ turned out to promise a self-host
  // bundle in an answer, then two blog posts turned out to promise SSO, SCIM, an
  // admin console and an SLA. So: every piece of written content is checked, and
  // a claim may only appear alongside a denial of it.
  const DENIALS = /\b(?:no|not|does not|do not|is not|are not|without|lack|lacking|missing|never|nor|neither|cannot)\b/i;
  const PROMISED: readonly [string, RegExp][] = [
    ["a Docker/Helm bundle", /supported Docker\s*\/\s*Helm|Helm chart|Docker image/i],
    ["SCIM", /SCIM/i],
    ["an admin console", /admin console/i],
    ["an audit log", /audit log/i],
    ["SSO/SAML", /SSO\s*\/\s*SAML|SAML/i],
    ["an SLA", /\bSLA\b/i],
    ["SOC 2", /SOC 2/i],
  ];
  const proseFiles = [
    "../lib/posts/set-1.ts", "../lib/posts/set-2.ts", "../lib/posts/set-3.ts",
    "../lib/competitors.ts", "../lib/usecases.ts", "../lib/platforms.ts",
    "../app/open-source/page.tsx", "../app/pricing/page.tsx", "../app/agents/page.tsx",
    "../app/security/page.tsx",
  ];
  // A window rather than a sentence: the denial is often the sentence *after*
  // the claim ("…SSO/SAML and SCIM. Ledgeur has neither."), and a per-sentence
  // check flags that as a promise. Comments are stripped first, because the
  // explanation of what used to be promised is not itself a promise.
  const WINDOW = 400;
  for (const file of proseFiles) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    for (const [label, pattern] of PROMISED) {
      const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
      for (const match of src.matchAll(global)) {
        const at = match.index ?? 0;
        const context = src.slice(Math.max(0, at - WINDOW), at + WINDOW);
        ok(`${file} mentions ${label} only alongside a denial`,
          DENIALS.test(context), `…${src.slice(Math.max(0, at - 120), at + 160).replace(/\s+/g, " ")}…`);
      }
    }
  }

  // Search results truncate a title at roughly 60 characters and a description
  // at roughly 160. A page whose title is cut mid-word, or that repeats the
  // brand twice because the template already appends it, looks unmaintained in
  // exactly the place a stranger first meets the product.
  for (const file of tsxFiles(new URL("../app/", import.meta.url))) {
    const src = readFileSync(file, "utf8");
    const name = file.pathname.split("/marketing/")[1];
    const title = /^\s*title: "([^"]+)"/m.exec(src);
    if (title) {
      // The layout appends " · Ledgeur" (10 characters) to every page title.
      ok(`${name} title fits a search result`, title[1].length + 10 <= 70,
        `${title[1].length + 10}: "${title[1]} · Ledgeur"`);
      ok(`${name} title does not repeat the brand`, !/Ledgeur/.test(title[1]), title[1]);
    }
    const description = /^\s*description:\s*\n?\s*"([^"]+)"/m.exec(src);
    if (description) {
      ok(`${name} description fits a search result`, description[1].length <= 168,
        `${description[1].length}: "${description[1].slice(0, 80)}…"`);
    }
  }

  const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  ok("the site imports the shared theme rather than defining its own",
    globals.includes("@ledgeur/ui/theme.css"));
  ok("the site self-hosts its fonts", globals.includes("@fontsource-variable/fraunces"));

  ok("the site description mentions speaker separation, which is the differentiator",
    /speaker|who said what/i.test(SITE.description), SITE.description);
  // A search result is cut at about 160 characters, and a description that ends
  // mid-clause reads as carelessness on a page whose argument is carefulness.
  ok("the meta description fits in a search result",
    SITE.description.length <= 165, `${SITE.description.length} characters`);
  ok("the fuller statement is kept for places with room", SITE.longDescription.length > SITE.description.length);
}
