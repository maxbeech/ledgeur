import type { Metadata } from "next";
import Link from "next/link";
import { COMPETITORS } from "@/lib/competitors";
import { SITE } from "@/lib/site";
import { Card } from "@ledgeur/ui/components";
import { PageHeader, Section } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export const metadata: Metadata = {
  title: "Open-source alternatives to AI meeting notetakers",
  description:
    "Compare Ledgeur — the open-source, on-device AI meeting assistant with speaker separation — against Granola, Otter.ai, Fireflies, Fathom, tl;dv and more.",
  alternates: { canonical: `${SITE.url}/alternatives` },
};

export const revalidate = 604800;

export default function AlternativesIndex() {
  return (
    <main>
      <PageHeader
        kicker="Alternatives"
        title="A private, open alternative to every AI notetaker."
        lede="Most meeting-notes tools are closed source and upload your audio to their cloud. Ledgeur transcribes and separates speakers in your browser, and is MIT-licensed. Here is how it compares, without pretending the others are bad software."
      />
      <Section width="narrow">
        <div className="grid gap-3.5 sm:grid-cols-2">
          {COMPETITORS.map((competitor) => (
            <Link key={competitor.slug} href={`/alternatives/${competitor.slug}`} className="group block">
              <Card className="h-full p-5 transition-colors group-hover:border-accent">
                <h2 className="ldg-display text-[17px] text-ink-text">Ledgeur vs {competitor.name}</h2>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{competitor.what}</p>
                <span className="mt-3 inline-block text-[13px] font-medium text-accent-strong">Compare →</span>
              </Card>
            </Link>
          ))}
        </div>
        <CtaBlock />
      </Section>
    </main>
  );
}
