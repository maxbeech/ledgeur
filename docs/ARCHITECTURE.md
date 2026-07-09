# Ledgeur — Architecture

> The centre of the company's brain. A cross-platform app that records and
> transcribes meetings on-device, turns them into notes + tasks, and lets anyone
> ask questions across the whole company's knowledge.

## Product principles

1. **The app is free; the data is the product.** Every capability is free. The
   paid tier is _programmatic access_ to your knowledge base (the MCP server) and
   the cross-user **hive mind**. Software is commoditised; the value is the data.
2. **On-device first for capture.** Audio never needs a bot on the call —
   transcription and diarization run locally (whisper.cpp + sherpa-onnx). The
   local LLM (llama.cpp) answers in-meeting questions without the transcript
   leaving the machine.
3. **Cloud for the brain.** A meeting is only useful company-wide if it's
   searchable by others (with permission). Supabase is the shared source of
   truth; the device holds a fast local cache.
4. **Premium by default.** The UI/UX is calm, fast and considered. The design
   language is **"The Library of Record"**: warm paper pages inside dark
   spruce-ink furniture; Fraunces display serif + Schibsted Grotesk UI +
   Spline Sans Mono data type (bundled, offline); strict color semantics —
   emerald = live/you, burnished gold = the brain speaking, madder = recording.
   Tokens live in `packages/ui/src/tokens.ts` and are mirrored by the app's
   `theme.css` `@theme` block.

## Monorepo layout

```
ledgeur/
├─ apps/
│  ├─ marketing/        Next.js 16 SEO/marketing site (Vercel)
│  └─ desktop/          Tauri 2 app — macOS · Windows · iOS · Android
│     ├─ src/           React + Vite frontend (the whole product UI)
│     └─ src-tauri/     Rust core (native audio, on-device AI sidecars)
├─ packages/
│  ├─ core/             Shared domain model, notes/audio logic, Supabase client
│  └─ ui/               Design tokens + framework-agnostic helpers
├─ supabase/            DB schema (migrations) = source of truth for data shapes
└─ docs/                Architecture + roadmap
```

One React/TS frontend runs on every platform via Tauri 2's system webview.
`packages/core` is imported by the app, the backend functions, and the MCP
server, so entity shapes have a single definition (mirrored in `supabase/`).

## Technology choices

| Concern | Choice | Why |
|---|---|---|
| Cross-platform shell | **Tauri 2** | One codebase for all 4 targets; reuses the React UI; Rust is ideal for native on-device AI; tiny bundles. |
| Frontend | React 19 + Vite + Tailwind v4 | Reuses existing React/TS investment; fast HMR. |
| Transcription | **whisper.cpp** (native) / transformers.js (webview preview) | Free, on-device, fast. |
| Diarization | **sherpa-onnx** | On-device speaker segmentation + speaker embeddings → identity likelihood, no Python. |
| Local LLM | **llama.cpp** (OpenAI-compatible server) | In-meeting + anytime Q&A offline; same request shape as cloud fallback. |
| Backend | **Supabase** | Postgres + Auth (Google/Microsoft/SAML) + RLS + pgvector + Storage in one. |
| Semantic search | **pgvector** | RAG over the org hive mind, gated by RLS. |
| Data access (paid) | **MCP server** | Exposes the knowledge base to Claude/ChatGPT/any MCP tool. |
| Error tracking | **Sentry** (`@sentry/react` + the `sentry` Rust crate) | One project (`ledgeur/ledgeur-desktop`) receiving both frontend and native events. Opt-in via `VITE_SENTRY_DSN`/`SENTRY_DSN` in `.env` — blank disables it entirely. |

## Observability

- **Frontend**: `apps/desktop/src/lib/logger.ts` — a scoped `createLogger(name)`
  that always prints a timestamped line to the console (real `pnpm dev`/`tauri
  dev` logs, not just Vite's HMR noise) and, when Sentry is configured, sends
  `warn`/`error` as events and `info`/`debug` as breadcrumbs. `AppErrorBoundary`
  catches render crashes instead of a blank screen; `main.tsx` also installs
  `window.onerror`/`unhandledrejection` handlers.
- **Native**: `tauri-plugin-log` writes Rust `log::info!`/`log::error!` calls to
  the terminal running `tauri dev` and the webview devtools console; the
  `sentry` crate (initialized in `src-tauri/src/lib.rs`) captures panics and
  explicit `capture`/`inspect_err` calls in `src/ai/mod.rs`.
- **Fast Refresh gotcha**: a `.tsx` file that exports both a component and a
  hook (or any other non-component value) breaks Vite Fast Refresh — editing it
  forces a full remount instead of a state-preserving hot update. This is what
  caused an in-progress recording to silently reset during dev (fixed by moving
  `useRecorderCtx`/`useChatDock` into their own files). Keep provider/component
  files and hook files separate.

## Data flow — a meeting

```
Calendar (Google/MS) ──▶ auto-prompt ("Record?") ──▶ Record screen
        │                                                  │
        ▼                                                  ▼
 native audio capture ──▶ whisper.cpp ──▶ live transcript ──▶ sherpa-onnx
 (mic + system)                                   │            (who spoke, p=…)
                                                  ▼
 in-meeting chat ◀── llama.cpp ◀── context (live transcript + past meetings +
                                    Notion + calendar + colleagues' shared notes)
        │
        ▼ (on stop)
 notes + action items ──▶ local cache (SQLite/IndexedDB) ──▶ Supabase sync
                                   │                              │
                                   ▼                              ▼
                          Tasks section                 embeddings (pgvector)
                                   │                              │
                                   ▼                              ▼
                          Notion export                 hive mind + MCP server
```

## Security & sharing (the hive mind)

- Every row is protected by Postgres **RLS** (see `supabase/migrations/0002_rls.sql`).
- A meeting is visible to its owner always, and to org members only when its
  `visibility = 'org'`. Admins set the org **default** (`orgs.default_meeting_visibility`).
- Semantic search runs through `match_embeddings()`, which re-checks membership
  and per-meeting visibility — colleagues' notes surface only when shared.
- The MCP server authenticates as the user/org and reads through the same RLS,
  so external tools never bypass sharing rules. Access requires a paid plan.

## Native AI (Rust) — implemented interface

Tauri commands (real when built with `--features native-ai`; explicit errors otherwise):

- `transcribe_chunk(pcm) -> segments` (whisper.cpp, per-segment confidence)
- `transcribe_diarize(pcm) -> segments` — full pass: transcription + sherpa-onnx
  diarization + voice identification against enrolled profiles (named labels
  with `speaker_confidence`, anonymous "Speaker N" otherwise)
- `enroll_voice(name, pcm)` / `list_voice_profiles()` / `delete_voice_profile(id)`
  — on-device voice prints (`voices.json`), cosine matching (tested)
- Chat / embeddings / suggestions speak to llama.cpp (OpenAI-compatible, `:8081/v1`)
  via the shared `modelFetch` wrapper, which turns connection failures into
  explicit "model isn't running" errors.

See `docs/ROADMAP.md` for sequencing.
