import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Nothing here is secret — these pages set noindex themselves — but
      // keeping crawlers out of authenticated routes and the API saves the
      // crawl budget for pages that can actually rank.
      disallow: ["/api/", "/account", "/signin", "/auth/", "/oauth/"],
    },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
