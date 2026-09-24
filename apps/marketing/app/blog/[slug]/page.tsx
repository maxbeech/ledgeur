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
    keywords: [post.keyword, ...(post.supportingKeywords ?? []), ...(post.longTailKeywords ?? [])],
    alternates: { canonical: `${SITE.url}/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.date,
      images: [{ url: "/opengraph-image", alt: post.featuredImageAlt ?? `${post.title} — ${SITE.name}` }],
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description, images: ["/opengraph-image"] },
  };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = postBySlug(slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    ...(post.updated ? { dateModified: post.updated } : {}),
    author: { "@type": "Organization", name: SITE.name },
    publisher: { "@type": "Organization", name: SITE.name },
    mainEntityOfPage: `${SITE.url}/blog/${post.slug}`,
  };
  const structuredData: Record<string, unknown>[] = [jsonLd];
  if (post.schemaTypes?.includes("FAQPage") && post.faqs) {
    structuredData.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: post.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
    });
  }
  if (post.schemaTypes?.includes("HowTo")) {
    structuredData.push({
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: post.title,
      step: post.body.filter((block) => block.type === "ol").flatMap((block) => block.items.map((text) => ({ "@type": "HowToStep", text }))),
    });
  }

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <PageHeader
        kicker={`${post.updated ? "Updated " : "Published "}${new Date(post.updated ?? post.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · ${post.readMins} min read`}
        title={post.title}
        lede={post.description}
      />
      <Section width="prose">
        <nav aria-label="Breadcrumb" className="mb-8 text-sm text-muted">
          <Link href="/blog" className="hover:text-ink-text">Guides</Link>
          <span aria-hidden> › </span>
          <span className="text-faint">{post.title}</span>
        </nav>

        <article className="ldg-article">
          {post.category && <p className="ldg-eyebrow">{post.category}</p>}
          {post.body.some((block) => block.type === "h2") && (
            <nav className="ldg-toc" aria-label="On this page">
              <strong>On this page</strong>
              <ol>{post.body.filter((block) => block.type === "h2").map((block) => <li key={block.text}>{block.text}</li>)}</ol>
            </nav>
          )}
          {post.body.map((block, i) => {
            if (block.type === "h2") return <h2 key={i}>{block.text}</h2>;
            if (block.type === "h3") return <h3 key={i}>{block.text}</h3>;
            if (block.type === "ul") {
              return <ul key={i}>{block.items.map((item, j) => <li key={j}>{item}</li>)}</ul>;
            }
            if (block.type === "ol") return <ol key={i}>{block.items.map((item, j) => <li key={j}>{item}</li>)}</ol>;
            if (block.type === "quote") return <blockquote key={i}><p>{block.text}</p><cite><a href={block.href}>{block.attribution}</a></cite></blockquote>;
            if (block.type === "callout") return <aside key={i} className="ldg-callout"><strong>{block.title}</strong><p>{block.text}</p></aside>;
            if (block.type === "table") return <figure key={i} className="ldg-table"><table><thead><tr>{block.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table><figcaption>{block.caption}</figcaption></figure>;
            if (block.type === "links") return <aside key={i} className="ldg-links"><strong>{block.label}</strong><ul>{block.links.map((link) => <li key={link.href}><a href={link.href}>{link.label}</a></li>)}</ul></aside>;
            return <p key={i}>{block.text}</p>;
          })}
          {post.faqs && <section aria-labelledby="faq"><h2 id="faq">Frequently asked questions</h2>{post.faqs.map((faq) => <div key={faq.question}><h3>{faq.question}</h3><p>{faq.answer}</p></div>)}</section>}
          {post.sources && post.sources.length > 0 && <section aria-labelledby="sources"><h2 id="sources">Authoritative references</h2><ul>{post.sources.map((source) => <li key={source.href}><a href={source.href}>{source.label}</a></li>)}</ul></section>}
        </article>

        <CtaBlock />
      </Section>
    </main>
  );
}
