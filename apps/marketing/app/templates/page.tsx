import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { TEMPLATES } from "@/lib/templates";
import { Card } from "@ledgeur/ui/components";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export const metadata: Metadata = {
  title: "Meeting notes templates: six free ones the app actually uses",
  description:
    "Free meeting notes templates for status meetings, 1:1s, standups, sales calls and user interviews. Copy the headings, or let Ledgeur fill them in from the recording.",
  alternates: { canonical: `${SITE.url}/templates` },
};

// Static content that changes when the product's templates change, which is
// rarely. A week is the right revalidation window and the cheapest thing this
// page can cost.
export const revalidate = 604800;

export default function Templates() {
  return (
    <main>
      <PageHeader
        kicker="Templates"
        title="Meeting notes templates you can copy, or have filled in for you."
        lede="These are not marketing templates. They are the six the app runs on: each one is a set of instructions the on-device model follows when it writes your notes, and it is published here as headings you can paste into a blank document and use by hand."
      />

      <Section width="narrow" pad="tight">
        <div className="grid gap-4 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <Link key={t.slug} href={`/templates/${t.slug}`} className="group">
              <Card className="flex h-full flex-col p-5 transition-colors group-hover:border-brand">
                <h2 className="text-lg font-semibold text-ink-text">{t.headline}</h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{t.template.description}</p>
                <span className="mt-4 text-sm font-medium text-brand-strong">
                  {t.headings.length} headings
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      <Section tint width="narrow">
        <SectionHead
          title="Why a template changes anything."
          lede="A sales call, a 1:1 and a user interview produce very different notes from the same conversation, and which one you wanted cannot be recovered afterwards. Saying so up front is the whole mechanism."
        />
        <div className="mt-8 space-y-4 text-md leading-relaxed text-muted">
          <p>
            Writing notes by hand, a template is a list of headings that stops you leaving out the
            thing you will need in three weeks. The 1:1 template asks what is blocking somebody
            because that is the answer nobody writes down and everybody needs.
          </p>
          <p>
            Inside Ledgeur the same template is a set of instructions handed to the model that reads
            your transcript. It does not change where the notes are stored or what they look like:
            you still get a summary, decisions, open questions and action items. It changes what the
            model goes looking for. A sales template hunts for objections and who has to approve; a
            standup template attributes every blocker to the person who raised it.
          </p>
          <p>
            If none of the six is your meeting, you can write your own inside the app. It is the
            same shape, so it runs through the identical path with nothing bolted on.
          </p>
        </div>
      </Section>

      <Section width="narrow" pad="tight">
        <CtaBlock
          title="Or stop filling them in"
          body="Record the meeting and Ledgeur writes the template out for you, on your own machine, with the speakers separated. Free for one person, permanently."
        />
      </Section>
    </main>
  );
}
