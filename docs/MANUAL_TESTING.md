# Manual test checklist

## Rebrand (2026-07-08): TO STILL TEST

The ParleyNotes → Ledgeur rename was verified headless (cargo check, typecheck,
lint, unit tests all pass) and the marketing site was browser-tested end to end
(no leftover "ParleyNotes" text, no broken links, clean titles/OG tags). The
native Tauri desktop app window itself was **not** browser-testable, so verify
by hand:
- `pnpm --filter @ledgeur/desktop tauri:dev` — native window title bar reads
  "Ledgeur" (from `tauri.conf.json` → `productName`), macOS app name in the
  menu bar/Dock reads "Ledgeur".
- macOS: since the bundle identifier changed (`com.parleynotes.app` →
  `com.ledgeur.app`), a fresh dev build creates a **new**, empty
  `~/Library/Application Support/com.ledgeur.app` — any local recordings/data
  under the old identifier are not migrated (expected pre-launch; note if you
  have local test data you care about).
- Sidebar/Home/Ask screens render "Ledgeur" text correctly (plain string
  swap, low risk, but not yet screenshotted).

## Domain: ledgeur.com — DNS pending (2026-07-08)

`ledgeur.com` is registered by the user and has been added + attached to the
`ledgeur` Vercel project (`vercel domains add`, confirmed `domainOwnership:
"current-scope"`). It is **not yet resolving to Vercel** — the domain's
current nameservers (`ns1098.ui-dns.biz`, `ns1106.ui-dns.com`,
`ns1109.ui-dns.org`, `ns1110.ui-dns.de` — an IONOS/1&1-style registrar) still
point at the old host. This requires DNS-provider access Claude Code doesn't
have. To finish, at the domain's DNS provider, do **one** of:
- **Recommended (keep existing DNS provider)**: add an `A` record —
  `@ → 76.76.21.21` (or the two apex IPs `216.150.1.1` / `216.150.16.1` from
  `vercel domains inspect ledgeur.com`) — then run
  `vercel domains verify ledgeur.com`.
- **Or** change nameservers to `ns1.vercel-dns.com` / `ns2.vercel-dns.com` to
  let Vercel manage DNS entirely.

Until this is done, `ledgeur.com` will not serve the site — `site.ts`'s `url`
field correctly still points at `https://ledgeur.vercel.app`, which is live
now.

Automated coverage: unit tests (core 58, marketing 38, Rust 5), TypeScript
typechecks, desktop + marketing builds, native-ai `cargo check`, and a browser
E2E of all screens at desktop + mobile sizes — seeded meeting → Library →
Detail (notes/transcript/speakers) → Tasks toggle persistence → command
palette → delete-confirm flow, with a console-error sweep (all passing).

The flows below **require live external services, model downloads, or a device**,
so they can't be verified headless in CI — verify these by hand once configured.

## Backend (Supabase)
1. Apply `supabase/migrations` (`supabase db push`) + deploy edge functions
   (`supabase functions deploy notion-oauth notion-save notion-context mcp-token`).
2. Set `apps/desktop/.env` (see `.env.example`) with your Supabase URL + anon key.
3. Sign in (Integrations → Account → Google / Microsoft). Sidebar shows "Synced".

## Calendar auto-prompt
4. With calendar scopes granted, the Home "Today" list shows real events (a
   meeting happening now shows a pulsing "Happening now" and an accent Record button).
5. ~1 min before an event, a native notification fires (desktop build). Clicking
   Record on an event prefills the meeting title.
5a. **Google Calendar card**: Integrations → Connections shows a real "connected"
    state (not the old dead placeholder) once signed in with Google, with a live
    "N events today" count; signed out shows a working "Connect Google Calendar"
    button that starts the same OAuth flow as Account → Google.
5b. **Calendar as Ask context**: with a Google/Microsoft calendar connected and
    events on your calendar this week, ask "what's on my calendar this week?" —
    the answer should cite "(Calendar)" and list real event titles/times, not
    a generic "I don't have that information" response.
5c. **Packaged-app CSP**: run a built (not dev-server) desktop app with calendar
    connected and confirm today's events still load — this was previously at
    risk of being silently blocked by CSP (`googleapis.com`/`graph.microsoft.com`
    are now in `connect-src`).

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
12. **Notion as Ask context**: with Notion connected and a shared page whose
    title matches your question (e.g. a page titled "Roadmap" and you ask
    "what's on the roadmap?"), the Ask answer should cite "(Notion: Roadmap)"
    with real page content — not a fabricated answer. Note Notion's search
    matches page titles more reliably than body text, so phrase test questions
    around a real page's title.

## Paid MCP
13. On a free org, "Generate MCP config" shows the upgrade CTA. On a paid org it
    returns a config; paste it into Claude/Cursor and confirm the tools list/query
    meetings under your RLS.

## Mobile / other platforms (task #12)
14. iOS: `tauri ios init` then `tauri ios dev` (Xcode). Android: NDK + `tauri android`.
    Windows: `tauri build` on Windows.

## Error tracking (Sentry)
15. With `VITE_SENTRY_DSN`/`SENTRY_DSN` set in `apps/desktop/.env`, throw a test
    error from the console (`throw new Error("test")`) and confirm it appears
    in the `ledgeur/ledgeur-desktop` Sentry project within a minute.
16. `tauri:dev`: confirm `log::info!` lines from `src/ai/mod.rs` (e.g. starting
    a model download) appear in the terminal running `tauri dev`.
17. Blank both DSN vars and confirm the app behaves identically with zero
    network calls to Sentry (check the Network tab / no `ingest.sentry.io` requests).
