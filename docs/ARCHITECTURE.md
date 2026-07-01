# ParleyNotes — Architecture

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
4. **Premium by default.** The UI/UX is calm, fast and considered.

## Monorepo layout

```
parleynotes/
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

## Data flow — a meeting

```
Calendar (Google/MS) ──▶ auto-prompt ("Record?") ──▶ Record screen
        │                                                  │
        ▼                                                  ▼
 native audio capture ──▶ whisper.cpp ──▶ live transcript ──▶ sherpa-onnx
 (mic + system)                                   │            (who spoke, p=…)
                                                  ▼
 in-meeting chat ◀── llama.cpp ◀── context (live transcript + past meetings +
                                             Notion + colleagues' shared notes)
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

## Native AI (Rust) — planned interface

The webview transcriber (`src/lib/transcriber.ts`) defines the contract the
native engine implements as Tauri commands/sidecars:

- `transcribe(pcm) -> segments` (whisper.cpp)
- `diarize(pcm) -> [{speaker, start, end, confidence}]` (sherpa-onnx)
- `identify(speaker_embedding) -> {profileId?, name?, confidence}` (voice match)
- `chat(messages) -> stream` (llama.cpp, OpenAI-compatible on `:8081/v1`)

See `docs/ROADMAP.md` for sequencing.
