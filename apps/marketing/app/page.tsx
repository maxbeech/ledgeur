import Link from "next/link";
import { Badge, Card, Display, Kicker, buttonClass } from "@ledgeur/ui/components";
import { SITE, VALUE_PROPS, COMPARISON, TEAM_PRICE_USD } from "@/lib/site";
import { COMPETITORS } from "@/lib/competitors";
import { USE_CASES } from "@/lib/usecases";
import { PLATFORMS } from "@/lib/platforms";
import { Section, SectionHead } from "@/components/site/Chrome";
import { TranscriptPreview } from "@/components/site/TranscriptPreview";

// Fully static. Nothing on this page is personalised or time-sensitive, so it
// is prerendered once at build and served from the edge cache — the cheapest
// and fastest thing Vercel can do with it.
export const dynamic = "force-static";

export default function Home() {
  return (
    <main>
      {/* ------------------------------------------------------------ hero */}
      <section className="ldg-wash border-b border-hairline">
        <div className="mx-auto grid max-w-6xl gap-14 px-5 pb-16 pt-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-12 lg:pb-24 lg:pt-24">
          <div className="ldg-stagger">
            <Badge tone="accent">Open source · MIT · nothing is uploaded</Badge>
            <Display level={1} className="mt-5 text-[38px] leading-[1.06] sm:text-[52px]">
              Every meeting, on the record.
              <br />
              <span className="text-accent-strong">None of it on our servers.</span>
            </Display>
            <p className="mt-5 max-w-xl text-[16.5px] leading-relaxed text-muted">
              Ledgeur transcribes your meetings and works out who said what — the speech model and
              the speaker model both run inside your browser. Name a voice once and it is recognised
              in every meeting after that. No bot joins the call. No minutes to buy.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/app" className={buttonClass("primary", "lg")}>Open Ledgeur — free</Link>
              <a href={SITE.repo} target="_blank" rel="noreferrer" className={buttonClass("secondary", "lg")}>
                Read the source
              </a>
            </div>
            <p className="mt-4 text-[13px] text-faint">
              No sign-up needed to record. An account only adds sync and agent access.
            </p>
          </div>

          <TranscriptPreview className="ldg-rise" />
        </div>
      </section>

      {/* ------------------------------------------------------ value props */}
      <Section>
        <SectionHead
          kicker="Why it is built this way"
          title="A record you own, not a subscription to your own conversations."
          lede="Every other AI notetaker is a pipe to somebody else's database. That is a design choice, and it is the one thing Ledgeur does differently."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {VALUE_PROPS.map((v) => (
            <Card key={v.title} raised className="p-6">
              <h3 className="ldg-display text-[19px] text-ink-text">{v.title}</h3>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{v.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* --------------------------------------------------------- speakers */}
      <section className="border-y border-hairline bg-surface">
        <Section className="!py-16 sm:!py-20">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <Kicker>The part nobody else does on-device</Kicker>
              <Display level={2} className="mt-3 text-[26px] leading-tight sm:text-[34px]">
                It learns the voices in the room.
              </Display>
              <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-muted">
                <p>
                  A transcript that says “um, right, so” for forty minutes is a wall. A transcript
                  that says <strong className="font-medium text-ink-text">who</strong> said it is a
                  record you can act on.
                </p>
                <p>
                  Ledgeur runs a speaker segmentation model over the audio to find where the voice
                  changes, then turns each stretch of speech into a voice print and groups them.
                  You get Speaker&nbsp;1, Speaker&nbsp;2, Speaker&nbsp;3 — with the overlaps handled,
                  because people talk over each other.
                </p>
                <p>
                  Rename Speaker&nbsp;2 to Priya once. From then on, Ledgeur recognises Priya in
                  every meeting she is in. The voice prints live in your browser’s storage and are
                  never synced, never uploaded, and never part of the paid tier — a voice print
                  identifies a person even after the transcript is deleted, so it stays where it was
                  made.
                </p>
              </div>
              <div className="mt-7 flex flex-wrap gap-2">
                <Badge tone="neutral">pyannote segmentation 3.0</Badge>
                <Badge tone="neutral">WeSpeaker ResNet34</Badge>
                <Badge tone="accent">Runs in your browser</Badge>
              </div>
            </div>

            <Card raised className="overflow-hidden">
              <div className="border-b border-hairline px-5 py-4">
                <div className="ldg-kicker">How a name sticks</div>
              </div>
              <ol className="divide-y divide-hairline">
                {[
                  ["The recording ends", "Ledgeur finds the turns and gives each voice a print — a 256-number fingerprint of how that person sounds."],
                  ["You name one", "Click “Speaker 2”, type “Priya”. The print is saved under that name, on this device only."],
                  ["Next Tuesday", "Priya speaks. Her print matches. The transcript says Priya before you have read a line of it."],
                  ["It keeps learning", "Each meeting refines her print as a running average, so a bad headset once does not undo ten good recordings."],
                ].map(([title, body], i) => (
                  <li key={title} className="flex gap-4 px-5 py-4">
                    <span className="ldg-display mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[13px] text-accent-strong">
                      {i + 1}
                    </span>
                    <div>
                      <div className="text-[14.5px] font-medium text-ink-text">{title}</div>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </Section>
      </section>

      {/* ---------------------------------------------------- how it works */}
      <Section>
        <SectionHead
          kicker="Start to finish"
          title="Three steps, and none of them are “create an account”."
          align="center"
        />
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {[
            ["Capture", "Share the meeting tab with its audio, or just your microphone. Or drag in a recording you already have — a voice memo, a Zoom export, an old interview. It is treated exactly like a live meeting."],
            ["Transcribe on your device", "Whisper runs in the browser through WebGPU, or the CPU if there is no WebGPU. The first run downloads the model once; after that it is cached and works with the wifi off."],
            ["Read it, and act", "Speakers separated, timestamps on every line, a summary with the decisions and action items pulled out. Edit it, export it, search it later."],
          ].map(([title, body], i) => (
            <div key={title}>
              <div className="ldg-display text-[13px] text-accent-strong">{String(i + 1).padStart(2, "0")}</div>
              <h3 className="ldg-display mt-2 text-[20px] text-ink-text">{title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------- comparison */}
      <section className="border-y border-hairline bg-surface">
        <Section className="!py-16 sm:!py-20">
          <SectionHead
            kicker="The honest version"
            title="What actually differs from a cloud notetaker."
            lede="Not a feature-count. These are architectural differences — the consequences of where the audio goes."
          />
          <div className="mt-9 overflow-x-auto">
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

      {/* ----------------------------------------------------------- agents */}
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-center">
          <div>
            <Kicker>For the agents you already use</Kicker>
            <Display level={2} className="mt-3 text-[26px] leading-tight sm:text-[32px]">
              Point Claude at everything the company has said.
            </Display>
            <p className="mt-4 text-[15px] leading-relaxed text-muted">
              The paid tier exposes your meetings over the Model Context Protocol — so an agent can
              list them, search them, read a full transcript with speakers, and pull the open action
              items. Same tools whether it connects over stdio on your machine or to the hosted
              endpoint.
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              Access runs as <em>you</em>: the token resolves to your session, so row-level security
              decides what the agent can see. It cannot read a meeting you could not.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/agents" className={buttonClass("secondary", "md")}>How agent access works</Link>
              <Link href="/pricing" className={buttonClass("ghost", "md")}>See pricing →</Link>
            </div>
          </div>

          <Card raised className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
              <div className="ldg-kicker">Available tools</div>
              <Badge tone="glow">MCP</Badge>
            </div>
            <ul className="divide-y divide-hairline text-[13.5px]">
              {[
                ["list_meetings", "Browse the most recent meetings."],
                ["search_meetings", "Find a meeting by what it was called."],
                ["get_meeting", "The full transcript, speakers and notes for one meeting."],
                ["list_tasks", "Every action item, filtered by status."],
              ].map(([name, what]) => (
                <li key={name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
                  <code className="font-mono text-[12.5px] text-glow-strong">{name}</code>
                  <span className="text-muted">{what}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      {/* -------------------------------------------------------- SEO links */}
      <section className="border-y border-hairline bg-surface">
        <Section className="!py-14">
          <SectionHead kicker="Wherever you meet" title="Works with every browser-based meeting platform." />
          <div className="mt-6 flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <Link
                key={p.slug}
                href={`/transcribe/${p.slug}`}
                className="rounded-full border border-hairline-strong bg-paper px-4 py-1.5 text-[13.5px] text-ink-text transition-colors hover:border-accent hover:text-accent-strong"
              >
                {p.name}
              </Link>
            ))}
          </div>

          <div className="mt-14">
            <SectionHead kicker="Switching" title="Coming from something else?" />
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {COMPETITORS.slice(0, 6).map((c) => (
                <Link
                  key={c.slug}
                  href={`/alternatives/${c.slug}`}
                  className="group rounded-xl border border-hairline bg-paper p-4 transition-colors hover:border-accent"
                >
                  <div className="ldg-display text-[15px] text-ink-text">Ledgeur vs {c.name}</div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">{c.what}</p>
                </Link>
              ))}
            </div>
            <Link href="/alternatives" className="mt-4 inline-block text-[13.5px] font-medium text-accent-strong hover:underline">
              Every comparison →
            </Link>
          </div>

          <div className="mt-14">
            <SectionHead kicker="What people use it for" title="Built for every kind of meeting." />
            <div className="mt-6 flex flex-wrap gap-2">
              {USE_CASES.map((u) => (
                <Link
                  key={u.slug}
                  href={`/use-cases/${u.slug}`}
                  className="rounded-full border border-hairline-strong bg-paper px-4 py-1.5 text-[13.5px] text-ink-text transition-colors hover:border-accent hover:text-accent-strong"
                >
                  {u.name}
                </Link>
              ))}
            </div>
          </div>
        </Section>
      </section>

      {/* -------------------------------------------------------------- CTA */}
      <Section width="narrow" className="text-center">
        <Display level={2} className="text-[30px] leading-tight sm:text-[38px]">
          Your meetings, your machine, your record.
        </Display>
        <p className="mx-auto mt-4 max-w-xl text-[15.5px] leading-relaxed text-muted">
          The whole product is free for one person, permanently — not a trial, not a tier with the
          good parts removed. Pay ${TEAM_PRICE_USD} a month per person only when you want the record
          shared across a team and readable by your agents.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/app" className={buttonClass("primary", "lg")}>Open Ledgeur</Link>
          <Link href="/pricing" className={buttonClass("secondary", "lg")}>See pricing</Link>
        </div>
      </Section>
    </main>
  );
}
