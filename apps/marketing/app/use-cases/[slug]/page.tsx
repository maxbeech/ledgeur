import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { USE_CASES, findUseCase } from "@/lib/usecases";
import { SITE } from "@/lib/site";
import { Card } from "@ledgeur/ui/components";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export function generateStaticParams() {
  return USE_CASES.map((u) => ({ slug: u.slug }));
}

export const revalidate = 604800;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const useCase = findUseCase(slug);
  if (!useCase) return {};
  const description = `${useCase.headline}. Private, on-device transcription with the speakers separated — free for individuals.`;
  return {
    title: useCase.headline,
    description,
    alternates: { canonical: `${SITE.url}/use-cases/${useCase.slug}` },
    openGraph: { title: useCase.headline, description, type: "article", images: ["/opengraph-image"] },
  };
}

export default async function UseCasePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const useCase = findUseCase(slug);
  if (!useCase) notFound();

  return (
    <main>
      <PageHeader kicker="Use case" title={useCase.headline} lede={useCase.why} />

      <Section width="narrow">
        <nav aria-label="Breadcrumb" className="mb-8 text-[13px] text-muted">
          <Link href="/use-cases" className="hover:text-ink-text">Use cases</Link>
          <span aria-hidden> › </span>
          <span className="text-faint">{useCase.name}</span>
        </nav>

        <SectionHead kicker="What you get" title="What the notes capture" />
        <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
          {useCase.captures.map((capture) => (
            <li key={capture}>
              <Card className="flex h-full gap-2.5 p-4 text-[13.5px] leading-relaxed text-ink-text">
                <span aria-hidden className="mt-[3px] shrink-0 text-accent-strong">✓</span>
                <span>{capture}</span>
              </Card>
            </li>
          ))}
        </ul>

        <CtaBlock
          title={`Use Ledgeur for ${useCase.name.toLowerCase()}`}
          body="Free, private, on-device, with the speakers separated. Record it or drag in a recording you already have."
        />
      </Section>
    </main>
  );
}
