import type { Metadata } from "next";
import Link from "next/link";
import { TOOLS } from "@ledgeur/mcp";
import { hostedEndpoint } from "@ledgeur/mcp";
import { SITE, TEAM_PRICE_USD } from "@/lib/site";
import { Badge, Card, buttonClass } from "@ledgeur/ui/components";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";

export const metadata: Metadata = {
  title: "Agent access — connect Claude or ChatGPT over MCP",
  description:
    "Point Claude, ChatGPT or Cursor at your meetings over MCP, and ask questions across everything your team has discussed.",
  alternates: { canonical: `${SITE.url}/agents` },
};

// The tool list is generated from the real definitions, so this page cannot
// document a tool that does not exist or miss one that does.
export const revalidate = 604800;

export default function Agents() {
  return (
    <main>
      <PageHeader
        kicker="Agent access"
        title="Let your AI read the meetings."
        lede="Ledgeur speaks the Model Context Protocol, so an agent can list your meetings, search them, read a full transcript with speakers, and pull the open action items — without you pasting anything."
      />

      <Section width="narrow">
        <SectionHead
          kicker="The tools"
          title="Four tools, generated from the code that implements them."
          lede="This list is built from the real tool definitions at build time, so it cannot describe something that does not exist."
        />
        <Card className="mt-7 divide-y divide-hairline">
          {TOOLS.map((tool) => (
            <div key={tool.name} className="px-5 py-4">
              <code className="font-mono text-[13px] text-glow-strong">{tool.name}</code>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{tool.description}</p>
            </div>
          ))}
        </Card>
      </Section>

      <Section width="prose" className="ldg-article !pt-4">
        <h2>Connecting</h2>
        <p>
          Generate a token on your <Link href="/account">account page</Link>, then give your MCP
          client one of these. The hosted endpoint is the one to prefer: there is nothing to
          install, and it works from a phone, a hosted agent or someone else&rsquo;s machine.
        </p>

        <h3>Hosted — nothing to run</h3>
        <pre><code>{JSON.stringify({
  mcpServers: {
    ledgeur: {
      type: "http",
      url: hostedEndpoint(SITE.url),
      headers: { Authorization: "Bearer ldg_your_token_here" },
    },
  },
}, null, 2)}</code></pre>

        <h3>Or run the server yourself</h3>
        <p>
          For clients that only speak stdio. This talks to the same database and exposes the same
          tools.
        </p>
        <pre><code>{`npx -y @ledgeur/mcp-server`}</code></pre>

        <h2>What an agent can see</h2>
        <p>
          Exactly what you can see, and nothing else. A token is exchanged for a short-lived session
          belonging to you, and every query runs under the database&rsquo;s row-level security. An
          agent cannot read a meeting you could not read, and it cannot read another
          workspace&rsquo;s meetings even if it asks.
        </p>
        <p>
          It also cannot see anything you have not synced. Meetings on the free plan live only in
          your browser, so there is nothing for an agent to connect to — which is the trade being
          made when you pay: the record becomes reachable, deliberately.
        </p>

        <h2>What it cannot do</h2>
        <ul>
          <li><strong>Write.</strong> Every tool is read-only. An agent cannot edit a transcript, rename a speaker, or delete a meeting.</li>
          <li><strong>Hear anything.</strong> Audio is never synced, so there is no recording for an agent to reach.</li>
          <li><strong>Identify a voice.</strong> Voice prints stay on the device that made them and are excluded from sync.</li>
        </ul>

        <h2>Things worth asking it</h2>
        <ul>
          <li>&ldquo;What did we decide about pricing, and when?&rdquo;</li>
          <li>&ldquo;What am I supposed to be doing after this week&rsquo;s meetings?&rdquo;</li>
          <li>&ldquo;Has this customer complaint come up before?&rdquo;</li>
          <li>&ldquo;Summarise everything said about the migration, in order.&rdquo;</li>
        </ul>
      </Section>

      <Section width="narrow" className="!pt-4 text-center">
        <Card raised className="p-8">
          <Badge tone="glow">Part of the Team plan</Badge>
          <p className="ldg-display mt-4 text-[22px] text-ink-text">
            ${TEAM_PRICE_USD} per person, per month.
          </p>
          <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-muted">
            Agent access comes with sync and the shared team library. Fourteen days free, and the
            local app stays free whatever you decide.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/pricing" className={buttonClass("primary", "md")}>See pricing</Link>
            <Link href="/account" className={buttonClass("secondary", "md")}>Generate a token</Link>
          </div>
        </Card>
      </Section>
    </main>
  );
}
