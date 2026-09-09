import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { GUIDES } from "@/lib/guides";
import { Card } from "@ledgeur/ui/components";
import { PageHeader, Section } from "@/components/site/Chrome";

export const metadata: Metadata = {
  title: "Guides",
  description:
    "Three long guides: choosing an AI meeting assistant, running transcription privately on your own machine, and opening the meeting record to AI agents over MCP.",
  alternates: { canonical: `${SITE.url}/guides` },
};

export const revalidate = 604800;

export default function Guides() {
  return (
    <main>
      <PageHeader
        kicker="Guides"
        title="Three questions worth answering properly."
        lede="Longer than a blog post and written to be the last thing you need to read on the subject. Each one links down to the specific pieces underneath it."
      />

      <Section width="narrow" pad="tight">
        <div className="space-y-4">
          {GUIDES.map((g) => (
            <Link key={g.slug} href={`/guides/${g.slug}`} className="group block">
              <Card className="p-6 transition-colors group-hover:border-brand">
                <h2 className="text-xl font-semibold leading-snug text-ink-text">{g.headline}</h2>
                <p className="mt-2.5 text-base leading-relaxed text-muted">{g.lede}</p>
                <p className="mt-4 text-sm font-medium text-brand-strong">
                  {g.sections.length} sections · {g.cluster.length} linked articles
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </Section>
    </main>
  );
}
