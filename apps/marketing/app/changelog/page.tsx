import type { Metadata } from "next";
import { SITE } from "@/lib/site";
import { RELEASES } from "@/lib/changelog";
import { Badge, Display } from "@ledgeur/ui/components";
import { PageHeader, Section } from "@/components/site/Chrome";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What has changed in Ledgeur, in the order it changed.",
  alternates: { canonical: `${SITE.url}/changelog` },
};

export const revalidate = 604800;

const TONE = { new: "accent", fixed: "brand", changed: "neutral" } as const;
const LABEL = { new: "New", fixed: "Fixed", changed: "Changed" } as const;

export default function Changelog() {
  return (
    <main>
      <PageHeader
        title="What has changed."
        lede="Only things you would notice. Bug fixes are described as bugs, including the embarrassing ones — a changelog that only ever announces features is a marketing page wearing a disguise."
      />

      <Section width="narrow" pad="tight">
        <ol className="space-y-14">
          {RELEASES.map((release) => (
            <li key={release.date} className="grid gap-4 sm:grid-cols-[160px_1fr]">
              <time dateTime={release.date} className="pt-1 text-sm text-faint">
                {new Date(release.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              </time>
              <div>
                <Display level={2} className="text-2xl leading-tight">{release.title}</Display>
                <ul className="mt-5 space-y-3.5">
                  {release.changes.map((change) => (
                    <li key={change.text} className="flex flex-col gap-1.5 sm:flex-row sm:gap-3">
                      <span className="shrink-0 sm:w-20">
                        <Badge tone={TONE[change.kind]}>{LABEL[change.kind]}</Badge>
                      </span>
                      <span className="text-md leading-relaxed text-muted">{change.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </Section>
    </main>
  );
}
