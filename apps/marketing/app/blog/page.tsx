import type { Metadata } from "next";
import Link from "next/link";
import { POSTS } from "@/lib/posts";
import { SITE } from "@/lib/site";
import { GUIDES } from "@/lib/guides";
import { Card, Display, Label } from "@ledgeur/ui/components";
import { PageHeader, Section } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export const metadata: Metadata = {
  title: "Ledgeur blog: private meeting notes, transcription and speaker labels",
  description:
    "Every Ledgeur article in one place: how to transcribe Zoom and Meet calls, write meeting minutes, compare AI notetakers and keep recordings on your own device.",
  alternates: { canonical: `${SITE.url}/blog` },
};

// Written content changes rarely. Prerendered at build, revalidated weekly so an
// edit reaches the cache without a deploy — and served from the edge in between,
// which is the cheapest thing this page can be.
export const revalidate = 604800;

const when = (date: string) => new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function BlogIndex() {
  const [lead, ...rest] = POSTS;
  return (
    <main>
      <PageHeader
        title="Meetings, transcription, and keeping both private."
        lede="Practical writing about getting a usable record out of a conversation — and about why so much of the software for it sends your audio somewhere else."
      />
      <Section width="narrow" pad="tight">
        <p className="text-md leading-relaxed text-muted">
          Ledgeur records a meeting in your browser and works out who said what without uploading the audio anywhere.
          The articles below follow from that: how to get a usable transcript from Zoom, Meet or Teams, how to turn it
          into minutes and action items, how the on-device approach compares with cloud notetakers, and what to check
          before you trust any tool with a confidential call. Start with one of the three guides if you are not sure
          where to look, or scan the list by date.
        </p>
      </Section>
      {/* The pillars come first. Twenty-eight posts at one level is a pile;
          the three guides are the pages that say which pile to look in. */}
      <Section width="narrow" pad="tight">
        <Label className="mb-4">Start with a guide</Label>
        <div className="grid gap-3 sm:grid-cols-3">
          {GUIDES.map((g) => (
            <Link key={g.slug} href={`/guides/${g.slug}`} className="group">
              <Card className="h-full p-4 transition-colors group-hover:border-brand">
                <div className="text-base font-semibold leading-snug text-ink-text">{g.title}</div>
                <p className="mt-1.5 text-xs text-faint">{g.cluster.length} articles below it</p>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      <Section width="narrow" pad="tight">
        {lead && (
          <Link href={`/blog/${lead.slug}`} className="group block">
            <Card raised className="p-7 transition-colors group-hover:border-brand sm:p-9">
              <div className="text-sm text-faint"><time dateTime={lead.date}>{when(lead.date)}</time> · {lead.readMins} min read</div>
              <Display level={2} className="mt-3 text-2xl leading-tight sm:text-3xl">{lead.title}</Display>
              <p className="mt-3 max-w-2xl text-md leading-relaxed text-muted">{lead.description}</p>
            </Card>
          </Link>
        )}
        <div className="mt-8 divide-y divide-hairline">
          {rest.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="group flex flex-col gap-1 py-5 sm:flex-row sm:items-baseline sm:gap-6">
              <span className="w-32 shrink-0 text-sm text-faint"><time dateTime={post.date}>{when(post.date)}</time></span>
              <span className="min-w-0">
                <span className="block text-lg font-semibold leading-snug text-ink-text transition-colors group-hover:text-brand-strong">{post.title}</span>
                <span className="mt-1 block text-base leading-relaxed text-muted">{post.description}</span>
              </span>
            </Link>
          ))}
        </div>
        <CtaBlock />
      </Section>
    </main>
  );
}
