import Link from "next/link";
import { ShieldCheck, Fingerprint, UserX, Infinity as InfinityIcon, type LucideIcon } from "lucide-react";
import { Badge, Card, Display, Label, buttonClass } from "@ledgeur/ui/components";
import { cn } from "@ledgeur/ui";
import { SITE, VALUE_PROPS, TEAM_PRICE_USD } from "@/lib/site";
import { COMPETITORS } from "@/lib/competitors";
import { USE_CASES } from "@/lib/usecases";
import { PLATFORMS } from "@/lib/platforms";
import { TEMPLATES } from "@/lib/templates";
import { GUIDES } from "@/lib/guides";
import { Section, SectionHead } from "@/components/site/Chrome";
import { TranscriptPreview } from "@/components/site/TranscriptPreview";
import { ComparisonTable } from "@/components/site/ComparisonTable";
import { CustomerLogos } from "@/components/site/CustomerLogos";

// Fully static. Nothing on this page is personalised or time-sensitive, so it
// is prerendered once at build and served from the edge cache — the cheapest
// and fastest thing Vercel can do with it.
export const dynamic = "force-static";

/** Each value prop gets its own pastel family — the four are different
 *  kinds of promise, and the colour says so before the words do. */
const PROP_STYLE: readonly { icon: LucideIcon; tile: string }[] = [
  { icon: ShieldCheck, tile: "bg-mint-soft text-mint-strong" },
  { icon: Fingerprint, tile: "bg-sky-soft text-sky-strong" },
  { icon: UserX, tile: "bg-rose-soft text-rose-strong" },
  { icon: InfinityIcon, tile: "bg-butter-soft text-butter-strong" },
];

const STEPS = [
  ["Capture", "Share the meeting tab with its audio, or just your microphone. Or drag in a recording you already have — a voice memo, a Zoom export, an old interview. It is treated exactly like a live meeting."],
  ["Transcribe on your device", "Whisper runs in the browser through WebGPU, or the CPU if there is no WebGPU. The first run downloads the model once; after that it is cached and works with the wifi off."],
  ["Read it, and act", "Speakers separated, timestamps on every line, a summary with the decisions and action items pulled out. Edit it, export it, search it later."],
] as const;

export default function Home() {
  return (
    <main>
      {/* ------------------------------------------------------------ hero */}
      <section className="mx-auto max-w-6xl px-5 pb-8 pt-16 text-center sm:pt-24">
        <Badge tone="brand">Open source · nothing is uploaded</Badge>
        <Display level={1} className="mx-auto mt-6 max-w-4xl text-4xl leading-[1.05] sm:text-6xl">
          Every meeting, on the record. None of it on our servers.
        </Display>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
          Ledgeur transcribes your meetings and works out who said what — the speech model and
          the speaker model both run on your machine. Name a voice once and it is recognised
          in every meeting after that. No bot joins the call. No minutes to buy.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/app" className={buttonClass("primary", "lg", "rounded-full px-7")}>Open Ledgeur — free</Link>
          <Link href="/download" className={buttonClass("secondary", "lg", "rounded-full px-7")}>Download for Mac</Link>
        </div>
        <p className="mt-4 text-sm text-faint">
          No sign-up needed to record. An account only adds sync and agent access.
        </p>
        <TranscriptPreview className="ldg-rise mx-auto mt-14 max-w-4xl text-left" />
      </section>

      {/* -------------------------------------------------------- customers */}
      <CustomerLogos />

      {/* ------------------------------------------------------ value props */}
      <Section>
        <SectionHead
          title="A record you own, not a subscription to your own conversations."
          lede="Every other AI notetaker is a pipe to somebody else's database. That is a design choice, and it is the one thing Ledgeur does differently."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {VALUE_PROPS.map((v, i) => {
            const { icon: Icon, tile } = PROP_STYLE[i % PROP_STYLE.length];
            return (
              <Card key={v.title} className="p-6">
                <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl", tile)}>
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-5 text-xl font-semibold tracking-[-0.01em] text-ink-text">{v.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-muted">{v.body}</p>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* --------------------------------------------------------- speakers */}
      <Section tint>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHead
              kicker="The part nobody else does on-device"
              title="It learns the voices in the room."
            />
            <div className="mt-6 space-y-4 text-md leading-relaxed text-muted">
              <p>
                A transcript that says “um, right, so” for forty minutes is a wall. A transcript
                that says who said it is a record you can act on.
              </p>
              <p>
                Ledgeur runs a speaker segmentation model over the audio to find where the voice
                changes, then turns each stretch of speech into a voice print and groups them.
                You get Speaker&nbsp;1, Speaker&nbsp;2, Speaker&nbsp;3 — with the overlaps handled,
                because people talk over each other.
              </p>
              <p>
                Rename Speaker&nbsp;2 to Priya once. From then on, Ledgeur recognises Priya in
                every meeting she is in. The voice prints live on your device and are never
                synced, never uploaded, and never part of the paid tier — a voice print
                identifies a person even after the transcript is deleted, so it stays where it was
                made.
              </p>
            </div>
            <div className="mt-7 flex flex-wrap gap-2">
              <Badge>pyannote segmentation 3.0</Badge>
              <Badge>WeSpeaker ResNet34</Badge>
              <Badge tone="accent">Runs on your device</Badge>
            </div>
            <Link href="/speaker-identification" className="mt-6 inline-block text-base font-medium text-brand-strong hover:underline">
              How speaker separation works, in detail
            </Link>
          </div>

          <Card raised className="overflow-hidden">
            <div className="border-b border-hairline px-5 py-4">
              <Label>How a name sticks</Label>
            </div>
            <ol className="divide-y divide-hairline">
              {[
                ["The recording ends", "Ledgeur finds the turns and gives each voice a print — a 256-number fingerprint of how that person sounds."],
                ["You name one", "Click “Speaker 2”, type “Priya”. The print is saved under that name, on this device only."],
                ["Next Tuesday", "Priya speaks. Her print matches. The transcript says Priya before you have read a line of it."],
                ["It keeps learning", "Each meeting refines her print as a running average, so a bad headset once does not undo ten good recordings."],
              ].map(([title, body], i) => (
                <li key={title} className="flex gap-4 px-5 py-4">
                  <span className="ldg-num mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand-strong">
                    {i + 1}
                  </span>
                  <div>
                    <div className="text-base font-semibold text-ink-text">{title}</div>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </Section>

      {/* ---------------------------------------------------- how it works */}
      <Section>
        <SectionHead title="Three steps, and none of them are “create an account”." align="center" />
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <div key={title}>
              <span className="ldg-num grid h-9 w-9 place-items-center rounded-full bg-ink text-sm font-bold text-on-ink">{i + 1}</span>
              <h3 className="mt-4 text-xl font-semibold tracking-[-0.01em] text-ink-text">{title}</h3>
              <p className="mt-2 text-base leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------- comparison */}
      <Section tint>
        <SectionHead
          title="What actually differs from a cloud notetaker."
          lede="Not a feature-count. These are architectural differences — the consequences of where the audio goes."
        />
        <div className="mt-9"><ComparisonTable /></div>
      </Section>

      {/* ----------------------------------------------------------- agents */}
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-center">
          <div>
            <SectionHead
              kicker="Where this is going"
              title="Your agent is guessing about your work. The answer was in a meeting."
            />
            <p className="mt-5 text-md leading-relaxed text-muted">
              Why the architecture is like that, what the customer actually objected to, which
              decision was quietly reversed: it was all said out loud, and none of it is in the
              documentation. That makes the meeting record the highest-context thing a company
              produces and the least reusable.
            </p>
            <p className="mt-3 text-md leading-relaxed text-muted">
              So Ledgeur opens it over the Model Context Protocol. An agent can list your meetings,
              search them, read a full transcript with speakers, and pull the open action items,
              over an open standard rather than one vendor&rsquo;s private API.
            </p>
            <p className="mt-3 text-md leading-relaxed text-muted">
              Access runs as <em>you</em>: the token resolves to your session, so row-level security
              decides what the agent can see. It cannot read a meeting you could not.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/company-memory" className={buttonClass("secondary", "md", "rounded-full px-5")}>Meetings as company memory</Link>
              <Link href="/agents" className={buttonClass("ghost", "md", "rounded-full")}>How to connect one</Link>
            </div>
          </div>

          <Card raised className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
              <Label>Available tools</Label>
              <Badge tone="brand">MCP</Badge>
            </div>
            <ul className="divide-y divide-hairline text-base">
              {[
                ["list_meetings", "Browse the most recent meetings."],
                ["search_meetings", "Find a meeting by what it was called."],
                ["get_meeting", "The full transcript, speakers and notes for one meeting."],
                ["list_tasks", "Every action item, filtered by status."],
                ["list_people", "Everyone named across your meetings."],
              ].map(([name, what]) => (
                <li key={name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
                  <code className="font-mono text-sm font-medium text-brand-strong">{name}</code>
                  <span className="text-muted">{what}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      {/* -------------------------------------------------------- SEO links */}
      <Section tint>
        <SectionHead title="Works with every browser-based meeting platform." />
        <div className="mt-6 flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <Link key={p.slug} href={`/transcribe/${p.slug}`} className={buttonClass("secondary", "sm", "rounded-full")}>
              {p.name}
            </Link>
          ))}
        </div>

        <div className="mt-16">
          <SectionHead title="Coming from something else?" />
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COMPETITORS.slice(0, 6).map((c) => (
              <Link
                key={c.slug}
                href={`/alternatives/${c.slug}`}
                className="rounded-xl border border-hairline bg-surface p-4 transition-colors hover:border-brand"
              >
                <div className="text-base font-semibold text-ink-text">Ledgeur vs {c.name}</div>
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">{c.what}</p>
              </Link>
            ))}
          </div>
          <Link href="/alternatives" className="mt-5 inline-block text-base font-medium text-brand-strong hover:underline">
            Every comparison
          </Link>
        </div>

        <div className="mt-16">
          <SectionHead title="Built for every kind of meeting." />
          <div className="mt-6 flex flex-wrap gap-2">
            {USE_CASES.map((u) => (
              <Link key={u.slug} href={`/use-cases/${u.slug}`} className={buttonClass("secondary", "sm", "rounded-full")}>
                {u.name}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-16">
          <SectionHead
            title="Or take the template and do it by hand."
            lede="The six templates the app runs on, published as headings you can paste into a blank document."
          />
          <div className="mt-6 flex flex-wrap gap-2">
            {TEMPLATES.map((t) => (
              <Link key={t.slug} href={`/templates/${t.slug}`} className={buttonClass("secondary", "sm", "rounded-full")}>
                {t.template.name}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-16">
          <SectionHead title="The long answers." />
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {GUIDES.map((g) => (
              <Link
                key={g.slug}
                href={`/guides/${g.slug}`}
                className="rounded-xl border border-hairline bg-surface p-4 transition-colors hover:border-brand"
              >
                <div className="text-base font-semibold leading-snug text-ink-text">{g.title}</div>
              </Link>
            ))}
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------------------- CTA */}
      <Section width="narrow" className="text-center">
        <Display level={2} className="text-3xl leading-tight sm:text-4xl">
          Your meetings, your machine, your record.
        </Display>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted">
          The whole product is free for one person, permanently — not a trial, not a tier with the
          good parts removed. Pay ${TEAM_PRICE_USD} a month per person only when you want the record
          shared across a team and readable by your agents.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/app" className={buttonClass("primary", "lg", "rounded-full px-7")}>Open Ledgeur</Link>
          <a href={SITE.repo} target="_blank" rel="noreferrer" className={buttonClass("secondary", "lg", "rounded-full px-7")}>Read the source</a>
        </div>
      </Section>
    </main>
  );
}
