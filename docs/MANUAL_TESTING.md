# Manual test checklist

Automated coverage: unit tests (core 49, marketing 38, Rust merge 2), TypeScript
typechecks, desktop + marketing builds, native-ai `cargo check`, and a headless
browser E2E of all six app screens (all passing).

The flows below **require live external services, model downloads, or a device**,
so they can't be verified headless in CI — verify these by hand once configured.

## Backend (Supabase)
1. Apply `supabase/migrations` (`supabase db push`) + deploy edge functions
   (`supabase functions deploy notion-oauth notion-save mcp-token`).
2. Set `apps/desktop/.env` (see `.env.example`) with your Supabase URL + anon key.
3. Sign in (Integrations → Account → Google / Microsoft). Sidebar shows "Synced".

## Calendar auto-prompt
4. With calendar scopes granted, the Brain "Today" list shows real events.
5. ~1 min before an event, a native notification fires (desktop build). Clicking
   Record on an event prefills the meeting title.

## Native on-device AI (see docs/NATIVE_AI.md)
6. `tauri:dev:ai` → Integrations → On-device AI shows "Native" + Download models.
7. Record a short meeting → live transcript; on stop, multiple `Speaker N` labels
   + per-segment confidence appear.
8. Start a llama.cpp server (`:8081`) → in-meeting chat + Ask return grounded
   answers; with the model off, both show an explicit "model unavailable" error.

## RAG / hive mind
9. After recording while signed in, the meeting syncs to Supabase and is indexed
   (needs the embeddings endpoint). Ask surfaces it via semantic search; org-shared
   meetings appear for colleagues, private ones do not (verify RLS with 2 accounts).

## Notion
10. Integrations → Notion → Authorize (opens Notion) → paste code → Connected.
11. Meeting → "Save to Notion" creates a page; enable auto-save and record again.

## Paid MCP
12. On a free org, "Generate MCP config" shows the upgrade CTA. On a paid org it
    returns a config; paste it into Claude/Cursor and confirm the tools list/query
    meetings under your RLS.

## Mobile / other platforms (task #12)
13. iOS: `tauri ios init` then `tauri ios dev` (Xcode). Android: NDK + `tauri android`.
    Windows: `tauri build` on Windows.
