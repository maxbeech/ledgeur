import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { POSTS, postBySlug } from "@/lib/posts";
import { SITE } from "@/lib/site";
import { PageHeader, Section } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export const revalidate = 604800;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = postBySlug(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `${SITE.url}/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.date,
      images: ["/opengraph-image"],
    },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = postBySlug(slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: { "@type": "Organization", name: SITE.name },
    publisher: { "@type": "Organization", name: SITE.name },
    mainEntityOfPage: `${SITE.url}/blog/${post.slug}`,
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PageHeader
        kicker={`${new Date(post.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · ${post.readMins} min read`}
        title={post.title}
        lede={post.description}
      />
      <Section width="prose">
        <nav aria-label="Breadcrumb" className="mb-8 text-[13px] text-muted">
          <Link href="/blog" className="hover:text-ink-text">Guides</Link>
          <span aria-hidden> › </span>
          <span className="text-faint">{post.title}</span>
        </nav>

        <article className="ldg-article">
          {post.body.map((block, i) => {
            if (block.type === "h2") return <h2 key={i}>{block.text}</h2>;
            if (block.type === "ul") {
              return <ul key={i}>{block.items.map((item, j) => <li key={j}>{item}</li>)}</ul>;
            }
            return <p key={i}>{block.text}</p>;
          })}
        </article>

        <CtaBlock />
      </Section>
    </main>
  );
}
