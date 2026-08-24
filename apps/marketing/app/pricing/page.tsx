import type { Metadata } from "next";
import Link from "next/link";
import { SITE, PLANS, COMPARISON } from "@/lib/site";
import { Badge, Card, Display, buttonClass } from "@ledgeur/ui/components";
import CheckoutButton from "@/components/CheckoutButton";
import EmailLink from "@/components/EmailLink";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";

export const metadata: Metadata = {
  title: "Pricing — the whole product is free for one person",
  description:
    "Free forever for one person: unlimited recording, on-device transcription, speaker separation and search. Pay only to sync, share or connect an agent.",
  alternates: { canonical: `${SITE.url}/pricing` },
};

// Prices change rarely and are the same for everybody, so this is prerendered
// once and served static. The only dynamic thing on the page is the checkout
// button, which is a client component.
export const dynamic = "force-static";

export default function Pricing() {
  return (
    <main>
      <PageHeader
        kicker="Pricing"
        title="The free plan is the whole product."
        lede="Not a trial, not a crippled tier. Ledgeur runs on your machine, so one person using it costs us nothing and we charge nothing. You pay when you want the record to leave your device — synced across a team, and readable by your agents."
      />

      <Section>
        <div className="grid gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <Card
              key={plan.id}
              raised
              className={`flex flex-col p-6 ${plan.featured ? "border-accent/40 ring-1 ring-accent/15" : ""}`}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="ldg-display text-[20px] text-ink-text">{plan.name}</h2>
                {plan.featured && <Badge tone="accent">Most teams</Badge>}
              </div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{plan.who}</p>

              <div className="mt-5 flex items-baseline gap-2">
                {plan.price
                  ? <span className="ldg-display text-[34px] leading-none text-ink-text">{plan.price}</span>
                  : <span className="ldg-display text-[26px] leading-none text-ink-text">Let’s talk</span>}
                <span className="text-[13px] text-faint">{plan.price ? plan.cadence : ""}</span>
              </div>

              <ul className="mt-6 flex-1 space-y-2.5 text-[13.5px] leading-relaxed text-ink-text">
                {plan.includes.map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <span aria-hidden className="mt-[3px] text-accent-strong">✓</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              {plan.note && <p className="mt-5 text-[12.5px] leading-relaxed text-faint">{plan.note}</p>}

              <div className="mt-6">
                {plan.cta.kind === "app" && (
                  <Link href={plan.cta.href ?? "/app"} className={`${buttonClass("secondary", "lg")} w-full`}>
                    {plan.cta.label}
                  </Link>
                )}
                {plan.cta.kind === "checkout" && <CheckoutButton label={plan.cta.label} />}
                {plan.cta.kind === "contact" && (
                  <EmailLink
                    label={plan.cta.label}
                    subject="Ledgeur — running it ourselves"
                    className={`${buttonClass("secondary", "lg")} w-full`}
                  />
                )}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* What you are actually buying, said plainly. */}
      <section className="border-y border-hairline bg-surface">
        <Section className="!py-16">
          <SectionHead
            kicker="What the money is for"
            title="Three things, and nothing else."
            lede="Ledgeur’s costs scale with sync and hosting, not with your minutes. So that is what the paid plan covers."
          />
          <div className="mt-9 grid gap-5 md:grid-cols-3">
            {[
              ["Sync", "Your meetings, encrypted in transit, in a Postgres database with row-level security that only ever returns your rows. Record on your laptop, read it on your phone."],
              ["A shared library", "Mark a meeting as shared and everyone in your workspace can find it. The company stops re-deciding things it already decided."],
              ["Agent access", "A Model Context Protocol endpoint your AI tools can read. Ask Claude what was agreed about pricing, and it goes and looks."],
            ].map(([title, body]) => (
              <div key={title}>
                <h3 className="ldg-display text-[18px] text-ink-text">{title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </Section>
      </section>

      {/* The things we do NOT have. This section is the point of the page. */}
      <Section width="narrow">
        <SectionHead
          kicker="What we do not have"
          title="The list nobody else publishes."
          lede="Buying software on the strength of a feature grid that turns out to be a roadmap is a miserable experience. So here is ours, in advance."
        />
        <Card className="mt-8 divide-y divide-hairline">
          {[
            ["SSO / SAML and SCIM provisioning", "Not built. If your security review requires it, we are not the right fit yet — and we would rather tell you now than during onboarding."],
            ["An admin console and audit log", "Not built. Workspace administration today is one owner and a member list."],
            ["A packaged self-host bundle", "There is no Docker or Helm chart. Self-hosting is genuinely possible — the source is MIT and the schema is in the repository — but it is a manual job, and Enterprise means we help you do it."],
            ["A mobile app in the stores", "The web app works on a phone. There is no App Store build yet."],
            ["Real-time collaborative editing", "Two people editing the same meeting notes at once will overwrite each other."],
          ].map(([title, body]) => (
            <div key={title} className="px-5 py-4">
              <div className="text-[14.5px] font-medium text-ink-text">{title}</div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </Card>
      </Section>

      {/* Comparison. */}
      <section className="border-y border-hairline bg-surface">
        <Section className="!py-16">
          <SectionHead kicker="Against a hosted notetaker" title="Where the difference actually is." />
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
              <caption className="sr-only">Ledgeur compared with a typical cloud AI notetaker</caption>
              <thead>
                <tr className="border-b border-hairline-strong">
                  <th scope="col" className="py-3 pr-4 font-medium text-faint" />
                  <th scope="col" className="py-3 pr-4 font-medium text-ink-text">Ledgeur</th>
                  <th scope="col" className="py-3 font-medium text-faint">A hosted notetaker</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.point} className="border-b border-hairline align-top">
                    <th scope="row" className="py-4 pr-4 font-medium text-ink-text">{row.point}</th>
                    <td className="py-4 pr-4 text-ink-text">{row.ledgeur}</td>
                    <td className="py-4 text-muted">{row.them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </section>

      {/* Billing questions people actually have. */}
      <Section width="narrow">
        <SectionHead kicker="Before you buy" title="The awkward questions." />
        <div className="mt-8 space-y-6">
          {[
            ["What happens to my meetings if I cancel?", "Nothing. They are on your device — that is where they were the whole time. Cancelling stops the sync and closes the agent endpoint; it does not take your library away, and there is no export deadline."],
            ["Is there really no minute limit on the free plan?", "There is no limit we impose. The limit is your own machine: a long meeting takes longer to transcribe on a laptop without WebGPU. Nothing is metered, because nothing is running on our hardware."],
            ["Can I self-host instead of paying?", "Yes, and you do not need our permission — it is MIT-licensed and the database schema is in the repository. Enterprise is us helping you do it and supporting it, not us granting a right you already have."],
            ["How do I cancel?", "From your account page, which opens the Stripe billing portal. No email, no retention call."],
            ["Do you train models on my meetings?", "No, and we could not: the audio and the transcript never reach us on the free plan, and on the paid plan they are your rows in a database behind row-level security. There is no training pipeline in this product."],
          ].map(([q, a]) => (
            <div key={q}>
              <Display level={3} className="text-[17px]">{q}</Display>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{a}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 text-[13.5px] text-faint">
          Prices are in USD and exclude any local sales tax, which Stripe calculates at checkout.
          See the <Link href="/terms" className="text-accent-strong hover:underline">terms</Link> and{" "}
          <Link href="/privacy" className="text-accent-strong hover:underline">privacy notice</Link>.
        </p>
      </Section>
    </main>
  );
}
