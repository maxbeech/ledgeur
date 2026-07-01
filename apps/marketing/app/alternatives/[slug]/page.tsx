import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { COMPETITORS, competitorBySlug } from "@/lib/competitors";
import { VALUE_PROPS, SITE } from "@/lib/site";

export function generateStaticParams() {
  return COMPETITORS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = competitorBySlug(slug);
  if (!c) return {};
  const title = `${c.name} alternative — open-source & private | ParleyNotes`;
  const description = `Looking for a ${c.name} alternative? ParleyNotes is the open-source AI meeting assistant that transcribes on your device — no cloud upload, free for individuals.`;
  return { title, description, alternates: { canonical: `${SITE.url}/alternatives/${c.slug}` }, openGraph: { title, description, type: "article", images: ["/opengraph-image"] } };
}

export default async function AlternativePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = competitorBySlug(slug);
  if (!c) notFound();

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-stone-600"><Link href="/alternatives" className="hover:text-stone-700">Alternatives</Link> › {c.name}</nav>
      <h1 className="text-3xl font-extrabold tracking-tight">The open-source {c.name} alternative</h1>
      <p className="mt-4 text-stone-600">
        <strong>{c.name}</strong> {c.what} ParleyNotes does the same core job — accurate transcripts and AI
        notes — but as an open-source app that runs entirely in your browser, so your meetings stay private and
        it’s free for individuals.
      </p>

      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-stone-600">How {c.name} works today</div>
        <p className="mt-1 text-sm text-stone-600">{c.model}</p>
      </div>

      <h2 className="mt-10 text-2xl font-bold">Why teams switch to ParleyNotes</h2>
      <ul className="mt-4 space-y-2 text-stone-600">
        {c.diff.map((d) => (
          <li key={d} className="flex gap-2"><span className="text-emerald-700">✓</span><span>{d}</span></li>
        ))}
      </ul>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {VALUE_PROPS.map((v) => (
          <div key={v.title} className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="font-semibold text-stone-900">{v.title}</div>
            <p className="mt-1 text-sm text-stone-600">{v.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <h2 className="text-lg font-bold">Try the {c.name} alternative free</h2>
        <p className="mt-1 text-sm text-stone-600">No account, no card, no bot in your meeting. Open the app and record your next call.</p>
        <Link href="/app" className="mt-3 inline-block rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600">Open ParleyNotes →</Link>
      </div>

      <p className="mt-6 text-xs text-stone-600">Search demand (live Google Ads, US): {c.demand}. Comparison reflects each tool’s publicly described model.</p>
    </main>
  );
}
