# Ledgeur

**The centre of your company's brain.** Ledgeur records meetings, transcribes
them, and works out **who said what** — all on your own device. Name a voice once
and it is recognised in every meeting after that. Drag in recordings you already
have and they are treated exactly like live ones.

The app is **free**, permanently, for one person: unlimited recording,
transcription, speaker separation, notes, search and export. The paid tier is
what happens when the record has to leave your machine — sync across your
devices, a shared team library, and a Model Context Protocol endpoint that opens
your meetings to Claude, ChatGPT or Cursor.

Nothing goes in the price list unless it ships. See
[`apps/marketing/lib/plans.ts`](apps/marketing/lib/plans.ts), which carries that
rule and a test that enforces it.

> One app for macOS, Windows, iOS and Android, built on Tauri 2 + Supabase,
> on one design system (`packages/ui`: Plus Jakarta Sans, a neutral canvas,
> six pastel families, light and dark — every colour pairing measured). The
> phone app is the same code as the desktop app and syncs with it under the
> same meeting ids. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
> [`docs/MOBILE.md`](docs/MOBILE.md), [`docs/REDESIGN.md`](docs/REDESIGN.md)
> and [`docs/ROADMAP.md`](docs/ROADMAP.md).

The Vercel marketing app sends errors, low-volume performance traces, source maps, and user feedback to Sentry; no telemetry runs if `NEXT_PUBLIC_SENTRY_DSN` is absent.

## Monorepo

| Path | What |
|---|---|
| `apps/desktop` | The app — Tauri 2 + Vite + React (all platforms) |
| `apps/marketing` | Next.js 16 marketing/SEO site (Vercel) |
| `packages/core` | Shared domain model, diarization logic, the meeting library, browser controllers, auth wording, notes/audio logic, Supabase client |
| `packages/asr` | Browser speech-to-text **and speaker-diarization** workers + their load plans (synced into each app's `public/`) |
| `packages/ui` | Design tokens, the shared `theme.css`, and the React primitives both apps render |
| `supabase/` | Database schema (migrations) — source of truth for data |

## Develop

```bash
pnpm install                 # install the whole workspace

# App (browser preview :1420) + marketing (:3000) together
pnpm dev

# Just the app (browser preview — fast UI iteration, on-device transcription)
pnpm desktop:dev             # http://localhost:1420

# The app (native window with the Rust core)
pnpm --filter @ledgeur/desktop tauri:dev

# iOS (requires Xcode) and Android (requires the SDK, NDK and JDK 17) — see docs/MOBILE.md
pnpm --filter @ledgeur/desktop ios:dev
pnpm --filter @ledgeur/desktop android:dev

# Regenerate the design tokens' CSS after editing packages/ui/src/tokens.ts
pnpm --filter @ledgeur/ui build:theme

# The marketing site
pnpm marketing:dev

# The paid MCP server (needs Supabase creds — run it on its own, not part of dev)
LEDGEUR_SUPABASE_URL=… LEDGEUR_SUPABASE_ANON_KEY=… LEDGEUR_REFRESH_TOKEN=… \
  pnpm --filter @ledgeur/mcp-server start

# Everything
pnpm build      # turbo build across all packages
pnpm test       # turbo test
pnpm lint
```

> Use **pnpm**, not npm — this is a pnpm workspace. `npm run dev` also works but
> prints harmless `Unknown project config` warnings for pnpm-only `.npmrc` keys.

### Configure the backend (optional for local UI work)

The app runs in **local-only** mode with no configuration (recordings are cached
in IndexedDB). To enable accounts, sync and the hive mind, create
`apps/desktop/.env` from [`apps/desktop/.env.example`](apps/desktop/.env.example)
and apply the schema in `supabase/migrations` to your Supabase project.

## How speaker separation works

Two models, both in the browser, both free:

| Stage | Model | What it answers |
|---|---|---|
| Segmentation | `onnx-community/pyannote-segmentation-3.0` | Where does the voice change? Handles up to three people talking at once. |
| Embedding | `onnx-community/wespeaker-voxceleb-resnet34-LM` | What does this stretch of speech sound like, as a vector? |

The deciding — clustering those vectors into people, and matching them against
voices you have already named — is pure TypeScript in
[`packages/core/src/diarize`](packages/core/src/diarize), so it is unit-tested
without a browser and shared by the live and imported paths.

A live meeting analyses each drained slice as it arrives and keeps only the turns
and their vectors, never the audio: an hour at 16 kHz is ~230 MB of Float32, and
holding that in a tab to diarize at the end is not reasonable. Clustering still
runs once over everything at the end, because "which of these voices is the same
person" cannot be answered twenty seconds at a time.

Voice prints live in IndexedDB and are **never synced**, not even on the paid
plan — a voice print identifies a person after the transcript is deleted.

### Putting names to the voices

Separation gives you "Speaker 1" and "Speaker 2", which is useful once. Meetings
usually say who is present, though — someone introduces themselves, or answers to
their name — so when a recording finishes, the on-device model reads the
transcript and names the voices it can prove.

Nothing here guesses from patterns. There is deliberately no regex pulling
"I'm X" out of a transcript: it cannot tell "I'm Max" from "I'm afraid not". The
model proposes, and
[`packages/core/src/diarize/names.ts`](packages/core/src/diarize/names.ts) then
throws out anything it cannot check —

* the name must actually be spoken in the transcript;
* the model's quoted evidence must be a real line, and must be the line that
  says the name;
* it must clear a belief threshold (0.75 to label, 0.85 to teach the voice);
* one name per voice, one voice per name.

Every name that survives is shown **as a guess** — a mark on the chip, the belief,
and the words it came from — everywhere it appears, and is one click to accept,
change, or reject. Correcting a guess also *un*-teaches whatever it taught the
voice store, so a wrong name cannot quietly propagate into later meetings. A
single misattributed line can be moved on its own, without touching the voice.

To recognise somebody next time, a few seconds of their speech is kept with the
meeting — chosen for blandness rather than convenience. Every candidate window is
scored for card numbers, credentials, salaries, health and the like
([`snippet.ts`](packages/core/src/diarize/snippet.ts)), the least sensitive one
wins, and if a person's every stretch looks sensitive, nothing is kept at all.
Like voice prints, these samples never leave the device — asserted by a test, not
just by this paragraph.

## Status

Phases 0–5 are code-complete. The 2026-07 **"Library of Record" redesign**
shipped, followed by the **seamless on-device copilot** update:

- The copilot, coaching suggestions and post-meeting notes run **in-process**
  (llama.cpp via `llama-cpp-2`) — nothing to install; the model is auto-downloaded
  once (one tap) and cached. Notes fall back to a local heuristic when offline.
- The live meeting is **one continuous chat thread** — transcript, copilot and
  your questions as bubbles you can quote; the right rail is just your notes.
- The whole app is a **chat surface** with an ever-present bottom input; each
  screen renders as an embedded window card.

The 2026-08 **overhaul pass** added on-device speaker separation everywhere,
voice prints that persist between meetings, drag-and-drop import, a real web app
with a searchable library, accounts and billing on the web, and a price list that
describes only what exists. It also fixed a checkout that took money without
activating anything and an access-token scheme in which every token issued was
unusable. See [`docs/OVERHAUL.md`](docs/OVERHAUL.md) and the
[changelog](CHANGELOG.md).

The 2026-09 **grounding pass** rebuilt what a question is allowed to see. Asking
something mid-meeting now reaches the live transcript *with speakers and
timestamps*, who has spoken, your own typed notes, and — in the same prompt —
Contextely company memory, Notion, the org's indexed meetings and your past
recordings, on a five-second deadline that names whatever did not arrive in
time. Every answer shows the sources it was grounded in. The same pass added
per-line provenance from notes back to the transcript, follow-up email drafts,
user-written note recipes, 32 spoken languages, spaces, a derived people
directory, signed outbound webhooks, calendar auto-start and SAML SSO.

The 2026-09-06 **redesign, phone and sync pass** replaced the design system
outright — one sans family, a neutral canvas with six pastel families, light
and dark, a generated token sheet the two apps cannot drift from — and
rebuilt every screen of the app and every page of the site on it. The same
pass generated the iOS and Android projects (the phone is the same app with a
phone shell) and replaced one-shot, one-way sync with an engine that pushes
every edit, pulls every change, honours deletions, and listens for the other
device over Realtime. See [`docs/REDESIGN.md`](docs/REDESIGN.md) and
[`docs/MOBILE.md`](docs/MOBILE.md).

The 2026-09-08 **capture pass** gave the product a second way in. Recording a
meeting was the only one, so the thought you have on the way out of one went
nowhere. There is now a box for it (`⌘⇧K`, a phone tab, a home-screen and
lock-screen widget) that takes a thought typed or spoken and keeps it in one
action. The on-device model then decides whether it was a task or a note and
which space it belongs to, under the same rules speaker naming works by: it may
only choose a space you already have, it has to quote the words it decided on,
and it has to clear a belief threshold or leave the thought in the inbox. The
thought is on disk before any of that runs, so a missing or wrong model can
change where it lands but never whether it survived. Spaces became projects in
the same pass: a space now has its own page holding its meetings, its tasks and
its notes, and a finished meeting files itself into one.

Earlier: editorial design system, ⌘K palette, mobile tab bar, recordings that
survive navigation. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's next,
[`docs/NATIVE_AI.md`](docs/NATIVE_AI.md) for the on-device engine, and
[`docs/MANUAL_TESTING.md`](docs/MANUAL_TESTING.md) for flows that need live
services or a device, and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for what has
to be configured — including `SUPABASE_JWT_SECRET`, which is new and which the
hosted agent endpoint cannot work without.

## Licence

MIT © Ledgeur
