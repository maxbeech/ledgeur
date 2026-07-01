# Changelog

## [0.3.0] — 2026-07-01 — Native AI, calendar, integrations, RAG & MCP

Builds on the Phase 0 foundation with the full feature set (real code + tests;
items needing live secrets or model downloads have explicit failure states and
documented manual tests).

### On-device AI (native engine)
- Rust `ai` module: **whisper.cpp** transcription (`whisper-rs`) with per-segment confidence, **sherpa-onnx** speaker diarization (`sherpa-rs`), and a pure, unit-tested transcript↔speaker merge. Behind the `native-ai` Cargo feature; explicit failure when not compiled (never fake output). Tauri commands: `ai_status`, `download_models`, `transcribe_chunk`, `transcribe_diarize`.
- Model download command + Integrations "On-device AI" status card.
- Recorder auto-selects the native engine (real speaker labels + confidence on stop) and falls back to the webview (transformers.js) model otherwise.
- `docs/NATIVE_AI.md` documents the build, models, and the llama.cpp chat/embeddings server.

### Accounts, calendar & auto-prompt
- Supabase Auth (Google + Microsoft, personal or work) with calendar read scopes; sign-in/out UI + session state.
- Today's calendar on the Brain screen (Google Calendar / Microsoft Graph) with one-click Record.
- Native meeting auto-prompt notification ~1 min before a meeting starts (pure scheduler in core, tested).

### Integrations & RAG
- Notion: OAuth (edge function) + server-side save (edge function; keeps token off-device); "Save to Notion" + auto-save toggle. Markdown→blocks converter in core (tested).
- RAG: core chunker (tested) → on-device embeddings → pgvector; Ask uses the RLS-aware `match_embeddings` hive-mind search with keyword fallback.

### Billing & MCP
- Plan-gated MCP access: `mcp-token` edge function + `mcp_tokens` table; Integrations "Generate MCP config" (upgrade CTA on free plan, ready-to-paste config on paid). MCP server now authenticates via the user's refresh token (RLS-correct, auto-refreshing).

### Data & infra
- Migrations `0003`: `integration_secrets` (service-role only), `mcp_tokens`, `calendar_events`, `org_is_paid()`.
- Shared data layer in core (`data/repository`, `data/rows`) used by app + MCP server.
- Marketing: `/oauth/notion` callback page (noindex, excluded from sitemap).

## [0.2.0] — 2026-07-01 — Overhaul Phase 0: cross-platform foundation

The product pivots from a browser-only meeting recorder into **the centre of the
company's brain** — a cross-platform app (macOS · Windows · iOS · Android) with
on-device AI and a Supabase backend.

### Added
- **Monorepo** (pnpm workspaces + Turborepo): `apps/marketing`, `apps/desktop`, `packages/core`, `packages/ui`, `supabase/`.
- **`@parleynotes/core`** — shared domain model, ported notes/audio logic, note→domain mappers, Supabase client factory. 28 unit tests.
- **`@parleynotes/ui`** — design tokens + framework-agnostic helpers (single source of truth for the premium look & feel).
- **`apps/desktop`** — Tauri 2 + Vite + React app targeting all four platforms:
  - Premium UI with 6 screens: Brain (home), Record, Meetings, Meeting detail, Ask, Tasks, Integrations.
  - Working **record → on-device transcribe → notes → tasks** vertical slice (webview path), cached locally in IndexedDB.
  - In-meeting + anytime chat UI grounded in real context (targets the local llama.cpp sidecar; explicit failure if unavailable — never fabricates).
  - Honest empty/failure states throughout (no dummy data): calendar/connections show "connect" states until the backend is configured.
  - Generated app icon + full macOS/Windows/iOS/Android icon set.
- **Supabase schema** (`supabase/migrations`): orgs, profiles, memberships, meetings, speakers, transcript segments, notes, action items, integrations, and pgvector embeddings — with full **RLS** enforcing the hive-mind sharing model and a `match_embeddings` RAG RPC.
- **Shared data layer** (`packages/core/src/data`): RLS-aware Supabase repository (list/get/search meetings, tasks, semantic-search RPC) used by both the app and the MCP server.
- **`@parleynotes/mcp-server`** — the paid tier: a Model Context Protocol server (stdio) exposing `list_meetings`, `search_meetings`, `get_meeting`, `list_tasks` to Claude/Cursor/etc., authenticated per-user so RLS is never bypassed.
- **Notion export** (`packages/core/src/integrations`): pure, tested markdown→Notion-blocks converter + API client; "Save to Notion" wired in the meeting view.
- **Docs**: `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`.

### Changed
- Existing Next.js marketing site moved intact to `apps/marketing` (history preserved). Package renamed `@parleynotes/marketing`. Its 38 tests still pass.
- Standardised the workspace on **pnpm** (removed the npm lockfile).

### Migration notes
- Update the Vercel project **Root Directory** to `apps/marketing`.
- Apply `supabase/migrations` to a Supabase project and set `apps/desktop/.env` to enable accounts/sync.

### Not yet implemented (see ROADMAP)
- Auth + calendar + meeting auto-prompt · native whisper.cpp/sherpa-onnx/llama.cpp · RAG across the hive mind · Notion export · paid MCP server · iOS/Windows/Android builds.
