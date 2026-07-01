import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { USE_CASES, findUseCase } from "@/lib/usecases";
import { SITE } from "@/lib/site";

export function generateStaticParams() {
  return USE_CASES.map((u) => ({ slug: u.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const u = findUseCase(slug);
  if (!u) return {};
  const description = `${u.headline}. Private, on-device AI transcription and notes with ParleyNotes — free for individuals.`;
  return { title: u.headline, description, alternates: { canonical: `${SITE.url}/use-cases/${u.slug}` }, openGraph: { title: u.headline, description, type: "article", images: ["/opengraph-image"] } };
}

export default async function UseCasePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const u = findUseCase(slug);
  if (!u) notFound();

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-stone-600"><Link href="/use-cases" className="hover:text-stone-700">Use cases</Link> › {u.name}</nav>
      <h1 className="text-3xl font-extrabold tracking-tight">{u.headline}</h1>
      <p className="mt-4 text-stone-600">{u.why}</p>

      <h2 className="mt-10 text-2xl font-bold">What your notes capture</h2>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {u.captures.map((c) => (
          <li key={c} className="flex gap-2 rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-600"><span className="text-emerald-700">✓</span>{c}</li>
        ))}
      </ul>

      <div className="mt-10 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <h2 className="text-lg font-bold">Use ParleyNotes for {u.name.toLowerCase()}</h2>
        <p className="mt-1 text-sm text-stone-600">Free, private, on-device. Record or upload — your notes are ready in seconds.</p>
        <Link href="/app" className="mt-3 inline-block rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600">Open the app →</Link>
      </div>
    </main>
  );
}
