import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GUIDES, guideBySlug } from "@/lib/guides";
import { postBySlug } from "@/lib/posts";
import { SITE } from "@/lib/site";
import { Card, Label } from "@ledgeur/ui/components";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export const revalidate = 604800;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) return {};
  return {
    title: guide.title,
    description: guide.lede.slice(0, 200),
    alternates: { canonical: `${SITE.url}/guides/${guide.slug}` },
    openGraph: { title: guide.title, description: guide.lede.slice(0, 200), type: "article", images: ["/opengraph-image"] },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) notFound();

  // A pillar's cluster is a list of slugs. Resolving them here rather than
  // storing titles twice means a renamed post shows its new title, and a
  // deleted one drops out instead of becoming a broken link.
  const cluster = guide.cluster.flatMap((s) => {
    const post = postBySlug(s);
    return post ? [post] : [];
  });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: guide.lede,
    author: { "@type": "Organization", name: SITE.name },
    publisher: { "@type": "Organization", name: SITE.name },
    mainEntityOfPage: `${SITE.url}/guides/${guide.slug}`,
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PageHeader kicker="Guide" title={guide.headline} lede={guide.lede} />

      <Section width="prose">
        <nav aria-label="Breadcrumb" className="mb-8 text-sm text-muted">
          <Link href="/guides" className="hover:text-ink-text">Guides</Link>
          <span aria-hidden> › </span>
          <span className="text-faint">{guide.keyword}</span>
        </nav>

        <article className="ldg-article">
          {guide.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.body.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
            </section>
          ))}
        </article>
      </Section>

      {guide.pages.length > 0 && (
        <Section width="narrow" pad="tight">
          <Label className="mb-4">Rather than reading about it</Label>
          <div className="flex flex-wrap gap-2">
            {guide.pages.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="rounded-full border border-hairline px-4 py-2 text-sm font-medium text-ink-text transition-colors hover:border-brand"
              >
                {label}
              </Link>
            ))}
          </div>
        </Section>
      )}

      {cluster.length > 0 && (
        <Section tint width="narrow">
          <SectionHead
            title="Going deeper"
            lede="The specific questions underneath this one."
          />
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            {cluster.map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="group">
                <Card className="flex h-full flex-col p-4 transition-colors group-hover:border-brand">
                  <div className="text-base font-semibold leading-snug text-ink-text">{post.title}</div>
                  <p className="mt-1.5 line-clamp-2 flex-1 text-sm leading-relaxed text-muted">{post.description}</p>
                  <span className="mt-3 text-xs text-faint">{post.readMins} min read</span>
                </Card>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section width="narrow" pad="tight">
        <div className="mb-10 flex flex-wrap gap-4 text-base">
          {GUIDES.filter((g) => g.slug !== guide.slug).map((g) => (
            <Link key={g.slug} href={`/guides/${g.slug}`} className="font-medium text-brand-strong hover:underline">
              {g.title}
            </Link>
          ))}
        </div>
        <CtaBlock
          title="Try it on one real meeting"
          body="Free for one person, permanently. Nothing is uploaded, and no account is needed to record."
        />
      </Section>
    </main>
  );
}
