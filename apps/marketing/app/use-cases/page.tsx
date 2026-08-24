import type { Metadata } from "next";
import Link from "next/link";
import { USE_CASES } from "@/lib/usecases";
import { SITE } from "@/lib/site";
import { Card } from "@ledgeur/ui/components";
import { PageHeader, Section } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export const metadata: Metadata = {
  title: "AI meeting notes for every kind of meeting",
  description:
    "Private meeting notes for sales calls, interviews, standups, 1:1s, hiring and more — transcribed on your device, with the speakers separated.",
  alternates: { canonical: `${SITE.url}/use-cases` },
};

export const revalidate = 604800;

export default function UseCasesIndex() {
  return (
    <main>
      <PageHeader
        kicker="Use cases"
        title="Notes for every kind of meeting."
        lede="However you meet, Ledgeur turns it into a record you can search — with who said what, on your own device."
      />
      <Section width="narrow">
        <div className="grid gap-3.5 sm:grid-cols-2">
          {USE_CASES.map((useCase) => (
            <Link key={useCase.slug} href={`/use-cases/${useCase.slug}`} className="group block">
              <Card className="h-full p-5 transition-colors group-hover:border-accent">
                <h2 className="ldg-display text-[16px] text-ink-text">{useCase.name}</h2>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{useCase.headline}</p>
              </Card>
            </Link>
          ))}
        </div>
        <CtaBlock />
      </Section>
    </main>
  );
}
