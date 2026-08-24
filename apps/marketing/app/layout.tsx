import type { Metadata } from "next";
import "./globals.css";
import { SITE } from "@/lib/site";
import { Header, Footer } from "@/components/site/Chrome";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "ai meeting assistant",
    "on-device meeting transcription",
    "speaker diarization browser",
    "open source granola alternative",
    "private meeting notes",
    "mcp meeting notes",
    "self-hosted meeting notes",
  ],
  openGraph: { title: SITE.name, description: SITE.description, url: SITE.url, siteName: SITE.name, type: "website" },
  twitter: { card: "summary_large_image", title: SITE.name, description: SITE.description },
  alternates: { canonical: SITE.url },
};

// Structured data. Kept factual: the offer really is £0 for the free tier, and
// the feature list matches what ships — search engines and the pricing page
// read from the same reality.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE.name,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web (Chromium, Firefox, Safari)",
  description: SITE.longDescription,
  featureList: [
    "On-device speech recognition",
    "On-device speaker separation",
    "Speaker identification across meetings",
    "Meeting notes, decisions and action items",
    "Model Context Protocol access for AI agents",
  ],
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  url: SITE.url,
  license: "https://opensource.org/licenses/MIT",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="ldg-grain min-h-dvh antialiased">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        {/* First tab stop on every page. */}
        <a href="#main" className="ldg-skip">Skip to content</a>
        <Header />
        <div id="main">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
