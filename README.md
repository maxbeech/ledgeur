# ParleyNotes

**The centre of your company's brain.** ParleyNotes records and transcribes
meetings on your device, turns them into notes and action items, and lets anyone
on your team ask questions across everything the company has ever discussed.

The app is **free**. The paid tier is access to your _data_ — a Model Context
Protocol (MCP) server that opens your knowledge base to Claude, ChatGPT and any
MCP-aware tool, plus the cross-user **hive mind**.

> Previously a browser-only meeting recorder — now a cross-platform product
> (macOS · Windows · iOS · Android) built on Tauri 2 + Supabase. See
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Monorepo

| Path | What |
|---|---|
| `apps/desktop` | The app — Tauri 2 + Vite + React (all platforms) |
| `apps/marketing` | Next.js 16 marketing/SEO site (Vercel) |
| `packages/core` | Shared domain model, notes/audio logic, Supabase client |
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
pnpm --filter @parleynotes/desktop tauri:dev

# iOS (requires Xcode)
pnpm --filter @parleynotes/desktop ios:dev

# The marketing site
pnpm marketing:dev

# The paid MCP server (needs Supabase creds — run it on its own, not part of dev)
PARLEY_SUPABASE_URL=… PARLEY_SUPABASE_ANON_KEY=… PARLEY_REFRESH_TOKEN=… \
  pnpm --filter @parleynotes/mcp-server start

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

Phase 0 (foundation) is complete and the app builds and runs. See
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what's next.

## Licence

MIT © ParleyNotes
