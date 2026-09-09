import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { GAPS, GAP_AREAS, gapsIn } from "@/lib/gaps";
import { Card, Label } from "@ledgeur/ui/components";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";

export const metadata: Metadata = {
  title: "What we don't have",
  description:
    "The complete list of what Ledgeur cannot do: no SOC 2, no SCIM, no BAA, no admin console, and the rest. Published in advance so nobody finds out during onboarding.",
  alternates: { canonical: `${SITE.url}/what-we-dont-have` },
};

export const revalidate = 604800;

export default function WhatWeDontHave() {
  return (
    <main>
      <PageHeader
        kicker="The whole list"
        title="What we don't have."
        lede="Buying software on the strength of a feature grid that turns out to be a roadmap is a miserable experience, and everybody in this category has had it. So here is the complete list, on its own page, with a link you can send to whoever runs your security review."
      />

      <Section width="prose" pad="tight">
        <div className="space-y-4 text-md leading-relaxed text-muted">
          <p>
            The rule on the other side of this is written into the code. The file that defines what
            each plan includes,{" "}
            <a href={`${SITE.repo}/blob/master/apps/marketing/lib/plans.ts`} target="_blank" rel="noreferrer">
              <code>lib/plans.ts</code>
            </a>
            , carries an instruction at the top saying nothing goes in a feature list unless it
            ships today, and a test that fails if it does. This page is the same rule pointed the
            other way: it may not leave anything out.
          </p>
          <p>
            None of this makes the on-device design less true. Your meeting audio is transcribed on
            your own machine and never reaches a server we run, and that is a stronger property than
            most of what is missing below. It is not a substitute for a certificate, and we will not
            pretend it is one.
          </p>
        </div>
      </Section>

      {GAP_AREAS.map((area) => {
        const gaps = gapsIn(area.id);
        if (gaps.length === 0) return null;
        return (
          <Section key={area.id} width="narrow" pad="tight">
            <SectionHead title={area.title} lede={area.lede} />
            <Card className="mt-6 divide-y divide-hairline">
              {gaps.map((gap) => (
                <div key={gap.title} className="px-5 py-4">
                  <div className="text-base font-semibold text-ink-text">{gap.title}</div>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{gap.body}</p>
                  {gap.evidence && (
                    <p className="mt-2 text-xs text-faint">
                      Check it yourself:{" "}
                      <a
                        href={`${SITE.repo}/blob/master/${gap.evidence}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono underline"
                      >
                        {gap.evidence}
                      </a>
                    </p>
                  )}
                </div>
              ))}
            </Card>
          </Section>
        );
      })}

      <Section tint width="narrow">
        <SectionHead
          title="If one of these is a blocker"
          lede="Say so. We would rather lose the evaluation now than during onboarding, and we will tell you honestly whether it is weeks away or not planned at all."
        />
        <div className="mt-7 flex flex-wrap gap-4 text-base">
          <Link href="/security" className="font-medium text-brand-strong hover:underline">
            How the security model works
          </Link>
          <Link href="/pricing" className="font-medium text-brand-strong hover:underline">
            What each plan does include
          </Link>
          <a href={SITE.repo} target="_blank" rel="noreferrer" className="font-medium text-brand-strong hover:underline">
            Read the source and check
          </a>
        </div>
        <p className="mt-8 text-sm text-faint">
          <Label as="span">{GAPS.length} items</Label>
        </p>
      </Section>
    </main>
  );
}
