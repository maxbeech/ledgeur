import type { Metadata } from "next";
import Link from "next/link";
import { SITE, TEAM_PRICE_USD } from "@/lib/site";
import { Display, buttonClass } from "@ledgeur/ui/components";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";

export const metadata: Metadata = {
  title: "Open source — read it, run it, keep it",
  description:
    "Ledgeur is MIT-licensed and self-hostable. Transcription and speaker separation run in your browser, the source is public, and the free plan is the whole product.",
  alternates: { canonical: `${SITE.url}/open-source` },
};

export const revalidate = 604800;

// Written as questions people actually ask, and answered without dodging. The
// self-hosting answer in particular used to advertise a "supported Docker/Helm
// bundle, SSO/SAML, an admin console and an SLA" — none of which exists.
const FAQS: readonly [string, string][] = [
  [
    "Is Ledgeur really open source?",
    "Yes, under the MIT licence — the permissive one. You can read it, fork it, audit it, run it inside your company and build a product on it, without asking us and without paying us.",
  ],
  [
    "Where does the transcription actually happen?",
    "In your browser. Whisper is downloaded once from the Hugging Face CDN and then runs on your own device through WebGPU, or WebAssembly if there is no WebGPU. The speaker models work the same way. There is no upload endpoint for audio in this product — open your browser's network tab during a recording and check.",
  ],
  [
    "What is the catch with “free”?",
    `There is not one for a single person. The expensive part runs on your machine, so one person using Ledgeur costs us essentially nothing. We charge $${TEAM_PRICE_USD} per person per month when you want the record to leave your device — synced across your devices, shared with a team, and readable by your AI agents. Those cost us hosting, so they cost you money.`,
  ],
  [
    "Can I self-host it instead of paying?",
    "Yes, and you do not need our permission — that is what MIT means. The database schema is in the repository and the app is a Vite build. To be straight with you: there is no Docker image and no Helm chart, so this is currently a manual job for somebody comfortable with Supabase. The Enterprise tier is us helping you do it and supporting it afterwards, not us granting a right you already have.",
  ],
  [
    "Does a bot join my meeting?",
    "No. Ledgeur captures the meeting tab's audio through your browser, the same way you hear it. Nothing appears in the participant list — which also means the people in the call will not know they are being recorded unless you tell them. Please tell them.",
  ],
  [
    "What happens if you go out of business?",
    "The free app keeps working: once the models are cached it needs nothing from us, and your meetings are already on your machine. The source is public, so a paid deployment can be taken over and self-hosted. We would give at least 60 days' notice before shutting down hosted sync.",
  ],
];

export default function OpenSource() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PageHeader
        kicker="Open source"
        title="Open by design, not as a marketing position."
        lede="Meeting notes are among the most sensitive things a company produces — strategy, hiring, deals, one-to-ones. Closed notetakers ask you to upload all of it. Ledgeur takes the opposite position: the code is public, and the audio never leaves your machine."
      />

      <Section width="narrow">
        <div className="flex flex-wrap gap-3">
          <a href={SITE.repo} target="_blank" rel="noreferrer" className={buttonClass("primary", "md")}>
            Read the source on GitHub
          </a>
          <Link href="/app" className={buttonClass("secondary", "md")}>Open Ledgeur</Link>
        </div>

        <div className="mt-16">
          <SectionHead kicker="Questions" title="Asked and answered." />
          <div className="mt-8 space-y-8">
            {FAQS.map(([question, answer]) => (
              <div key={question}>
                <Display level={3} className="text-[17px]">{question}</Display>
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{answer}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </main>
  );
}
