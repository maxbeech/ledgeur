# Ledgeur strategy

Where the product and the market stand, and the positioning, pricing and
product bets that follow from it. Started from a full strategy review on
2026-09-08, revised as findings were checked, corrected, or acted on. Living
document, update it when the market or the product changes underneath it.

This file is the *why*. For the *what's actually shipped*, see
[`ROADMAP.md`](./ROADMAP.md). For keyword data and content architecture, see
[`seo_geo_content_plan.md`](./seo_geo_content_plan.md). Numbers and status
here should agree with both; if they don't, those two are the source of truth
and this file is stale.

## The market Ledgeur is actually in

Three things are true about this category at once.

**Granola is a validation event, not a competitor to out-feature.** It raised
a $125M Series C in March 2026 at a $1.5B valuation, revenue reportedly up
250% quarter on quarter, roughly 15,000 enterprise customers. Its public
direction is to become an "AI workspace context layer," using meetings as the
seed for something bigger than notes, close to word for word the idea behind
Ledgeur's own Contextely integration. The best-funded player in the category
is proving the thesis out in public, at a billion-dollar valuation. That's
confirmation to build toward, from a different architectural angle, not a
threat to route around.

**The nearer threat is platform-native cannibalization, not another
startup.** Zoom AI Companion, Microsoft 365 Copilot's Intelligent Recap, and
Google's Gemini notetaking all now ship free inside paid plans. That squeezes
bot-based tools hardest: Otter, Read AI, Sembly and Avoma all depend on being
let into someone else's call as a guest. Ledgeur doesn't ask permission to
join a call; it listens to the tab, or takes a file someone drags in. No bot
means no bot access to revoke. This is a real structural advantage, distinct
from a UX preference, and it's the second leg of the positioning below.

**On-device processing is a genuinely rare, verified differentiator.** Of the
fourteen competitors surveyed in the original review, exactly one (Krisp)
ships any on-device processing, and only partially. Ledgeur's fully local
Whisper and speaker-diarization pipeline is close to uncontested in this set,
and it's real: verified in the codebase, not just claimed in copy.

## The positioning: three claims, stacked

In the order a visitor should meet them.

1. **Genuinely private.** Transcription and speaker separation run on the
   device. "Open the network tab and check" survives every competitor
   comparison intact, because it's the one claim in this category that is
   actually checkable rather than asserted.
2. **Structurally resistant to platform lock-out.** No bot is admitted to the
   call, so there is no bot access for a video platform to revoke. This is a
   defensibility argument now made explicitly (`/what-we-dont-have`,
   `/security`), not left as an implied UX nicety.
3. **The meeting record as the front door to a team's AI context.** The
   six-month bet. Meetings are the highest-context artefact a company
   produces and the least reusable. Ledgeur's answer is an open protocol
   (MCP) over a record the customer holds, via the Contextely integration,
   rather than another vendor's proprietary cloud index. `/company-memory`
   and `/guides/meetings-for-ai-agents` carry this now; before the
   2026-09-09 pass it lived only in a settings card and a customer-logo
   credit.

## What the original review got wrong, and what it found that was real

Two of the review's own findings didn't survive a check against the
repository, and are recorded here so they don't get re-flagged:

- **"Register ledgeur.com in Search Console."** Already registered and
  owned. The real finding underneath it is that it returned **zero
  impressions** in the trailing 90 days, which is a content and indexing
  problem, not a missing-registration one.
- **"The native engine is opt-in, so most installs fall back to the browser
  path."** Not true of shipped builds. `scripts/release-macos.mjs` builds
  with the native engine on by default; it stays opt-in only for `cargo
  build` and `tauri:dev`, deliberately, because it's a slow native build and
  the mobile targets can't cross-compile sherpa.

What the review found that *was* real, and has since been closed: the
`/security` vs `/pricing` contradiction about SAML, sync being sold as paid
while every account could write to it for free, Circleback and Grain missing
from `/alternatives`, no content pillar for "ai meeting assistant" (4,400/mo
at the lowest competition score measured in the review), the Contextely
integration having nowhere public to live, no diarization page, and no SEO
plan document at all. Execution detail and dates for each are in
`ROADMAP.md`.

One finding neither the review nor the first execution pass caught: every
canonical URL on the site pointed at `https://ledgeur.com`, which
308-redirects to `www`, so the submitted sitemap was indexing nothing.
That's the largest single fix in this pass and it predates every content
decision above it; see `ROADMAP.md` and `seo_geo_content_plan.md` for the
detail.

## Pricing

The model is right; the number was too low to do the model justice.

**Free stays free, and stays the whole product for one person.** This isn't
a risk unique to Ledgeur, it's Fathom's exact playbook, and Fathom monetises
its team tier at $19-34/user/month against that same free-forever base. It's
a real acquisition asset and should not be diluted to fund a higher team
price.

**Team moved from $6 to $12/user/month.** At $6 the price itself signalled
"budget option" for a product whose actual claim is "the only one of these
that's genuinely private and open." $12 still undercuts Fireflies, Grain,
Fathom, Avoma and Sembly outright, while sitting closer to Circleback and
Read AI, companies with materially less differentiated architecture. Done:
the matching Stripe Price was created 2026-09-10 and checkout now charges
$12, verified against a real (uncompleted) checkout session rather than
trusting the config change alone.

**Enterprise has a $30 floor instead of "let's talk."** A tier with no
number asks a buyer to spend a meeting finding out whether they can afford
the conversation. $30 is a reasonable anchor against Read AI's Enterprise+
($29.75/user/mo for HIPAA/SAML/SCIM), now that the SAML story is reconciled
rather than contradicted across two pages.

## What's still open, and why

- **Two more finance/product checks need a human**, not because of caution
  but because of what actually blocks them: a completed real-card purchase
  confirming the Settings sync card flips over, and real Linear/Todoist/Asana
  tokens to test a live task push (those are the user's own third-party
  accounts; creating one on their behalf is out of scope regardless of who's
  driving). Tracked as items 28 and 29 in `MANUAL_TESTING.md`.
- **Mobile apps are built and signed but not listed.** Both pipelines
  produce store-ready binaries; what's left needs a human in App Store
  Connect and Play Console. See `MOBILE.md`.
- **Zero impressions is the honest starting number**, not a failure of this
  pass. Re-measure in 90 days once Google has actually recrawled the fixed
  sitemap; there's no way to force that faster than the crawler chooses to.
- **"ai context layer" is worth watching**, not building yet: roughly
  40/mo average but climbing from near-zero over the year, the shape of a
  term about to matter rather than one that matters today.
