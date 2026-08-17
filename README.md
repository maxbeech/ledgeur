# Ledgeur

**The centre of your company's brain.** Ledgeur records and transcribes
meetings on your device, turns them into notes and action items, and lets anyone
on your team ask questions across everything the company has ever discussed.

The app is **free**. The paid tier is access to your _data_ — a Model Context
Protocol (MCP) server that opens your knowledge base to Claude, ChatGPT and any
MCP-aware tool, plus the cross-user **hive mind**.

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
| `packages/core` | Shared domain model, notes/audio logic, Supabase client |
| `packages/asr` | Browser speech-to-text worker + model load plan (synced into each app's `public/`) |
| `packages/ui` | Design tokens + helpers |
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

Earlier: editorial design system, ⌘K palette, mobile tab bar, recordings that
survive navigation, and named speaker identification with confidence (voice-print
enrolment, on-device). See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's next,
[`docs/NATIVE_AI.md`](docs/NATIVE_AI.md) for the on-device engine, and
[`docs/MANUAL_TESTING.md`](docs/MANUAL_TESTING.md) for flows that need live
services or a device.

## Licence

MIT © Ledgeur
