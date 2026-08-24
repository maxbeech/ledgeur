# Ledgeur production-readiness overhaul

Audit + execution plan. Started 2026-08-24. Updated as work lands.

## Verdict of the audit

The engine room is good — the ASR load-plan ladder, the Supabase schema, the MCP
package and the Rust AI host are real, tested engineering. What is **not** good is
everything a customer actually touches: the marketing site, the thing you get when
you click "Open the app", and the paid tier.

### P0 — The paid tier sells things that do not exist

`/pricing` advertises a **Team** plan ($6/user/mo) with "shared team workspace,
searchable team library, centralised AI key & spend", and a **Company license**
with "self-host bundle (Docker + Helm), SSO / SAML & SCIM, admin console & audit
log, on-prem / air-gapped". None of that exists in this repository. Checkout is
live. A customer can pay and receive nothing that was described.

Worse: `/pricing` reached directly has no `?org=`, so `client_reference_id` is
absent, so `stripe-webhook` cannot activate any org. The default purchase path
takes money and activates nothing at all.

The README describes a *different* business model again (app free, paid = MCP +
hive mind). Three documents, three products.

### P0 — There is no signup, so there is no funnel

`/app` is an anonymous browser recorder. No account, no sync, no library, no MCP
token. The real product — accounts, sync, copilot, MCP, voice profiles — is the
Tauri app, which the site never asks anyone to install. So the journey is:
land → use a toy → nothing. There is no way to become a customer.

### P0 — The marketing site is not on the brand

`packages/ui/src/tokens.ts` defines a genuinely distinctive design language
("The Library of Record": Fraunces / Schibsted Grotesk / Spline Sans Mono, warm
paper, spruce ink, emerald / gold / madder semantics). The app uses it. The
marketing site does not use one token of it — it is default Tailwind
`stone`/`emerald`, `font-extrabold`, `rounded-2xl` cards, ✓-bullet pricing
columns and a three-step "How it works". It reads as generated, not designed.
No product imagery anywhere; a visitor never sees the product before signing up.

### P0 — Legally required pages are missing

No privacy policy, no terms, no refund policy, no security page, no contact page
— while taking card payments and claiming privacy properties as the core pitch.

### P1 — Competitive feature gaps

| Capability | Granola / Otter / Fireflies | Ledgeur today |
|---|---|---|
| Speaker separation ("who said what") | yes | **no** — schema models it, nothing produces it |
| Remembering a speaker across meetings | yes | native-only, enrolment-only, opt-in cargo feature |
| Drag & drop an existing recording | yes | **no drag & drop anywhere in the repo** |
| Timestamps on the transcript | yes | **no** — worker never asks for them |
| Search across meetings | yes | web app: no |

`transcribe.worker.js` calls the pipeline without `return_timestamps`, so the
output is one undifferentiated string. Diarization is impossible downstream.

### P1 — Source-of-truth violations

`apps/marketing/lib/{summarize,ai-notes,audio}.ts` are forked copies of
`packages/core/src/notes/*` and `packages/core/src/audio/pcm.ts`. They have
**already drifted** (core's `toMarkdown` takes `manualNotes`; the fork does not).

## Plan

### A. Shared foundations — done
- [x] `packages/ui` exports `theme.css` (the `@theme` token block + base
      classes) and `components/primitives.tsx`, consumed by both apps.
- [x] A test asserts `tokens.ts` and `theme.css` describe the same palette, and
      that every text colour clears WCAG AA. **Five real contrast failures were
      found and fixed**, including the kicker label at 2.86:1.
- [x] Marketing's forked `summarize`/`ai-notes`/`audio`/`db` are deleted and it
      imports `@ledgeur/core`. A test asserts they are not forked back out.
- [x] `authMessages.ts`, `capture.ts` and `transcriber.ts` — each of which
      existed twice and had drifted — now exist once, in `@ledgeur/core`.

### B. On-device diarization (free, browser, no server)
Verified available on the runtime we already pin (transformers.js 3.8.1):
- `onnx-community/pyannote-segmentation-3.0` via
  `AutoModelForAudioFrameClassification` + `PyAnnoteProcessor`, with
  `post_process_speaker_diarization(logits, num_samples)` returning
  `{id, start, end, confidence}` turns.
- `onnx-community/wespeaker-voxceleb-resnet34-LM` via `WeSpeakerResNetModel` +
  `WeSpeakerFeatureExtractor` for speaker embeddings.

- [x] `packages/asr/diarize.worker.js` — segmentation → per-turn embeddings →
      average-linkage cosine clustering → stable `Speaker 1..N`.
- [x] ASR returns timestamps (`return_timestamps: true`), and a straddling
      sentence is split at the speaker boundary rather than given wholesale to
      whoever held the floor longest.
- [x] Voice prints in IndexedDB. Name "Speaker 2" once and every later meeting
      recognises them. The print is a running mean, so one bad headset does not
      undo ten good recordings. Never synced.
- [x] Drag & drop anywhere → a first-class meeting, same pipeline as a live one.
- [x] The **live** path analyses each 20-second slice as it arrives and keeps
      only turns and vectors, so an hour-long meeting does not hold 230 MB of
      Float32. Clustering still happens once, over everything, at the end.
- [x] The desktop app's webview path got all of this too — it previously
      labelled every line "Speaker 1".

### C. A real product on the web — done
- [x] Sign up / sign in / password reset on the web, against the same Supabase
      project the app uses.
- [x] `/app` is now the product: record, import, live transcript, library,
      full-text search across everything said, meeting detail with speakers,
      per-speaker talking time, rename-a-voice, Markdown export, manual notes.
- [x] Local-first throughout — every one of those works signed out.

### D. Revenue that works — done
- [x] Pricing rewritten to what ships. The vapour is gone, and `/pricing` now
      publishes a **"what we do not have"** section. A test fails the build if a
      paid plan's feature list mentions SSO, SAML, SCIM, an audit log, Helm,
      Docker, SOC 2 or ISO 27001.
- [x] Checkout resolves the workspace from the buyer's own session and **refuses
      to open a session it cannot attribute** — it previously took money and
      activated nothing.
- [x] Billing portal, reachable in two clicks from `/account`.
- [x] **Fixed a dead paid feature**: every agent access token the app issued was
      unusable. The mint stored `sha256(random uuid)` while the endpoint looked
      up `sha256(refresh token)`, so no token ever matched — and had they
      matched, GoTrue rotates refresh tokens on use, so it would have worked
      once. Tokens are now opaque secrets, stored only as a hash, exchanged for
      a short-lived signed user JWT that RLS applies to.

### E. Marketing site rebuild — done
- [x] Home, pricing and the shared chrome rebuilt on the design system.
- [x] Product imagery drawn from the real components, and labelled as an
      illustration rather than passed off as somebody's transcript.
- [x] Privacy, terms, security, changelog, and an agent-access page whose tool
      list is generated from the real tool definitions.
- [x] Sitemap covers everything indexable, omits the authenticated pages, and
      uses real `lastModified` dates rather than the build time. Policy pages
      revalidate weekly; the rest is fully static.

### F. Proof
- [x] 940 assertions across six packages, all passing; every package
      typechecks; both apps build.
- [x] **The models were run on real audio**, not just mocked. See
      `packages/asr/verify/diarize.mjs`. It found that the clustering threshold
      was wrong: 0.42 sat on a cliff where a two-speaker clip resolved to four
      speakers, and 0.30 — pyannote's own tuned value — sits in the middle of the
      stable plateau. The identification threshold was corrected the same way,
      from measurements rather than argument.
- [x] E2E browser pass. It found two real defects, both since fixed:
      recording failed **silently** when the browser refused permission (a
      DOMException with no wording and no UI), and the library could hang
      forever on "Opening your library…" because `indexedDB.open` fires
      `blocked` and then neither `success` nor `error`.

## What the audit turned up that the plan did not anticipate

- **Every agent access token ever issued was unusable.** The mint recorded
  `sha256(random uuid)`; the endpoint looked up `sha256(refresh token)`. Even had
  they matched, GoTrue rotates refresh tokens on use.
- **Five colours failed WCAG AA**, including the small label above every section
  at 2.86:1. Found by writing the test, not by looking.
- **The social share image rendered a "P"** as the logo mark.
- **Two more colours had no readable equivalent on the dark chrome**, which is
  why the app's sidebar was using raw Tailwind reds — the fix was a
  `dangerOnInk` token, not a hand-picked hex in a component.
- **The desktop app kept forked copies** of `capture.ts` and `transcriber.ts`
  that were still being imported after the shared versions landed.
- **The open-source FAQ promised** "a supported Docker/Helm bundle, SSO/SAML, an
  admin console and an SLA" in prose, where the plan-data check could not see it.
- **The language picker and the model load plan were separate lists**, so an
  option the plan did not know would silently fall back to English.
