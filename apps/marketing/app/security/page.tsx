import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { DATA_FACTS, POLICY_UPDATED_LABEL } from "@/lib/legal";
import { Card } from "@ledgeur/ui/components";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";
import EmailLink from "@/components/EmailLink";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How Ledgeur is built to keep meetings private: on-device models, row-level security on every table, scoped access tokens, and an honest list of what we do not have.",
  alternates: { canonical: `${SITE.url}/security` },
};

export const revalidate = 604800;

export default function Security() {
  return (
    <main>
      <PageHeader
        kicker={`Last reviewed ${POLICY_UPDATED_LABEL}`}
        title="Security"
        lede="The strongest security property a meeting recorder can have is not holding the recording. That is the design here, and everything below follows from it."
      />

      <Section width="narrow">
        <SectionHead kicker="The architecture" title="What the design guarantees." />
        <Card className="mt-7 divide-y divide-hairline">
          {DATA_FACTS.map((fact) => (
            <div key={fact.claim} className="px-5 py-4">
              <p className="text-[14.5px] font-medium text-ink-text">{fact.claim}</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{fact.because}</p>
            </div>
          ))}
        </Card>
      </Section>

      <Section width="prose" className="ldg-article !pt-4">
        <h2>Row-level security, not application checks</h2>
        <p>
          Every table in the synced database has row-level security enabled and explicit policies.
          Requests run as an authenticated user, never as a service role, so the database itself
          decides what comes back. A missing <code>.eq()</code> in application code cannot leak
          another workspace&rsquo;s meetings, because the query would return nothing.
        </p>
        <p>
          This applies to agent access too. An access token is exchanged for a short-lived session
          belonging to its owner; the endpoint has no privileges of its own. An agent can read
          exactly what you can read.
        </p>

        <h2>Access tokens</h2>
        <p>
          A token is 256 bits of randomness. Only its SHA-256 is stored, so the plaintext is shown
          once and cannot be recovered — if you lose it, you generate another and revoke the old
          one. Revocation is immediate. An unknown token and a revoked token get the same error, so
          the endpoint does not confirm that a token was once real.
        </p>

        <h2>What we do not have</h2>
        <p>
          Publishing this list is more useful than publishing a badge:
        </p>
        <ul>
          <li><strong>No SOC 2 or ISO 27001.</strong> We have not been audited. If your procurement process requires it, we cannot pass it today.</li>
          <li><strong>No SSO, SAML or SCIM.</strong> Sign-in is email and password.</li>
          <li><strong>No admin audit log.</strong> Access tokens record when they were last used, and that is the extent of it.</li>
          <li><strong>No bug bounty programme.</strong> We will thank you properly and credit you, but we cannot pay.</li>
          <li><strong>No penetration test report.</strong> None has been commissioned.</li>
        </ul>
        <p>
          None of that makes the on-device design less true. It does mean that if your risk process
          depends on certifications, we are not there yet, and we would rather you knew before a
          procurement call than during one.
        </p>

        <h2>Reporting a vulnerability</h2>
        <p>
          <EmailLink label="Email us" subject="Security report" className="font-medium text-accent-strong underline" />{" "}
          with enough detail to reproduce it. We will acknowledge within three working days and tell
          you what we are doing. Please do not open a public issue for anything exploitable until
          there is a fix.
        </p>
        <p>
          The source is <a href={SITE.repo} target="_blank" rel="noreferrer">public</a>, so you are
          welcome to look. Testing against your own data and your own deployment is fine; testing
          against other people&rsquo;s is not.
        </p>

        <h2>Also worth reading</h2>
        <p>
          The <Link href="/privacy">privacy notice</Link> covers what is collected, and the{" "}
          <Link href="/agents">agent access page</Link> covers what a connected AI tool can and
          cannot see.
        </p>
      </Section>
    </main>
  );
}
