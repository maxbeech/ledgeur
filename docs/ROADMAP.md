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
- ✅ Voice-print enrolment + identification: `enroll_voice`/`list_voice_profiles`/`delete_voice_profile` commands (sherpa-onnx embeddings, cosine match, tested); `transcribe_diarize` labels transcripts with enrolled names + confidence; enrolment UI in Settings
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

## Review pass (2026-07-01) — fixes applied

- ✅ **Security (RLS):** tightened `org_members` self-join — a user can only self-add as the **first** member of an empty org (bootstrap) or be added by an admin; previously any user could join any org and read its shared meetings.
- ✅ **Notion save:** the API can't create a page at the workspace root — now uses the configured database, else auto-discovers the first shared database (and caches it), else returns an explicit error.
- ✅ **Cross-device read-back:** Meetings + Brain now show cloud/workspace meetings (any device) merged with unsynced local ones (`useMeetings`); MeetingDetail opens cloud meetings; removed the now-dead `useLocalMeetings`.
- ✅ **Embeddings RLS:** direct `embeddings` SELECT now enforces per-meeting visibility (was readable by any org member — leaked private transcript chunks).
- ✅ **Hive mind actually works:** the admin toggle now writes `orgs.default_meeting_visibility` (server-side, RLS-enforced) and `pushMeeting` sets each meeting's `visibility` from it — previously a localStorage flag that nothing read, so meetings stayed private forever.
- ✅ **Recorder:** unmount cleanup stops mic/system-audio + drain timer + worker (was leaking on navigate-away mid-recording); native diarization no longer overwrites (and drops the tail of) transcripts for meetings past the retention cap.
- ✅ **Signup bootstrap:** `handle_new_user` now creates a personal org + admin membership, so cloud/sync/MCP/hive-mind work immediately (previously no org existed, silently breaking all cloud paths).

### Known limitation (design follow-up)
- **MCP credential revocation:** the MCP server authenticates with the user's Supabase refresh token, so "revoke" currently = sign out (rotates all sessions). `mcp_tokens` is an audit record; a dedicated revocable minted-token exchange (per-call `revoked`/plan check) is the follow-up. UI copy already states "revoke by signing out" (honest).

## Redesign pass (2026-07-02) — "The Library of Record"

- ✅ Full visual redesign: editorial design system (Fraunces/Schibsted/Spline Sans Mono, bundled offline), strict color semantics, paper grain, motion grammar (`pn-stagger`, halo, shimmer) with reduced-motion support
- ✅ App shell: app-level recorder (recording survives navigation, live sidebar pill), ⌘K command palette, mobile bottom tab bar + responsive layouts, scroll-reset on navigation
- ✅ Req 14 — manual in-meeting notes (Notes tab), woven verbatim into the summary/export (core, tested)
- ✅ Req 13 — proactive "you could say" suggestions (Suggest tab) from the on-device model over the live transcript; parser in core (tested); explicit unavailable state
- ✅ Speaker sync fidelity: `pushMeeting` writes `speakers` rows (label/name/confidence) + segment links; cloud read-back restores them
- ✅ Tasks cross-device: cloud `action_items` with real DB status merged with unsynced local items
- ✅ Friendly explicit local-model errors everywhere (shared `modelFetch`); delete confirmation; Meeting detail speaker legend + confidence figures

## Debt / follow-ups

- ⬜ Migrate `apps/marketing` off its local `lib/{summarize,audio,ai-notes}` copies onto `@parleynotes/core` (single source of truth)
- ⬜ Update the Vercel project **Root Directory** to `apps/marketing` (monorepo move)
- ⬜ Validate migrations against a live Supabase project (Docker/`supabase db reset`)
- ⬜ Manual test: live mic/system-audio recording end-to-end in the native shell
