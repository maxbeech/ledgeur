import type { Metadata } from "next";
import Link from "next/link";
import { PLATFORMS } from "@/lib/platforms";
import { SITE } from "@/lib/site";
import { Card } from "@ledgeur/ui/components";
import { PageHeader, Section } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export const metadata: Metadata = {
  title: "Transcribe any meeting — Zoom, Google Meet, Teams & more",
  description:
    "Free, private transcription for Zoom, Google Meet, Teams, Webex and more — with the speakers separated, in your browser. No bot, no upload.",
  alternates: { canonical: `${SITE.url}/transcribe` },
};

export const revalidate = 604800;

export default function TranscribeIndex() {
  return (
    <main>
      <PageHeader
        kicker="Transcribe"
        title="Transcribe any meeting, privately."
        lede="Whichever platform your meeting runs on, Ledgeur captures the tab's audio and builds the transcript on your device — with the speakers separated. Nobody joins the call, and nothing is uploaded."
      />
      <Section width="narrow">
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORMS.map((platform) => (
            <Link key={platform.slug} href={`/transcribe/${platform.slug}`} className="group block">
              <Card className="h-full p-5 transition-colors group-hover:border-accent">
                <h2 className="ldg-display text-[16px] text-ink-text">{platform.name}</h2>
                <span className="mt-2 inline-block text-[13px] font-medium text-accent-strong">How to →</span>
              </Card>
            </Link>
          ))}
        </div>
        <CtaBlock />
      </Section>
    </main>
  );
}
