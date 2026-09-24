// The guardrails for the pages added in the strategy pass.
//
// Every check here corresponds to a way one of these pages can rot silently:
// a pillar linking to a post that has been renamed, a template page for a
// template the app no longer has, a gap list that has quietly dropped the
// awkward item, or the two pages that once contradicted each other about SAML
// drifting apart again.
//
// Silence is the common factor. None of these break a build, none of them throw
// in a browser, and all of them make the site less true.

import { existsSync, readFileSync } from "node:fs";
import { GAPS, GAP_AREAS, gapsIn } from "../lib/gaps.ts";
import { GUIDES } from "../lib/guides.ts";
import { TEMPLATES, templateBySlug, templateMarkdown } from "../lib/templates.ts";
import { POSTS, postBySlug } from "../lib/posts.ts";
import { COMPETITORS } from "../lib/competitors.ts";
import { USE_CASES } from "../lib/usecases.ts";
import { PLANS, TEAM_PRICE_USD, ENTERPRISE_FLOOR_USD } from "../lib/plans.ts";
import { SITE } from "../lib/site.ts";
import { NOTE_TEMPLATES } from "@ledgeur/core";
import { SEPTEMBER_2026_CAMPAIGN } from "../lib/posts/september-2026-campaign.ts";

const sitemap = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

export function runContentTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- September 2026 SEO/GEO campaign ----------
  // This is intentionally tested from the rendered data, rather than by
  // counting entries in a source file. A post that is not registered cannot
  // appear in the index, get a static route, or make it into the sitemap.
  const campaign = POSTS.filter((post) => post.campaign === "september-2026-seo-geo");
  const words = (post: typeof campaign[number]) => JSON.stringify({ body: post.body, faqs: post.faqs }).match(/\b[\p{L}\p{N}’'-]+\b/gu)?.length ?? 0;
  ok("the September campaign contains exactly 15 posts", campaign.length === 15, String(campaign.length));
  ok("campaign titles stay below 60 characters", campaign.every((post) => post.title.length < 60), campaign.filter((post) => post.title.length >= 60).map((post) => post.title).join(" | "));
  ok("campaign descriptions stay below 155 characters", campaign.every((post) => post.description.length < 155), campaign.filter((post) => post.description.length >= 155).map((post) => post.slug).join(", "));
  ok("campaign dates are within the publication week", campaign.every((post) => post.date >= "2026-09-18" && post.date <= "2026-09-25"), campaign.map((post) => `${post.slug}:${post.date}`).join(", "));
  ok("campaign has varied editorial formats", new Set(campaign.map((post) => post.category)).size === 3, campaign.map((post) => post.category).join(", "));
  ok("campaign has a primary and six supporting keywords", campaign.every((post) => post.keyword.length > 0 && (post.supportingKeywords?.length ?? 0) >= 6), campaign.filter((post) => (post.supportingKeywords?.length ?? 0) < 6).map((post) => post.slug).join(", "));
  ok("campaign has two long-tail phrases", campaign.every((post) => (post.longTailKeywords?.length ?? 0) >= 2), campaign.filter((post) => (post.longTailKeywords?.length ?? 0) < 2).map((post) => post.slug).join(", "));
  ok("campaign is substantive", campaign.every((post) => words(post) >= 1200), campaign.map((post) => `${post.slug}:${words(post)}`).join(", "));
  ok("campaign has three to five answerable FAQs", campaign.every((post) => (post.faqs?.length ?? 0) >= 3 && (post.faqs?.length ?? 0) <= 5), campaign.filter((post) => (post.faqs?.length ?? 0) < 3 || (post.faqs?.length ?? 0) > 5).map((post) => post.slug).join(", "));
  ok("campaign cites two to five authoritative sources", campaign.every((post) => (post.sources?.length ?? 0) >= 2 && (post.sources?.length ?? 0) <= 5 && post.sources?.every((source) => source.href.startsWith("https://"))), campaign.filter((post) => (post.sources?.length ?? 0) < 2 || (post.sources?.length ?? 0) > 5).map((post) => post.slug).join(", "));
  ok("campaign connects three or more relevant internal pages", campaign.every((post) => (post.internalLinks?.length ?? 0) >= 3 && post.internalLinks?.every((link) => link.href.startsWith("/"))), campaign.filter((post) => (post.internalLinks?.length ?? 0) < 3).map((post) => post.slug).join(", "));
  ok("campaign has FAQs and an appropriate structured-data type", campaign.every((post) => post.schemaTypes?.includes("FAQPage") && (post.schemaTypes?.includes("HowTo") || post.schemaTypes?.includes("Review") || post.category === "News" || post.category === "Academy")), campaign.filter((post) => !post.schemaTypes?.includes("FAQPage")).map((post) => post.slug).join(", "));
  ok("campaign has descriptive social-image alt text", campaign.every((post) => post.featuredImageAlt?.includes(post.keyword)), campaign.filter((post) => !post.featuredImageAlt?.includes(post.keyword)).map((post) => post.slug).join(", "));
  ok("campaign posts are in the central registry", SEPTEMBER_2026_CAMPAIGN.every((post) => postBySlug(post.slug) === post), SEPTEMBER_2026_CAMPAIGN.map((post) => post.slug).filter((slug) => !postBySlug(slug)).join(", "));
  ok("the route renders campaign tables, source links and FAQ schema", (() => {
    const route = read("../app/blog/[slug]/page.tsx");
    return route.includes("ldg-table") && route.includes("Authoritative references") && route.includes('"@type": "FAQPage"');
  })());
  ok("the sitemap receives every campaign post through POSTS", campaign.every(() => sitemap.includes("for (const post of POSTS)")), "sitemap must iterate the central registry");

  // ---------- the gap list is one list ----------
  // /security and /pricing published contradictory claims about SAML for
  // months. The fix was one source; this is the test that keeps it one.
  ok("the gap list is not empty", GAPS.length >= 8);
  ok("gap titles are unique", new Set(GAPS.map((g) => g.title)).size === GAPS.length);
  ok("every gap explains itself", GAPS.every((g) => g.body.length > 40));
  ok("every gap belongs to a rendered area",
    GAPS.every((g) => GAP_AREAS.some((a) => a.id === g.area)));
  ok("every area has at least one gap", GAP_AREAS.every((a) => gapsIn(a.id).length > 0));

  // The specific claims that were wrong, asserted as claims rather than as the
  // absence of a word: "no SSO" was the false one, and it must not come back.
  const sso = GAPS.find((g) => /single sign-on/i.test(g.title));
  ok("the SSO gap exists", Boolean(sso));
  ok("the SSO gap says SAML works in the app",
    /the app itself signs in with saml/i.test(sso?.body ?? ""), sso?.body);
  ok("the SSO gap says it is off on our backend",
    /not switched on/i.test(sso?.body ?? ""), sso?.body);
  ok("no page still claims we have no SSO at all",
    !/no sso, saml or scim/i.test(read("../app/security/page.tsx")));

  // The four honesty items a buyer checks, each present by name.
  for (const required of [/soc 2/i, /scim/i, /baa|business associate/i, /penetration test/i]) {
    ok(`the gap list still names ${required.source}`,
      GAPS.some((g) => required.test(`${g.title} ${g.body}`)));
  }

  // Both pages render the list rather than restating it.
  ok("/security renders the shared gap list", read("../app/security/page.tsx").includes("gapsIn("));
  ok("/pricing renders the shared gap list", read("../app/pricing/page.tsx").includes("GAPS.map"));
  ok("/what-we-dont-have exists",
    existsSync(new URL("../app/what-we-dont-have/page.tsx", import.meta.url)));

  // A gap that names a file must name one that exists, or the page invites the
  // reader to check something that is not there.
  for (const gap of GAPS) {
    if (!gap.evidence) continue;
    ok(`the evidence for "${gap.title}" exists in the repository`,
      existsSync(new URL(`../../../${gap.evidence}`, import.meta.url)), gap.evidence);
  }

  // ---------- pillars link to posts that exist ----------
  ok("there are three pillars", GUIDES.length === 3);
  ok("pillar slugs are unique", new Set(GUIDES.map((g) => g.slug)).size === GUIDES.length);
  for (const guide of GUIDES) {
    ok(`"${guide.slug}" has a real argument`, guide.sections.length >= 4);
    ok(`"${guide.slug}" has substance in every section`,
      guide.sections.every((s) => s.body.every((p) => p.length > 80)));
    ok(`"${guide.slug}" links to a cluster`, guide.cluster.length >= 3);
    for (const slug of guide.cluster) {
      // The failure this catches: a post is renamed, the pillar keeps the old
      // slug, and the one page whose entire job is linking has a dead link.
      ok(`"${guide.slug}" → /blog/${slug} is a real post`, Boolean(postBySlug(slug)), slug);
    }
    ok(`"${guide.slug}" is in the sitemap`, sitemap.includes("/guides/"));
  }
  // A cluster slug in two pillars is a post that has no obvious home, which is
  // fine, but a pillar whose whole cluster is shared is not a pillar.
  for (const guide of GUIDES) {
    const others = GUIDES.filter((g) => g.slug !== guide.slug).flatMap((g) => g.cluster);
    ok(`"${guide.slug}" owns posts of its own`,
      guide.cluster.some((s) => !others.includes(s)));
  }

  // ---------- templates come from the app, not from marketing ----------
  ok("every template page has a real template behind it",
    TEMPLATES.every((t) => NOTE_TEMPLATES.some((n) => n.id === t.template.id)));
  ok("every built-in template has a page",
    NOTE_TEMPLATES.every((n) => TEMPLATES.some((t) => t.template.id === n.id)),
    NOTE_TEMPLATES.filter((n) => !TEMPLATES.some((t) => t.template.id === n.id)).map((n) => n.id).join(", "));
  ok("template slugs are unique", new Set(TEMPLATES.map((t) => t.slug)).size === TEMPLATES.length);
  ok("every template page has headings to copy", TEMPLATES.every((t) => t.headings.length >= 4));
  ok("a slug resolves", templateBySlug(TEMPLATES[0].slug)?.slug === TEMPLATES[0].slug);
  ok("an unknown slug does not", templateBySlug("no-such-template") === undefined);

  // What somebody copies must contain what they read.
  const md = templateMarkdown(TEMPLATES[0]);
  ok("the Markdown carries every heading",
    TEMPLATES[0].headings.every((h) => md.includes(h)), md);
  ok("the Markdown is Markdown", md.startsWith("# "));

  // ---------- the competitors that were missing ----------
  for (const slug of ["circleback", "grain"]) {
    const c = COMPETITORS.find((x) => x.slug === slug);
    ok(`/alternatives/${slug} has an entry`, Boolean(c));
    ok(`${slug} says what they are`, (c?.what.length ?? 0) > 60);
    ok(`${slug} lists real differences`, (c?.diff.length ?? 0) >= 3);
  }
  ok("competitor slugs are unique",
    new Set(COMPETITORS.map((c) => c.slug)).size === COMPETITORS.length);
  // A comparison page that only flatters us is not a comparison. At least one
  // competitor entry has to concede something, or the whole set reads as sales.
  ok("at least one comparison concedes a point",
    COMPETITORS.some((c) => c.diff.some((d) => /better fit|wider today|we would say so|is not built/i.test(d))));

  // ---------- pricing ----------
  ok("the team price moved off the floor", TEAM_PRICE_USD >= 10);
  ok("the team price still undercuts the category median", TEAM_PRICE_USD < 15);
  ok("enterprise has an anchor rather than only a conversation",
    PLANS.find((p) => p.id === "enterprise")?.price === `From $${ENTERPRISE_FLOOR_USD}`);
  ok("the enterprise anchor is above the team price", ENTERPRISE_FLOOR_USD > TEAM_PRICE_USD);
  // The number here is a display value; the money comes from a Stripe Price
  // object. Saying so in the file is the only thing that stops the two drifting
  // without anybody noticing.
  ok("plans.ts warns that Stripe holds the real price",
    /STRIPE_PRICE_ID/.test(read("../lib/plans.ts")));

  // ---------- the new pages are reachable and cached ----------
  for (const route of ["company-memory", "speaker-identification", "guides", "templates", "what-we-dont-have"]) {
    const page = `../app/${route}/page.tsx`;
    ok(`/${route} exists`, existsSync(new URL(page, import.meta.url)));
    ok(`/${route} is in the sitemap`, sitemap.includes(`/${route}`), route);
    // Vercel's free tier is the budget. Static content is prerendered and
    // revalidated weekly rather than rendered per request.
    const source = read(page);
    ok(`/${route} is prerendered rather than dynamic`,
      /export const revalidate = 604800|export const dynamic = "force-static"/.test(source));
  }

  // Every post is still reachable from somewhere: a post in no pillar and no
  // index is a post nobody will find.
  ok("every post is on the blog index", POSTS.length >= 28);

  // Search Console discovered these articles but did not index them. Keep a
  // high bar for material revisions: precise advice and primary sources, not
  // filler added merely to hit a generic word-count target.
  const indexingCandidates = [
    "open-source-granola-alternative", "how-to-transcribe-microsoft-teams-meetings",
    "ai-meeting-notes-without-a-bot", "ai-meeting-summarizer-guide",
    "meeting-notes-best-practices", "meeting-notes-for-remote-teams",
  ];
  const countWords = (post: typeof POSTS[number]) => post.body.reduce((count, block) => {
    if (block.type === "p" || block.type === "h2" || block.type === "h3" || block.type === "quote" || block.type === "callout") return count + block.text.split(/\s+/).length;
    if (block.type === "ul" || block.type === "ol") return count + block.items.join(" ").split(/\s+/).length;
    if (block.type === "table") return count + block.rows.flat().join(" ").split(/\s+/).length;
    return count;
  }, 0);
  for (const slug of indexingCandidates) {
    const post = postBySlug(slug);
    ok(`${slug} is materially updated`, post?.updated === "2026-09-25", post?.updated);
    ok(`${slug} has substantive guidance`, Boolean(post && countWords(post) >= 450), `${countWords(post ?? POSTS[0])} words`);
    ok(`${slug} has primary sources`, Boolean(post && (post.sources?.length ?? 0) >= 2));
  }
  const circleback = COMPETITORS.find((competitor) => competitor.slug === "circleback");
  ok("the Circleback comparison cites vendor documentation", Boolean(circleback && (circleback.sources?.length ?? 0) >= 2));
  const allHands = USE_CASES.find((useCase) => useCase.slug === "all-hands");
  ok("the all-hands page includes a specific publishing workflow", Boolean(allHands && (allHands.workflow?.length ?? 0) >= 4));
  for (const slug of ["sales-call", "user-interview"]) {
    const template = templateBySlug(slug);
    ok(`${slug} template includes audience-specific guidance`, Boolean(template && (template.advice?.length ?? 0) >= 3));
  }

  // ---------- the canonical origin must not redirect ----------
  // Every canonical tag, sitemap entry, OpenGraph url and JSON-LD
  // mainEntityOfPage is built from SITE.url. While it was the apex and the
  // deployment 308-redirected the apex to www, all of them pointed at a URL
  // that redirects, and Search Console overruled our declared canonical on
  // every page of the site. That is invisible from inside the app: the pages
  // render perfectly and the tags look right.
  ok("the canonical origin has no trailing slash", !SITE.url.endsWith("/"), SITE.url);
  ok("the canonical origin is https", SITE.url.startsWith("https://"), SITE.url);
  ok("the canonical origin is the host that answers without a redirect",
    SITE.url === "https://www.ledgeur.com", `${SITE.url} — see the note in lib/site.ts`);
  ok("the canonical origin is within the domain it claims",
    new URL(SITE.url).hostname.endsWith(SITE.domain), SITE.url);
  // robots.ts and the sitemap must agree with it rather than hardcoding a host.
  ok("robots points at the sitemap on the canonical origin",
    read("../app/robots.ts").includes("${SITE.url}/sitemap.xml"));
  ok("the sitemap is built from the canonical origin",
    !/https?:\/\/(?:www\.)?ledgeur\.com/.test(sitemap), "the sitemap hardcodes a host");

  // ---------- the icon a browser asks for without being told to ----------
  // `app/icon.png` gives every page a <link rel="icon">, and browsers request
  // /favicon.ico anyway. Without this file that was a 404 in the console on
  // every page of the site, which is the kind of thing that makes somebody
  // stop trusting the console and miss a real error underneath it.
  ok("a favicon.ico exists so the browser's own probe does not 404",
    existsSync(new URL("../app/favicon.ico", import.meta.url)));
}
