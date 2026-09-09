import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE } from "@/lib/site";
import { TEMPLATES, templateBySlug, templateMarkdown } from "@/lib/templates";
import { Card, Label } from "@ledgeur/ui/components";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export function generateStaticParams() {
  return TEMPLATES.map((t) => ({ slug: t.slug }));
}

export const revalidate = 604800;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = templateBySlug(slug);
  if (!t) return {};
  const description = `A free ${t.template.name.toLowerCase()} template: ${t.headings.length} headings to copy, and what to write under each. Or record the meeting and have it filled in on your own machine.`;
  return {
    title: t.headline,
    description,
    alternates: { canonical: `${SITE.url}/templates/${t.slug}` },
    openGraph: { title: t.headline, description, type: "article", images: ["/opengraph-image"] },
  };
}

export default async function TemplatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = templateBySlug(slug);
  if (!t) notFound();

  // The copyable version, rendered as text rather than offered as a download.
  // A download link from a static page is a file somebody has to find again;
  // a code block is selectable everywhere, including on a phone.
  const markdown = templateMarkdown(t);

  return (
    <main>
      <PageHeader kicker="Template" title={t.headline} lede={t.why} />

      <Section width="narrow">
        <nav aria-label="Breadcrumb" className="mb-8 text-sm text-muted">
          <Link href="/templates" className="hover:text-ink-text">Templates</Link>
          <span aria-hidden> › </span>
          <span className="text-faint">{t.template.name}</span>
        </nav>

        <SectionHead kicker="The headings" title="What goes in it" />
        <Card className="mt-6 divide-y divide-hairline">
          {t.headings.map((heading, i) => (
            <div key={heading} className="flex gap-4 px-5 py-4">
              <span className="ldg-num mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand-strong">
                {i + 1}
              </span>
              <span className="text-base leading-relaxed text-ink-text">{heading}</span>
            </div>
          ))}
        </Card>

        <div className="mt-10">
          <Label className="mb-3">Copy it as Markdown</Label>
          <pre className="overflow-x-auto rounded-xl border border-hairline bg-paper p-5 font-mono text-sm leading-relaxed text-ink-text">
            {markdown}
          </pre>
        </div>

        {/* What the same template does inside the product. This is the bridge
            from "I came for a document" to "the document could write itself",
            and it has to be specific to be worth reading. */}
        {t.template.looksFor.length > 0 && (
          <div className="mt-14">
            <SectionHead
              kicker="The same template, automatic"
              title="What Ledgeur goes looking for"
              lede="Choose this template before you record and the on-device model reads the transcript against exactly this list."
            />
            <ul className="mt-6 space-y-2.5">
              {t.template.looksFor.map((item) => (
                <li key={item} className="flex gap-3 text-base leading-relaxed text-muted">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm leading-relaxed text-faint">
              Everything it finds still lands in the same four places: a summary, the decisions, the
              open questions and the action items. The template changes what it looks for, not the
              shape of the record, so notes from every kind of meeting stay searchable together.
            </p>
          </div>
        )}

        <div className="mt-14">
          <Label className="mb-3">Other templates</Label>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.filter((o) => o.slug !== t.slug).map((o) => (
              <Link
                key={o.slug}
                href={`/templates/${o.slug}`}
                className="rounded-full border border-hairline px-3.5 py-1.5 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-ink-text"
              >
                {o.template.name}
              </Link>
            ))}
          </div>
        </div>

        <CtaBlock
          title="Have it filled in instead"
          body="Record the meeting and Ledgeur writes these sections from what was said, with the speakers separated, on your own machine. Free for one person, permanently."
        />
      </Section>
    </main>
  );
}
