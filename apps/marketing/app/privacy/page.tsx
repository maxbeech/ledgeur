import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { DATA_FACTS, DATA_COLLECTED, POLICY_UPDATED, POLICY_UPDATED_LABEL } from "@/lib/legal";
import { Card } from "@ledgeur/ui/components";
import { PageHeader, Section } from "@/components/site/Chrome";
import EmailLink from "@/components/EmailLink";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What Ledgeur does and does not collect. Audio and voice prints never leave your device; only meetings you choose to sync are stored, behind row-level security.",
  alternates: { canonical: `${SITE.url}/privacy` },
};

// Policy text changes rarely. Prerendered, revalidated weekly so an edit reaches
// the cache without a deploy.
export const revalidate = 604800;

export default function Privacy() {
  return (
    <main>
      <PageHeader
        kicker={`Last reviewed ${POLICY_UPDATED_LABEL}`}
        title="Privacy"
        lede="Most privacy policies describe what a company promises not to do. This one mostly describes what the software cannot do, which is a stronger guarantee — and every claim names the code that makes it true."
      />

      <Section width="prose" className="ldg-article !py-14">
        <h2>The short version</h2>
        <p>
          On the free plan, Ledgeur does not have your data. Not encrypted, not anonymised — it
          never reaches us. Your audio is transcribed by models running inside your browser, and the
          result is stored in your browser. There is no account, so there is nothing to associate it
          with.
        </p>
        <p>
          On the paid plan you choose to sync meetings to a database so they reach your other
          devices and your workspace. That is a deliberate act, per meeting, and it is the only
          thing that changes.
        </p>

        <h2>What is true, and why</h2>
      </Section>

      <Section width="narrow" className="!pt-0">
        <Card className="divide-y divide-hairline">
          {DATA_FACTS.map((fact) => (
            <div key={fact.claim} className="px-5 py-4">
              <p className="text-[14.5px] font-medium text-ink-text">{fact.claim}</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{fact.because}</p>
            </div>
          ))}
        </Card>
        <p className="mt-4 text-[13px] text-faint">
          All of this is checkable: the source is{" "}
          <a href={SITE.repo} target="_blank" rel="noreferrer" className="text-accent-strong hover:underline">
            public
          </a>
          , and you can watch your browser&rsquo;s network tab while you record.
        </p>
      </Section>

      <Section width="prose" className="ldg-article !pt-4">
        <h2>What we collect</h2>
        <ul>
          {DATA_COLLECTED.map((row) => (
            <li key={row.what}>
              <strong>{row.what}</strong> — {row.when} {row.why}
            </li>
          ))}
        </ul>
        <p>
          That is the complete list. There is no analytics script on this site, no advertising
          pixel, no session recorder and no third-party tag manager.
        </p>

        <h2>Who else is involved</h2>
        <p>
          Three companies process data on our behalf, and only on the paid plan:
        </p>
        <ul>
          <li><strong>Supabase</strong> — the database and authentication behind sync.</li>
          <li><strong>Stripe</strong> — payments. Card details go directly to Stripe and never touch our servers.</li>
          <li><strong>Vercel</strong> — hosting for this website and the agent endpoint.</li>
        </ul>
        <p>
          One more is involved even on the free plan, and it matters that you know: the first time
          you record, your browser downloads the speech and speaker models from{" "}
          <strong>Hugging Face&rsquo;s CDN</strong>. That request tells Hugging Face your IP address
          and which model you asked for. It contains none of your audio, and it happens once — after
          that the models are cached and Ledgeur works offline.
        </p>

        <h2>How long things are kept</h2>
        <p>
          Local meetings are kept until you delete them or clear your browser storage — we cannot
          delete them for you, because we cannot see them. Synced meetings are kept until you delete
          them or close your account, after which they are removed within 30 days.
        </p>

        <h2>Your rights</h2>
        <p>
          If you are in the UK or the EU, you have the right to access, correct, export and erase
          personal data we hold, and to object to processing. In practice, for Ledgeur, this is
          usually simpler than the law expects: on the free plan we hold nothing, and on the paid
          plan every meeting can be exported from the app and deleted from it.
        </p>
        <p>
          To make a request, or to complain about how we have handled one,{" "}
          <EmailLink label="email us" subject="Privacy request" className="font-medium text-accent-strong underline" />.
          You may also complain to your local supervisory authority — in the UK, the Information
          Commissioner&rsquo;s Office.
        </p>

        <h2>Children</h2>
        <p>
          Ledgeur is not intended for people under 16, and we do not knowingly hold their data.
        </p>

        <h2>Recording other people</h2>
        <p>
          This is your responsibility, not ours, and it is worth stating plainly. In many places it
          is unlawful to record a conversation without the consent of the people in it, and the
          rules differ by country and by state. Ledgeur does not announce itself in a meeting —
          deliberately, because a bot in the participant list is exactly what people dislike about
          the alternatives — which means telling people they are being recorded is on you. Please
          do.
        </p>

        <h2>Changes</h2>
        <p>
          If this notice changes materially we will say so on the{" "}
          <Link href="/changelog">changelog</Link>. The date at the top is when it was last
          reviewed.
        </p>
      </Section>
    </main>
  );
}
