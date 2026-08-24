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

> Previously a browser-only meeting recorder — now a cross-platform product
> (macOS · Windows · iOS · Android) built on Tauri 2 + Supabase, wearing the
> **"Library of Record"** design language (Fraunces · Schibsted Grotesk ·
> Spline Sans Mono, bundled offline). See
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).

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

# iOS (requires Xcode)
pnpm --filter @ledgeur/desktop ios:dev

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

Earlier: editorial design system, ⌘K palette, mobile tab bar, recordings that
survive navigation. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's next,
[`docs/NATIVE_AI.md`](docs/NATIVE_AI.md) for the on-device engine, and
[`docs/MANUAL_TESTING.md`](docs/MANUAL_TESTING.md) for flows that need live
services or a device, and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for what has
to be configured — including `SUPABASE_JWT_SECRET`, which is new and which the
hosted agent endpoint cannot work without.

## Licence

MIT © Ledgeur
