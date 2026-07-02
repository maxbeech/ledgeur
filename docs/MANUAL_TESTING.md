# Manual test checklist

Automated coverage: unit tests (core 58, marketing 38, Rust 5), TypeScript
typechecks, desktop + marketing builds, native-ai `cargo check`, and a browser
E2E of all screens at desktop + mobile sizes — seeded meeting → Library →
Detail (notes/transcript/speakers) → Tasks toggle persistence → command
palette → delete-confirm flow, with a console-error sweep (all passing).

The flows below **require live external services, model downloads, or a device**,
so they can't be verified headless in CI — verify these by hand once configured.

## Backend (Supabase)
1. Apply `supabase/migrations` (`supabase db push`) + deploy edge functions
   (`supabase functions deploy notion-oauth notion-save mcp-token`).
2. Set `apps/desktop/.env` (see `.env.example`) with your Supabase URL + anon key.
3. Sign in (Integrations → Account → Google / Microsoft). Sidebar shows "Synced".

## Calendar auto-prompt
4. With calendar scopes granted, the Home "Today" list shows real events (a
   meeting happening now shows a pulsing "Happening now" and an accent Record button).
5. ~1 min before an event, a native notification fires (desktop build). Clicking
   Record on an event prefills the meeting title.

## Native on-device AI (see docs/NATIVE_AI.md)
6. `tauri:dev:ai` → Settings → On-device AI shows "Native" + Download models.
7. Record a short meeting → live transcript; on stop, multiple `Speaker N` labels
   + per-segment confidence appear.
8. Start a llama.cpp server (`:8081`) → in-meeting chat + Ask return grounded
   answers; with the model off, both show an explicit "model unavailable" error.
8a. **Voice ID**: Settings → Voice profiles → enrol yourself (~10 s). Record a
    meeting where you speak → the transcript names you with a confidence figure
    (e.g. "Max · 84%"); other voices stay "Speaker N". Delete the profile and
    confirm the next recording is anonymous again.
8b. **Recording survives navigation**: start recording, visit Library/Ask, the
    sidebar shows a live pill with elapsed time; return via the pill — the take
    (and anything typed in the Notes tab) is intact; stop → the meeting's notes
    include a "Your notes" section.
8c. **Suggestions**: during a recording with the llama.cpp server up, the
    Suggest tab returns 3 grounded "you could say" lines (Auto refreshes every
    60 s); with the model off it shows the explicit unavailable error.

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
