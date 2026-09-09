import type { Metadata } from "next";
import Link from "next/link";
import { TOOLS } from "@ledgeur/mcp";
import { SITE } from "@/lib/site";
import { Badge, Card, Label } from "@ledgeur/ui/components";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";
import { CtaBlock } from "@/components/site/CtaBlock";

export const metadata: Metadata = {
  title: "Your meetings as company memory, for every agent you use",
  description:
    "Meetings are the highest-context thing a company produces, and the least reusable. Ledgeur opens them over MCP, so your agents read the record instead of guessing.",
  alternates: { canonical: `${SITE.url}/company-memory` },
};

export const revalidate = 604800;

export default function CompanyMemory() {
  return (
    <main>
      <PageHeader
        kicker="The context layer"
        title="The most useful thing your company knows was said out loud, and then lost."
        lede="Everything an agent needs to be useful about your work has already been discussed: why the architecture is like that, what the customer actually objected to, what was decided and quietly reversed. It was in a meeting. Nobody wrote it down, and the recording that did capture it sits in a vendor's cloud where nothing can read it."
      />

      <Section width="prose" pad="tight">
        <div className="space-y-4 text-md leading-relaxed text-muted">
          <p>
            Ledgeur was built to record meetings on your own machine. That is still what it does,
            and it is still the reason to install it. But a record nothing can read is an archive,
            and an archive is a place things go to stop being useful.
          </p>
          <p>
            So the record is open by design. Everything the app holds is reachable over the Model
            Context Protocol by the agents you already use, running as you, under the same
            row-level security that governs what you can see. An agent cannot read a meeting you
            could not.
          </p>
        </div>
      </Section>

      <Section width="narrow">
        <SectionHead
          kicker="What an agent can actually do"
          title={`${TOOLS.length} tools, and no scraping.`}
          lede="This list is generated from the code that implements it, on this page and on the agents page, so it cannot describe a tool that does not exist."
        />
        <Card className="mt-7 divide-y divide-hairline">
          {TOOLS.map((tool) => (
            <div key={tool.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3.5">
              <code className="font-mono text-sm font-medium text-brand-strong">{tool.name}</code>
              <span className="text-base text-muted">{tool.description}</span>
            </div>
          ))}
        </Card>
        <p className="mt-5 text-sm leading-relaxed text-faint">
          Same tools whether the agent connects over stdio on your own machine or to the hosted
          endpoint. <Link href="/agents" className="font-medium text-brand-strong hover:underline">How to connect one</Link>.
        </p>
      </Section>

      <Section tint width="narrow">
        <SectionHead
          kicker="Contextely"
          title="And when meetings should feed the whole company's memory."
          lede="Contextely is a context layer: it condenses what a company knows across Notion, Drive, Postgres and any MCP source into one searchable memory, scored by what the person asking is entitled to see. Ledgeur connects to it in both directions."
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <Label className="mb-2.5">Contextely into Ledgeur</Label>
            <p className="text-base leading-relaxed text-muted">
              Paste a personal Contextely key into Settings and asking Ledgeur a question reaches
              the company&rsquo;s memory alongside your own meetings. The key is validated and kept
              server-side, never on the device, the same as every other integration&rsquo;s secret.
            </p>
          </Card>
          <Card className="p-5">
            <Label className="mb-2.5">Ledgeur into Contextely</Label>
            <p className="text-base leading-relaxed text-muted">
              A Contextely admin adds Ledgeur as a source and it ingests over MCP, using the same{" "}
              <code className="font-mono text-sm">list_meetings</code> and{" "}
              <code className="font-mono text-sm">get_meeting</code> tools any agent uses. Nothing is
              pushed from Ledgeur; Contextely pulls and refreshes on its own schedule, under its own
              entitlement rules.
            </p>
          </Card>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-faint">
          Contextely is a separate product with its own pricing, and Ledgeur works perfectly well
          without it. It is listed here because &ldquo;meetings become memory a company can query&rdquo;
          is the whole point of this page, and that integration is the shipped version of it rather
          than a description of one.
        </p>
        <div className="mt-6">
          <a
            href="https://www.contextely.com"
            target="_blank"
            rel="noreferrer"
            className="text-base font-medium text-brand-strong hover:underline"
          >
            What Contextely is
          </a>
        </div>
      </Section>

      <Section width="narrow">
        <SectionHead
          title="Why this is a different bet from everyone else's."
          lede="The whole category is heading toward the same idea. The disagreement is about where the memory lives."
        />
        <div className="mt-7 space-y-4 text-md leading-relaxed text-muted">
          <p>
            The well-funded version of this is a vendor building a proprietary index of your
            company&rsquo;s conversations in their cloud, and selling you access to it. It works, and
            it produces exactly one company that can read your meetings and one company that can
            stop.
          </p>
          <p>
            Ledgeur&rsquo;s version keeps the transcription on your machine, the source under an MIT
            licence, the schema in a repository you can read, and the interface an open protocol
            rather than a private API. If the company disappears, the record keeps working, because
            it is local files and a Postgres schema you already have.
          </p>
          <p>
            That is not a better product by every measure and it is not meant to be. It is a
            different answer to the question of who owns the context, and it is the one worth
            building for a company that intends to still be able to read its own history in five
            years.
          </p>
        </div>
        <div className="mt-7 flex flex-wrap gap-2">
          <Badge tone="brand">Model Context Protocol</Badge>
          <Badge>MIT licensed</Badge>
          <Badge tone="accent">On-device transcription</Badge>
          <Badge>Self-hostable</Badge>
        </div>
      </Section>

      <Section tint width="narrow" pad="tight">
        <CtaBlock
          title="Start with one meeting"
          body="Record it, read it, then point Claude at it. The recording part is free forever; agent access is part of the Team plan."
        />
      </Section>
    </main>
  );
}
