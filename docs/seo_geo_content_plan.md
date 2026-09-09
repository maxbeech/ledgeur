# SEO and GEO content plan

The living plan for how ledgeur.com gets found, by people and by models. Every
sibling Beech product has one of these; Ledgeur's was never written, which is
why the September 2026 strategy review had to measure everything from scratch
rather than check it against anything. This is that measurement, written down.

Update this file when the content architecture changes. Numbers here are real
Google Ads Keyword Planner figures (US, trailing twelve months) with the date
they were pulled. Do not add a number to this file that nobody measured.

Legend: ✅ built · 🟡 partial · ⬜ planned.

## Where we actually stand

Measured 2026-09-09 against Search Console (`sc-domain:ledgeur.com`):

| | |
|---|---|
| Search Console property | ✅ registered, `sc-domain:ledgeur.com`, owner |
| Sitemap | ✅ submitted 2026-09-08, 71 URLs, 0 errors |
| URLs indexed **from the sitemap** | **0** |
| Impressions, last 90 days | **0** |
| Clicks, last 90 days | **0** |
| Indexable pages after this pass | 87 (see `app/sitemap.ts`) |

Zero is the honest starting number and worth stating plainly: none of what
follows is optimisation of something that is working. It is the first attempt.

### The canonical bug, found 2026-09-09

Search Console's URL inspection on `https://ledgeur.com/` came back:

```
coverageState:   "Page with redirect"
userCanonical:   https://ledgeur.com/
googleCanonical: https://www.ledgeur.com/
```

The deployment serves at `www` and 308-redirects the apex. `SITE.url` was the
apex, and every canonical tag, every sitemap entry, every OpenGraph url and
every JSON-LD `mainEntityOfPage` on the site is built from it. So the site
declared a canonical that redirected, on every page, and the submitted sitemap
was 71 URLs that all redirected. Google overruled our declared canonical
everywhere and picked its own.

This is invisible from inside the app: the pages render, the tags are present,
and the markup validates. It predates every content decision below.

It also explains the "0 indexed" figure above, which is narrower than it looks.
Inspecting `https://www.ledgeur.com/pricing` returns "Submitted and indexed"
with the same canonical mismatch (`googleCanonical` www, `userCanonical` apex).
So Google *has* indexed some pages, by following internal links to the www
host; what it has indexed nothing of is the sitemap, because every URL in the
sitemap was an apex URL that redirects. The sitemap was doing no work at all.

Fixed by pointing `SITE.url` at `https://www.ledgeur.com`, with a test asserting
it stays on whichever host answers 200 without a hop. The desktop app's own
links, the hosted MCP endpoint and the Notion OAuth redirect were pointed at the
same host in the same commit: a 308 on a POST is followed by most clients and
not all, and an OAuth redirect URI has to match its registration exactly.

**Re-inspect after the next deploy** and confirm the verdict moves off "Page
with redirect".

## The positioning this content serves

Three claims, stacked, in the order a visitor meets them:

1. **Genuinely private.** Transcription and speaker separation run on the
   device. Open the network tab and check. This is the claim that survives
   every competitor comparison intact.
2. **Structurally impossible to lock out.** No bot is admitted to the call, so
   there is no bot access for a video platform to revoke. Otter, Read AI,
   Sembly and Avoma all depend on being let in as a guest; Zoom, Teams and Meet
   now all ship their own free notetaker. This is a defensibility argument and
   it was previously framed as a UX nicety.
3. **The meeting record as the front door to a team's AI context.** The
   six-month bet. Meetings are the highest-context artefact a company produces
   and the least reusable, and the interface that fixes that is an open
   protocol over a record you hold, not a proprietary cloud index.

## Primary pages

| Page | Targets | State |
|---|---|---|
| `/` | brand, "ai meeting notes" | ✅ |
| `/pricing` | commercial intent | ✅ |
| `/download` | "download" intent, per-platform | ✅ |
| `/agents` | MCP setup, the how | ✅ |
| `/company-memory` | the positioning bet, agent context | ✅ 2026-09-09 |
| `/speaker-identification` | speaker diarization 880/mo | ✅ 2026-09-09 |
| `/templates` (+ 6 children) | meeting notes template 22,200/mo | ✅ 2026-09-09 |
| `/what-we-dont-have` | trust, and shareable into a security review | ✅ 2026-09-09 |
| `/security` | procurement | ✅ |
| `/open-source` | "open source" qualifier | ✅ |

## Pillars and clusters

Twenty-eight blog posts sat flat under `/blog`, competing with each other and
with nothing linking a reader from the broad question to the narrow one. Three
pillars now do that, at `/guides/[slug]`, defined in `apps/marketing/lib/guides.ts`.
A test asserts every cluster slug resolves to a real post, because a renamed
post turns the one page whose job is linking into a page of dead links.

| Pillar | Term | Volume | Competition | Cluster |
|---|---|---|---|---|
| `/guides/ai-meeting-assistant` | ai meeting assistant | 4,400/mo | index 4 | 8 posts |
| `/guides/private-meeting-transcription` | speaker diarization | 880/mo | index 22 | 7 posts |
| `/guides/meetings-for-ai-agents` | model context protocol | 14,800/mo | index 29 | 4 posts |

"ai meeting assistant" at competition index 4 is the lowest-competition term of
anything measured anywhere in this research, against real volume and a
$4.35 to $12.61 top-of-page bid range. It is the single highest-leverage term
available and it previously had one blog post pointed at it.

"speaker diarization" carries a $9.80 to $75.96 bid range on 880 searches. That
spread is what a technical buyer looks like, and nobody in this category has
written the honest version of the page.

## Lead magnets

- ✅ **`/transcribe`** — seven platform-specific how-tos with HowTo schema.
  Genuinely well executed. Left alone deliberately.
- ✅ **`/templates`** — the largest volume number found anywhere in this
  research (22,200/mo, and the same figure for "meeting minutes template"),
  informational rather than commercial, and built from `NOTE_TEMPLATES` in
  `@ledgeur/core`, which is what the app actually runs on. A test asserts every
  built-in template has a page, so the set cannot silently diverge.
- ✅ **`/what-we-dont-have`** — publishing the honesty itself. Most competitors
  would never put this up, which is the point. It is also the page a
  security-conscious reader can send to a colleague without sending a pricing
  page.

## Comparison pages

Fourteen at `/alternatives/[slug]`, from `lib/competitors.ts`. Added 2026-09-09:

- **Circleback** — 720/mo on "circleback ai" and 6,600 on the bare brand term,
  more brand search than any other named competitor measured, and previously
  not mentioned anywhere on the site.
- **Grain** — 140/mo on "grain alternative". Small, but it was the other named
  competitor with no page.

A test asserts at least one comparison entry concedes a point to the competitor.
A set of pages that only flatters us is not a comparison, and the credibility of
all fourteen rests on the reader believing any single one of them.

## Terms measured and deliberately not chased

Below Keyword Planner's reporting floor, or too small to justify a page:
`hipaa compliant meeting notes`, `self hosted meeting notes`,
`private ai notetaker`, `mcp meeting notes`, `circleback alternative`,
`company memory ai`, `team knowledge base ai`. These stay as long-tail body
content inside existing pages. `ai context layer` is worth watching: 40/mo
average but 0 → 90 over the year, which is the shape of a term that is about to
matter.

`ai notetaker` (2,900/mo) has a competition index of 100. It is not worth
fighting for directly and the pillar strategy routes around it.

## GEO: being readable by a model

The same properties that make the product defensible make it citable:

- Every page states a checkable fact rather than a claim ("open the network tab
  and check", named models, linked source files).
- `/what-we-dont-have` and `/agents` both render lists generated from code, so a
  model quoting them cannot quote something that does not exist.
- MIT source on GitHub means the assertions have a primary source a model can
  reach.
- `/company-memory` and `/guides/meetings-for-ai-agents` are written to answer
  "what does MCP mean for a meeting record", which nothing else in this category
  currently answers.

## Open

- ⬜ Submit the sitemap in Search Console and watch for first impressions.
- ⬜ Re-measure in 90 days. With zero impressions today, any movement is signal.
- ⬜ Decide whether `ai context layer` deserves its own page once it clears
  ~200/mo.
- ⬜ The `/blog` posts still carry the older house voice in places. Worth a pass
  once there is data saying which of them anybody reads.
