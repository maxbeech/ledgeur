import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";
import { COMPETITORS } from "@/lib/competitors";
import { PLATFORMS } from "@/lib/platforms";
import { USE_CASES } from "@/lib/usecases";
import { POSTS } from "@/lib/posts";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const urls: MetadataRoute.Sitemap = [
    { url: SITE.url, lastModified: now, priority: 1 },
    { url: `${SITE.url}/app`, lastModified: now, priority: 0.9 },
    { url: `${SITE.url}/pricing`, lastModified: now, priority: 0.7 },
    { url: `${SITE.url}/open-source`, lastModified: now, priority: 0.7 },
    { url: `${SITE.url}/alternatives`, lastModified: now, priority: 0.8 },
    { url: `${SITE.url}/transcribe`, lastModified: now, priority: 0.8 },
    { url: `${SITE.url}/use-cases`, lastModified: now, priority: 0.7 },
    { url: `${SITE.url}/blog`, lastModified: now, priority: 0.7 },
  ];
  for (const c of COMPETITORS) urls.push({ url: `${SITE.url}/alternatives/${c.slug}`, lastModified: now, priority: 0.7 });
  for (const p of PLATFORMS) urls.push({ url: `${SITE.url}/transcribe/${p.slug}`, lastModified: now, priority: 0.7 });
  for (const u of USE_CASES) urls.push({ url: `${SITE.url}/use-cases/${u.slug}`, lastModified: now, priority: 0.6 });
  for (const p of POSTS) urls.push({ url: `${SITE.url}/blog/${p.slug}`, lastModified: now, priority: 0.6 });
  return urls;
}
