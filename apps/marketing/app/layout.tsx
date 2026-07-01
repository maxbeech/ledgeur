import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: ["ai meeting assistant", "open source granola alternative", "ai meeting notes", "meeting transcription", "private meeting notes", "self-hosted meeting notes"],
  openGraph: { title: SITE.name, description: SITE.description, url: SITE.url, siteName: SITE.name, type: "website" },
  twitter: { card: "summary_large_image", title: SITE.name, description: SITE.description },
  alternates: { canonical: SITE.url },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE.name,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web (Chromium browsers)",
  description: SITE.description,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  url: SITE.url,
};

const NAV: [string, string][] = [
  ["Transcribe", "/transcribe"],
  ["Alternatives", "/alternatives"],
  ["Use cases", "/use-cases"],
  ["Pricing", "/pricing"],
];

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-[var(--paper)]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-700 text-sm text-white">P</span>
          Parley<span className="text-emerald-700">Notes</span>
        </Link>
        {/* Desktop nav */}
        <nav aria-label="Primary" className="hidden items-center gap-4 text-sm text-stone-600 sm:flex">
          {NAV.map(([label, href]) => <Link key={href} href={href} className="hover:text-stone-900">{label}</Link>)}
          <a href={SITE.repo} className="hover:text-stone-900" target="_blank" rel="noreferrer">GitHub</a>
          <Link href="/app" className="rounded-lg bg-stone-900 px-3 py-1.5 font-medium text-white hover:bg-stone-700">Open app</Link>
        </nav>
        {/* Mobile nav — CSS-only disclosure, no client JS */}
        <details className="relative sm:hidden">
          <summary aria-label="Open menu" className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-stone-300 text-stone-700 [&::-webkit-details-marker]:hidden">☰</summary>
          <nav aria-label="Mobile" className="absolute right-0 mt-2 w-44 rounded-xl border border-stone-200 bg-white p-2 text-sm shadow-lg">
            {NAV.map(([label, href]) => <Link key={href} href={href} className="block rounded-lg px-3 py-2 text-stone-700 hover:bg-stone-50">{label}</Link>)}
            <a href={SITE.repo} className="block rounded-lg px-3 py-2 text-stone-700 hover:bg-stone-50" target="_blank" rel="noreferrer">GitHub</a>
            <Link href="/app" className="mt-1 block rounded-lg bg-stone-900 px-3 py-2 text-center font-medium text-white">Open app</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-20 border-t border-stone-200 bg-white/50">
      <div className="mx-auto max-w-6xl px-5 py-10 text-sm text-stone-600">
        <div className="grid gap-6 sm:grid-cols-4">
          <div>
            <div className="font-bold text-stone-800">{SITE.name}</div>
            <p className="mt-2 max-w-xs text-xs text-stone-600">{SITE.tagline}. Audio is transcribed on your device and never uploaded.</p>
          </div>
          <FooterCol title="Product" links={[["Open app", "/app"], ["Pricing", "/pricing"], ["Open source", "/open-source"]]} />
          <FooterCol title="Transcribe" links={[["Zoom", "/transcribe/zoom"], ["Google Meet", "/transcribe/google-meet"], ["Microsoft Teams", "/transcribe/microsoft-teams"]]} />
          <FooterCol title="Alternatives" links={[["Granola", "/alternatives/granola"], ["Otter.ai", "/alternatives/otter-ai"], ["Fireflies", "/alternatives/fireflies-ai"]]} />
        </div>
        <p className="mt-8 text-xs text-stone-600">© {new Date().getFullYear()} {SITE.name}. Open source under the MIT licence. Free forever for individuals.</p>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-600">{title}</div>
      <ul className="mt-2 space-y-1.5">
        {links.map(([label, href]) => (
          <li key={href}><Link href={href} className="hover:text-stone-900">{label}</Link></li>
        ))}
      </ul>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
