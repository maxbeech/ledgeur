import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PLATFORMS, platformBySlug } from "@/lib/platforms";
import { SITE } from "@/lib/site";

export function generateStaticParams() {
  return PLATFORMS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = platformBySlug(slug);
  if (!p) return {};
  const title = `${p.name} transcription — free, private & on-device | ParleyNotes`;
  const description = `How to transcribe ${p.name} meetings for free with ParleyNotes. On-device AI transcription and notes — no bot joins the call, no cloud upload.`;
  return { title, description, alternates: { canonical: `${SITE.url}/transcribe/${p.slug}` }, openGraph: { title, description, type: "article", images: ["/opengraph-image"] } };
}

export default async function PlatformPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = platformBySlug(slug);
  if (!p) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to transcribe a ${p.name} meeting with ParleyNotes`,
    step: p.tips.map((t, i) => ({ "@type": "HowToStep", position: i + 1, text: t })),
  };

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-stone-600"><Link href="/transcribe" className="hover:text-stone-700">Transcribe</Link> › {p.name}</nav>
      <h1 className="text-3xl font-extrabold tracking-tight capitalize">{p.name} transcription, free & private</h1>
      <p className="mt-4 text-stone-600">{p.how}</p>

      <h2 className="mt-10 text-2xl font-bold">Step by step</h2>
      <ol className="mt-4 space-y-3">
        {p.tips.map((t, i) => (
          <li key={t} className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{i + 1}</span>
            <span className="text-stone-600">{t}</span>
          </li>
        ))}
      </ol>

      <div className="mt-10 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <h2 className="text-lg font-bold capitalize">Transcribe your next {p.name} call</h2>
        <p className="mt-1 text-sm text-stone-600">Free, private, and no bot in the participant list.</p>
        <Link href="/app" className="mt-3 inline-block rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600">Open ParleyNotes →</Link>
      </div>

      <p className="mt-6 text-xs text-stone-600">Search demand (live Google Ads, US): {p.demand}.</p>
    </main>
  );
}
