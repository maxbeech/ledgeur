import type { Metadata } from "next";
import Link from "next/link";
import { POSTS } from "@/lib/posts";
import { SITE } from "@/lib/site";
import { Card } from "@ledgeur/ui/components";
import { PageHeader, Section } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export const metadata: Metadata = {
  title: "Guides — AI meeting notes, transcription & privacy",
  description:
    "Guides on AI meeting notes, free meeting transcription, on-device privacy and choosing the right notetaker. From the Ledgeur team.",
  alternates: { canonical: `${SITE.url}/blog` },
};

// Written content changes rarely. Prerendered at build, revalidated weekly so an
// edit reaches the cache without a deploy — and served from the edge in between,
// which is the cheapest thing this page can be.
export const revalidate = 604800;

export default function BlogIndex() {
  return (
    <main>
      <PageHeader
        kicker="Guides"
        title="Meetings, transcription, and keeping both private."
        lede="Practical writing about getting a usable record out of a conversation — and about why so much of the software for it sends your audio somewhere else."
      />
      <Section width="narrow">
        <div className="grid gap-3.5">
          {POSTS.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="group block">
              <Card className="p-5 transition-colors group-hover:border-accent">
                <h2 className="ldg-display text-[18px] leading-snug text-ink-text">{post.title}</h2>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{post.description}</p>
                <div className="mt-2.5 font-mono text-[11px] text-faint">
                  <time dateTime={post.date}>
                    {new Date(post.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </time>
                  {" · "}{post.readMins} min read
                </div>
              </Card>
            </Link>
          ))}
        </div>
        <CtaBlock />
      </Section>
    </main>
  );
}
