import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { COMPETITORS, competitorBySlug } from "@/lib/competitors";
import { VALUE_PROPS, SITE } from "@/lib/site";
import { Card } from "@ledgeur/ui/components";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export function generateStaticParams() {
  return COMPETITORS.map((c) => ({ slug: c.slug }));
}

export const revalidate = 604800;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const competitor = competitorBySlug(slug);
  if (!competitor) return {};
  const title = `${competitor.name} alternative — open source, and it never uploads your audio`;
  const description = `Looking for a ${competitor.name} alternative? Ledgeur transcribes and separates speakers on your own device — no cloud upload, no bot in the call, free for individuals.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE.url}/alternatives/${competitor.slug}` },
    openGraph: { title, description, type: "article", images: ["/opengraph-image"] },
  };
}

export default async function AlternativePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const competitor = competitorBySlug(slug);
  if (!competitor) notFound();

  return (
    <main>
      <PageHeader
        kicker="Alternatives"
        title={`The open-source ${competitor.name} alternative`}
        lede={`${competitor.name} ${competitor.what} Ledgeur does the same core job — an accurate transcript and notes you can act on — but as open-source software that runs in your browser, so the audio never leaves your machine.`}
      />

      <Section width="narrow">
        <nav aria-label="Breadcrumb" className="mb-8 text-[13px] text-muted">
          <Link href="/alternatives" className="hover:text-ink-text">Alternatives</Link>
          <span aria-hidden> › </span>
          <span className="text-faint">{competitor.name}</span>
        </nav>

        <Card className="p-5">
          <div className="ldg-kicker">How {competitor.name} works today</div>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">{competitor.model}</p>
        </Card>

        <div className="mt-12">
          <SectionHead kicker="The differences" title={`Where Ledgeur differs from ${competitor.name}`} />
          <ul className="mt-6 space-y-3">
            {competitor.diff.map((point) => (
              <li key={point} className="flex gap-3 text-[14.5px] leading-relaxed text-ink-text">
                <span aria-hidden className="mt-[3px] text-accent-strong">✓</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-12 grid gap-3.5 sm:grid-cols-2">
          {VALUE_PROPS.map((prop) => (
            <Card key={prop.title} className="p-5">
              <h3 className="ldg-display text-[16px] text-ink-text">{prop.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{prop.body}</p>
            </Card>
          ))}
        </div>

        <CtaBlock
          title={`Try the ${competitor.name} alternative`}
          body="No account, no card, and no bot in your meeting. Open it and record your next call — or drag in one you already have."
        />

        <p className="mt-8 text-[12px] leading-relaxed text-faint">
          Search demand (live Google Ads, US): {competitor.demand}. The comparison reflects each
          tool&rsquo;s publicly described model at the time of writing, not a judgement about its
          quality — {competitor.name} is good software that made a different architectural choice.
        </p>
      </Section>
    </main>
  );
}
