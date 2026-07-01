# ParleyNotes — Overhaul Roadmap

Status of the transformation from a browser-only meeting recorder into the
cross-platform "company brain". This file is the living plan — update it as work
lands. Legend: ✅ done · 🟡 in progress · ⬜ planned.

## Phase 0 — Foundation (this pass)

- ✅ Monorepo (pnpm + Turborepo): `apps/marketing`, `apps/desktop`, `packages/core`, `packages/ui`, `supabase/`
- ✅ `packages/core` — domain model, ported notes/audio logic, Supabase client factory (+ tests)
- ✅ `packages/ui` — design tokens + helpers (single source of truth for look & feel)
- ✅ Supabase schema — orgs, meetings, speakers, segments, notes, tasks, integrations, embeddings + full RLS + `match_embeddings` RAG RPC
- ✅ Desktop app (Tauri 2 + Vite + React) — premium UI, 6 screens, builds + runs
- ✅ Vertical slice — record → on-device transcribe → notes → tasks, stored locally (webview path)
- ✅ Shared data-access layer in `packages/core` (RLS-aware Supabase repository, used by app + MCP server)

## Phase 1 — Accounts & calendar (task #7)

- ✅ Supabase Auth: Google + Microsoft (Azure) OAuth, personal **and** work; sign-in UI + session
- ✅ Calendar read scopes + fetch (Google Calendar / Microsoft Graph) → today's events
- ✅ Meeting auto-prompt: native Tauri notification ~1 min before start with one-click **Record** (Today list on Brain)
- ⬜ Org creation flow + membership admin (first user becomes admin) — needs live backend

## Phase 2 — Native on-device AI (task #8)

- ✅ whisper.cpp transcription (whisper-rs) as a Tauri command; per-segment confidence
- ✅ sherpa-onnx diarization (sherpa-rs) → per-speaker segments; merge labels onto transcript (Rust-tested)
- ✅ Recorder auto-selects native engine when compiled + models present; webview fallback otherwise
- ✅ Model download command + Integrations "On-device AI" status card
- 🟡 Voice-print enrolment for named-colleague identity likelihood (embedding extractor wired; enrolment UI pending)
- ✅ llama.cpp OpenAI-compatible endpoint (`:8081/v1`) used for chat + embeddings (documented in docs/NATIVE_AI.md)

## Phase 3 — Chat & RAG (task #9)

- ✅ In-meeting chat grounded in the live transcript
- ✅ Ask-anytime over your meetings + org hive mind (semantic search) with keyword fallback
- ✅ Embeddings pipeline: chunk (core, tested) → on-device embed → pgvector; Ask uses `match_embeddings` RPC

## Phase 4 — Integrations (task #10)

- ✅ Notion: markdown→blocks converter (core, tested) + OAuth (`notion-oauth` edge fn) + server-side save (`notion-save` edge fn, token stays off-device)
- ✅ "Save to Notion" (meeting view) + auto-save-on-completion toggle
- ✅ Generic integrations table/framework (secrets in `integration_secrets`); OneNote + Google Docs are next
- ⬜ Two-way task sync

## Phase 5 — Hive mind, admin & paid MCP (task #11)

- ✅ Admin default-sharing policy (UI toggle; RLS enforces org visibility)
- ✅ Paid **MCP server** (`apps/mcp-server`): list/search/get meetings + list tasks over RLS-protected queries; stdio transport for Claude/Cursor
- ✅ Org-wide semantic search (the hive mind) via `match_embeddings`
- ✅ Billing gate + MCP config issuance (`mcp-token` edge fn, `mcp_tokens` table, plan-gated UI)

## Phase 6 — Platform fan-out (task #12)

The shared Tauri codebase + full icon set (macOS/Windows/iOS/Android, generated)
are in place. Bringing up each mobile target is an interactive, device-tested
step (can't be verified headless):

- ⬜ iOS: `pnpm --filter @parleynotes/desktop tauri ios init` then `… tauri ios dev` (Xcode 26.6 present). Native mic capture via the shell.
- ⬜ Android: install NDK, `tauri android init`, `tauri android dev`.
- ⬜ Windows: `tauri build` on a Windows host.
- Note: the webview recorder (getUserMedia) works in all shells today; the native whisper/sherpa engine needs per-platform lib linking (see docs/NATIVE_AI.md, sherpa-rs cross-compile notes).

## Debt / follow-ups

- ⬜ Migrate `apps/marketing` off its local `lib/{summarize,audio,ai-notes}` copies onto `@parleynotes/core` (single source of truth)
- ⬜ Update the Vercel project **Root Directory** to `apps/marketing` (monorepo move)
- ⬜ Validate migrations against a live Supabase project (Docker/`supabase db reset`)
- ⬜ Manual test: live mic/system-audio recording end-to-end in the native shell
