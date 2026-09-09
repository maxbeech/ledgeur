import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";
import { COMPETITORS } from "@/lib/competitors";
import { PLATFORMS } from "@/lib/platforms";
import { USE_CASES } from "@/lib/usecases";
import { POSTS } from "@/lib/posts";
import { GUIDES } from "@/lib/guides";
import { TEMPLATES } from "@/lib/templates";
import { RELEASES } from "@/lib/changelog";
import { POLICY_UPDATED } from "@/lib/legal";

/**
 * The sitemap.
 *
 * Two rules, both learned from getting them wrong:
 *
 *  1. Every indexable page appears here. A page that ships without a sitemap
 *     entry and without a link from anywhere is a page nobody will ever read.
 *  2. `lastModified` is a real date, not `new Date()`. Stamping every URL with
 *     the build time tells search engines the entire site changed on every
 *     deploy, which teaches them to ignore the field — so a post that genuinely
 *     changed does not get recrawled.
 *
 * `/signin`, `/account` and `/auth/callback` are deliberately absent: they are
 * noindex, and there is nothing there for a search result.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const contentUpdated = new Date(RELEASES[0]?.date ?? POLICY_UPDATED);
  const policyUpdated = new Date(POLICY_UPDATED);

  const urls: MetadataRoute.Sitemap = [
    { url: SITE.url, lastModified: contentUpdated, priority: 1, changeFrequency: "weekly" },
    { url: `${SITE.url}/app`, lastModified: contentUpdated, priority: 0.9, changeFrequency: "weekly" },
    { url: `${SITE.url}/download`, lastModified: contentUpdated, priority: 0.9, changeFrequency: "weekly" },
    { url: `${SITE.url}/pricing`, lastModified: contentUpdated, priority: 0.9, changeFrequency: "monthly" },
    { url: `${SITE.url}/agents`, lastModified: contentUpdated, priority: 0.8, changeFrequency: "monthly" },
    { url: `${SITE.url}/company-memory`, lastModified: contentUpdated, priority: 0.9, changeFrequency: "monthly" },
    { url: `${SITE.url}/speaker-identification`, lastModified: contentUpdated, priority: 0.8, changeFrequency: "monthly" },
    { url: `${SITE.url}/guides`, lastModified: contentUpdated, priority: 0.8, changeFrequency: "monthly" },
    { url: `${SITE.url}/templates`, lastModified: contentUpdated, priority: 0.8, changeFrequency: "monthly" },
    { url: `${SITE.url}/what-we-dont-have`, lastModified: policyUpdated, priority: 0.6, changeFrequency: "monthly" },
    { url: `${SITE.url}/open-source`, lastModified: contentUpdated, priority: 0.6, changeFrequency: "monthly" },
    { url: `${SITE.url}/changelog`, lastModified: contentUpdated, priority: 0.6, changeFrequency: "weekly" },
    { url: `${SITE.url}/security`, lastModified: policyUpdated, priority: 0.6, changeFrequency: "yearly" },
    { url: `${SITE.url}/privacy`, lastModified: policyUpdated, priority: 0.4, changeFrequency: "yearly" },
    { url: `${SITE.url}/terms`, lastModified: policyUpdated, priority: 0.4, changeFrequency: "yearly" },
    { url: `${SITE.url}/alternatives`, lastModified: contentUpdated, priority: 0.8, changeFrequency: "monthly" },
    { url: `${SITE.url}/transcribe`, lastModified: contentUpdated, priority: 0.8, changeFrequency: "monthly" },
    { url: `${SITE.url}/use-cases`, lastModified: contentUpdated, priority: 0.7, changeFrequency: "monthly" },
    { url: `${SITE.url}/blog`, lastModified: contentUpdated, priority: 0.7, changeFrequency: "weekly" },
  ];

  for (const c of COMPETITORS) {
    urls.push({ url: `${SITE.url}/alternatives/${c.slug}`, lastModified: contentUpdated, priority: 0.7, changeFrequency: "monthly" });
  }
  for (const p of PLATFORMS) {
    urls.push({ url: `${SITE.url}/transcribe/${p.slug}`, lastModified: contentUpdated, priority: 0.7, changeFrequency: "monthly" });
  }
  for (const u of USE_CASES) {
    urls.push({ url: `${SITE.url}/use-cases/${u.slug}`, lastModified: contentUpdated, priority: 0.6, changeFrequency: "monthly" });
  }
  for (const g of GUIDES) {
    // A pillar outranks the posts beneath it deliberately: it is the page meant
    // to answer the broad query, and the cluster pages answer the narrow ones.
    urls.push({ url: `${SITE.url}/guides/${g.slug}`, lastModified: contentUpdated, priority: 0.8, changeFrequency: "monthly" });
  }
  for (const t of TEMPLATES) {
    urls.push({ url: `${SITE.url}/templates/${t.slug}`, lastModified: contentUpdated, priority: 0.7, changeFrequency: "monthly" });
  }
  for (const post of POSTS) {
    // A post's own date, so a genuinely updated post is the one that stands out.
    urls.push({
      url: `${SITE.url}/blog/${post.slug}`,
      lastModified: new Date(post.date),
      priority: 0.6,
      changeFrequency: "yearly",
    });
  }

  return urls;
}
