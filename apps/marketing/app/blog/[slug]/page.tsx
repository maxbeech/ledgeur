import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { POSTS, postBySlug } from "@/lib/posts";
import { SITE } from "@/lib/site";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = postBySlug(slug);
  if (!p) return {};
  return {
    title: p.title,
    description: p.description,
    alternates: { canonical: `${SITE.url}/blog/${p.slug}` },
    openGraph: { title: p.title, description: p.description, type: "article", images: ["/opengraph-image"] },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = postBySlug(slug);
  if (!p) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: p.title,
    description: p.description,
    datePublished: p.date,
    author: { "@type": "Organization", name: SITE.name },
    mainEntityOfPage: `${SITE.url}/blog/${p.slug}`,
  };

  return (
    <article className="mx-auto max-w-2xl px-5 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-stone-600"><Link href="/blog" className="hover:text-stone-700">Guides</Link> › {p.title}</nav>
      <h1 className="text-3xl font-bold tracking-tight text-stone-900">{p.title}</h1>
      <div className="mt-2 text-xs text-stone-600">{p.date} · {p.readMins} min read</div>

      <div className="mt-6 space-y-4">
        {p.body.map((b, i) => {
          if (b.type === "h2") return <h2 key={i} className="mt-6 text-xl font-bold text-stone-900">{b.text}</h2>;
          if (b.type === "ul")
            return (
              <ul key={i} className="space-y-1.5 text-stone-600">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-2"><span className="text-emerald-700">•</span><span>{it}</span></li>
                ))}
              </ul>
            );
          return <p key={i} className="leading-relaxed text-stone-600">{b.text}</p>;
        })}
      </div>

      <div className="mt-10 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <h2 className="text-lg font-bold text-stone-900">Try private AI meeting notes free</h2>
        <p className="mt-1 text-sm text-stone-600">Record or upload a meeting and get an on-device transcript and notes. No account, no bot, no cloud.</p>
        <Link href="/app" className="mt-3 inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600">Open ParleyNotes →</Link>
      </div>
    </article>
  );
}
