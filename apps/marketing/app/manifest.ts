import type { MetadataRoute } from "next";
import { COLORS } from "@ledgeur/ui";
import { SITE } from "@/lib/site";

// The install manifest, on the palette. The previous one carried a third
// brand — a green that matched neither the site nor the app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.tagline,
    start_url: "/app",
    display: "standalone",
    background_color: COLORS.surface,
    theme_color: COLORS.brand,
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
