import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PLATFORMS, platformBySlug } from "@/lib/platforms";
import { SITE } from "@/lib/site";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export function generateStaticParams() {
  return PLATFORMS.map((p) => ({ slug: p.slug }));
}

export const revalidate = 604800;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const platform = platformBySlug(slug);
  if (!platform) return {};
  const title = `${platform.name} transcription — free, private and on-device`;
  const description = `How to transcribe ${platform.name} meetings for free with Ledgeur. On-device transcription with the speakers separated — no bot joins the call, nothing is uploaded.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE.url}/transcribe/${platform.slug}` },
    openGraph: { title, description, type: "article", images: ["/opengraph-image"] },
  };
}

export default async function PlatformPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const platform = platformBySlug(slug);
  if (!platform) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to transcribe a ${platform.name} meeting with Ledgeur`,
    step: platform.tips.map((tip, i) => ({ "@type": "HowToStep", position: i + 1, text: tip })),
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PageHeader
        kicker="Transcribe"
        title={`${platform.name} transcription, free and private`}
        lede={platform.how}
      />

      <Section width="narrow">
        <nav aria-label="Breadcrumb" className="mb-8 text-[13px] text-muted">
          <Link href="/transcribe" className="hover:text-ink-text">Transcribe</Link>
          <span aria-hidden> › </span>
          <span className="text-faint">{platform.name}</span>
        </nav>

        <SectionHead kicker="Step by step" title={`Recording a ${platform.name} meeting`} />
        <ol className="mt-6 space-y-4">
          {platform.tips.map((tip, i) => (
            <li key={tip} className="flex gap-4">
              <span className="ldg-display grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[13px] text-accent-strong">
                {i + 1}
              </span>
              <span className="mt-0.5 text-[14.5px] leading-relaxed text-ink-text">{tip}</span>
            </li>
          ))}
        </ol>

        <CtaBlock
          title={`Transcribe your next ${platform.name} call`}
          body="Free, private, with the speakers separated, and no bot in the participant list."
        />

        <p className="mt-8 text-[12px] text-faint">
          Search demand (live Google Ads, US): {platform.demand}.
        </p>
      </Section>
    </main>
  );
}
