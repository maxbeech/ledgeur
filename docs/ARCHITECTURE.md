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
4. **Premium by default.** The UI/UX is calm, fast and considered. One design
   system (`packages/ui`) for the app, the phone and the site: Plus Jakarta
   Sans for everything read or operated (bundled, offline), a neutral canvas,
   and six pastel families used semantically — iris for the brand and the
   copilot, mint for live/you/sync, peach for recording and danger, butter for
   warnings, sky and rose for people. Light and dark, both measured for
   contrast. `packages/ui/src/tokens.ts` is the single source; `tokens.css`
   is generated from it (`pnpm --filter @ledgeur/ui build:theme`) and a test
   fails if the two differ. See `docs/REDESIGN.md`.
5. **One app, every device.** The phone app is the desktop app — same React
   code, same Rust core, same account — with a shell that adapts (bottom tabs,
   microphone-only capture, the model downloaded on first record). Meetings
   carry the same id on every device, and edits sync both ways. See
   `docs/MOBILE.md` and "Sync" below.

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
 in-meeting chat ◀── llama.cpp ◀── context (speaker-labelled live transcript +
        │                           speaker roster + your typed notes +
        │                           Contextely + Notion + calendar + ranked past
        │                           meetings — see "Grounding" below)
        │
        ▼ (on stop)
 notes + action items ──▶ local cache (SQLite/IndexedDB) ──▶ Supabase sync
                                   │                              │
                                   ▼                              ▼
                          Tasks section                 embeddings (pgvector)
                                   │                              │
                                   ▼                              ▼
                          Notion export                 hive mind + MCP server
                                   │
                                   ▼
                    follow-up email draft · signed webhook (meeting.completed)
```

## Sync — the same meeting on every device

`apps/desktop/src/lib/sync.ts` keeps the device's cache (IndexedDB) and the
account in step; the rules of who wins are pure and tested in
`packages/core/src/data/merge.ts`.

```
 record / import / edit ─▶ IndexedDB (stamped updatedAt, dirty) ─┐
                                                                  ▼
   push: new meetings (device-supplied uuid), edits (meta / full),  Supabase
         tombstones, spaces, recipes                                  │
   pull: every meeting the account can see, changed since last pull ◀┘
   listen: Realtime on meetings · meeting_notes · action_items · folders · note_templates
```

- **Ids are the device's.** A meeting is inserted under the uuid it has
  locally, so the laptop and the phone hold it under one id and an update is
  an update, not a second copy.
- **The later edit wins.** Every edit stamps `updatedAt` with the device's
  clock and the stamp travels unchanged; the comparison is always device
  against device, never device against server.
- **Deletions are tombstones** (`deleted_at`) so the other device learns,
  rather than pushing the meeting straight back from its cache.
- **What never syncs:** voice prints and the copilot thread. `remoteSpeakers`
  is the only path from a local speaker to the wire and carries no embedding.
- **Two backends.** The engine needs `supabase/migrations/0007_sync.sql`.
  Against a backend without it, it does what the old code could — push each
  new meeting once, pull the list — and Settings says so ("Limited") with the
  migration's name, rather than failing quietly.

## Grounding — what a question is allowed to see

Both surfaces that answer questions (the app-wide **Ask** and the **in-meeting
copilot**) are built by the same code, in `packages/core/src/context/`:

```
question
   │
   ├─ the room (in-meeting only) ──── selectTranscriptContext ── speaker-labelled,
   │                                    timestamped, recent tail always kept,
   │                                    earlier passages retrieved, elisions marked
   │                                  speakerRoster · the user's typed notes
   │
   └─ the company (both) ─── Contextely · Notion · org embeddings ·
                             past meetings (ranked) · calendar
                             ↓  gathered in parallel, per-source outcomes
                          packContext  →  whole blocks to a budget, by relevance,
                             ↓            reporting what it dropped
                    buildGroundedPrompt  →  "meeting" or "library" framing
                             ↓
                          the model  →  answer + the source names behind it
```

Three rules the code enforces rather than hopes for:

- **The transcript is pinned.** A question asked inside a meeting is about that
  meeting even when it shares no vocabulary with it ("what did I miss?").
- **A source that failed is named**, with its own error, not silently absent.
  The in-meeting path additionally gives remote sources a five-second deadline
  and reports whatever missed it — in a live conversation, a complete answer
  that arrives late is worth less than a partial one that arrives now.
- **The answer carries its provenance.** The source names are rendered under the
  bubble, because "grounded in the company's memory" and "grounded in the last
  four minutes of speech" are different claims and the prose does not
  distinguish them.

Notes carry provenance too: `attributeMeetingNotes`
(`packages/core/src/notes/provenance.ts`) links each note line back to the
transcript lines it came from, and deliberately returns **no** citation below a
support threshold — a wrong citation is worse than none, because it looks
verified.

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

- `transcribe_chunk(pcm) -> segments` (whisper.cpp, per-segment confidence, and
  a live speaker label where the utterance carries enough speech to place one —
  `speaker_label` is null rather than guessed when it does not)
- `reset_live_speakers()` — forget the previous take's voices; speaker numbering
  only means anything within one meeting
- `diarize_meeting(pcm) -> speaker turns` — the pass on stop: sherpa-onnx
  diarization + voice identification against enrolled profiles (named labels
  with `confidence`, anonymous "Speaker N" otherwise). It returns turns for the
  caller to lay over the live transcript (`attributeSpeakers` in
  `@ledgeur/core`); it deliberately does not re-transcribe
- `enroll_voice(name, pcm)` / `list_voice_profiles()` / `delete_voice_profile(id)`
  — on-device voice prints (`voices.json`), cosine matching (tested)
- Chat / embeddings / suggestions speak to llama.cpp (OpenAI-compatible, `:8081/v1`)
  via the shared `modelFetch` wrapper, which turns connection failures into
  explicit "model isn't running" errors.

See `docs/ROADMAP.md` for sequencing.
