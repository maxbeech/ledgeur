import type { Metadata } from "next";
import Link from "next/link";
import { SITE, TEAM_PRICE_USD } from "@/lib/site";
import { POLICY_UPDATED_LABEL } from "@/lib/legal";
import { PageHeader, Section } from "@/components/site/Chrome";
import EmailLink from "@/components/EmailLink";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms of using Ledgeur: the software licence, the subscription, cancellation and refunds.",
  alternates: { canonical: `${SITE.url}/terms` },
};

export const revalidate = 604800;

export default function Terms() {
  return (
    <main>
      <PageHeader
        kicker={`Last reviewed ${POLICY_UPDATED_LABEL}`}
        title="Terms"
        lede="Short, because there is not much to agree about: the software is MIT-licensed, the subscription is month to month, and your meetings are yours."
      />

      <Section width="prose" className="ldg-article !py-14">
        <h2>The software</h2>
        <p>
          Ledgeur is licensed under the MIT licence. You may read it, run it, modify it, and deploy
          it inside your own organisation, commercially, without asking us. The licence text is in
          the <a href={SITE.repo} target="_blank" rel="noreferrer">repository</a> and it, not this
          page, governs the code.
        </p>
        <p>
          The MIT licence also means the software is provided &ldquo;as is&rdquo;, without warranty.
          Speech recognition makes mistakes; speaker separation makes mistakes. Do not rely on a
          transcript as a legal record without checking it against what you remember.
        </p>

        <h2>Your account</h2>
        <p>
          You need an account only for sync and agent access. You are responsible for keeping your
          password and your access tokens secret — an access token grants the same read access to
          your meetings that you have, so treat it like a password. Revoke one at any time from your{" "}
          <Link href="/account">account page</Link>.
        </p>
        <p>
          We may suspend an account being used to break the law or to attack the service. We will
          tell you why.
        </p>

        <h2>The subscription</h2>
        <ul>
          <li>The Team plan is ${TEAM_PRICE_USD} per person per month, billed monthly in advance, after a 14-day free trial.</li>
          <li>The trial requires a card but is not charged until it ends. Cancel during it and you pay nothing.</li>
          <li>Prices exclude any sales tax or VAT, which Stripe calculates and adds at checkout.</li>
          <li>We will give at least 30 days&rsquo; notice by email before changing the price of an existing subscription.</li>
        </ul>

        <h2>Cancelling, and refunds</h2>
        <p>
          Cancel from the billing portal on your <Link href="/account">account page</Link>. It takes
          two clicks, there is no retention flow, and you do not have to email anybody. The plan
          runs to the end of the period you have paid for and then stops.
        </p>
        <p>
          If you cancel because Ledgeur is not doing what this website says it does,{" "}
          <EmailLink label="tell us" subject="Refund request" className="font-medium text-accent-strong underline" />{" "}
          and we will refund the current month. We would rather return the money than keep it from
          somebody who feels misled.
        </p>
        <p>
          <strong>Cancelling does not touch your meetings.</strong> They are on your device, which is
          where they always were. Sync stops and the agent endpoint closes; nothing is deleted and
          there is no export deadline.
        </p>

        <h2>If we stop</h2>
        <p>
          Ledgeur is a small product and could fail. If it does, the free app keeps working — it
          needs nothing from us once the models are cached — and the source is public, so a paid
          deployment can be self-hosted. We would give at least 60 days&rsquo; notice before shutting
          down hosted sync.
        </p>

        <h2>Liability</h2>
        <p>
          To the extent the law allows, our liability for any claim relating to Ledgeur is limited to
          the amount you paid us in the 12 months before it arose. Nothing here limits liability for
          death or personal injury caused by negligence, or for fraud.
        </p>

        <h2>Governing law</h2>
        <p>
          These terms are governed by the law of England and Wales, and disputes go to its courts.
          If you are a consumer, this does not remove protections you have under the law of the
          country you live in.
        </p>

        <h2>Contact</h2>
        <p>
          <EmailLink label="Email us" subject="Terms" className="font-medium text-accent-strong underline" />.
          See also the <Link href="/privacy">privacy notice</Link>.
        </p>
      </Section>
    </main>
  );
}
