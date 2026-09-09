# Ledgeur — Overhaul Roadmap

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
- ✅ Google Calendar card in Integrations reflects real connection state (was a dead placeholder); calendar events (next 7 days) are now an Ask context source (`calendar.ts` `calendarContext()`)
- ✅ CSP: `googleapis.com` / `graph.microsoft.com` added to `connect-src` so calendar fetches actually work in the packaged Tauri app, not just dev/browser-preview
- ⬜ Org creation flow + membership admin (first user becomes admin) — needs live backend

## Phase 2 — Native on-device AI (task #8)

- ✅ whisper.cpp transcription (whisper-rs) as a Tauri command; per-segment confidence
- ✅ sherpa-onnx diarization (sherpa-rs) → per-speaker segments; merge labels onto transcript (Rust-tested)
- ✅ Recorder auto-selects native engine when compiled + models present; webview fallback otherwise
- ✅ Model download command + Integrations "On-device AI" status card
- ✅ Voice-print enrolment + identification: `enroll_voice`/`list_voice_profiles`/`delete_voice_profile` commands (sherpa-onnx embeddings, cosine match, tested); `diarize_meeting` labels transcripts with enrolled names + confidence; enrolment UI in Settings
- ✅ llama.cpp OpenAI-compatible endpoint (`:8081/v1`) used for chat + embeddings (documented in docs/NATIVE_AI.md)

## Phase 3 — Chat & RAG (task #9)

- ✅ In-meeting chat grounded in the live transcript
- ✅ Ask-anytime over your meetings + org hive mind (semantic search) with keyword fallback
- ✅ Embeddings pipeline: chunk (core, tested) → on-device embed → pgvector; Ask uses `match_embeddings` RPC

## Phase 4 — Integrations (task #10)

- ✅ Notion: markdown→blocks converter (core, tested) + OAuth (`notion-oauth` edge fn) + server-side save (`notion-save` edge fn, token stays off-device)
- ✅ "Save to Notion" (meeting view) + auto-save-on-completion toggle
- ✅ Notion as Ask context: `notion-context` edge fn does a live Notion search per question and returns page snippets (title-matching, not full-text — a Notion API limitation, not indexed/synced)
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

- ⬜ iOS: `pnpm --filter @ledgeur/desktop tauri ios init` then `… tauri ios dev` (Xcode 26.6 present). Native mic capture via the shell.
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

- ⬜ Migrate `apps/marketing` off its local `lib/{summarize,audio,ai-notes}` copies onto `@ledgeur/core` (single source of truth)
- ⬜ Update the Vercel project **Root Directory** to `apps/marketing` (monorepo move)
- ⬜ Validate migrations against a live Supabase project (Docker/`supabase db reset`)
- ⬜ Manual test: live mic/system-audio recording end-to-end in the native shell

## Capture pass (2026-09-08) — "the thought you have on the way out"

- ✅ **Capture box** — `⌘⇧K` on the laptop, a tab on the phone, a home-screen and
  lock-screen widget. Type it or say it; one action and it is kept.
- ✅ **Saved before sorted** — the thought is on disk before any model sees it
  (`apps/desktop/src/lib/captures.ts`). Classification can only change where it
  ends up, never whether it survived.
- ✅ **Task-or-note + which space**, decided by the on-device model under the
  same grounding rules speaker naming uses — never an invented space, evidence
  that must appear in the text, belief thresholds, and a tidied title that may
  only use the person's own words (`packages/core/src/capture/classify.ts`).
- ✅ **Corrections stick** — a kind or space a person chose is never re-guessed,
  and a guess is always labelled as one.
- ✅ **Spaces became projects** — `/spaces/:id` holds a space's meetings, tasks
  and notes on one page (was: a filter over the library).
- ✅ **Meetings file themselves** into a space after recording, same rules.
- ✅ **Short-utterance dictation** reusing the recorder's own engine choice
  (native first, webview second) — `apps/desktop/src/lib/dictation.ts`.
- ✅ **Migration `0008_captures.sql`** applied to the live project; capture sync
  degrades to local-only, and says so, on a backend without it.
- ⬜ **Widgets on a real device** — both build; the tap-to-app path is verified
  by test on the URL contract only (see docs/MOBILE.md, "Widgets").
- ⬜ **Suggest spaces** from a cluster of unsorted captures, for the cold start
  where a person has no spaces yet and nothing can be filed.

## Strategy pass (2026-09-09) — what the review found, and what was done

A review compared the product against its own marketing, fourteen competitors
and live keyword data. The findings and their outcomes, so the next review can
tell what was acted on from what was decided against.

- ✅ **The SAML contradiction.** `/security` said no SSO at all; `/pricing` said
  SAML works but is off on our backend. The second was right. The list of gaps
  now lives once in `apps/marketing/lib/gaps.ts`, is rendered by both pages, and
  has its own page at `/what-we-dont-have`.
- ✅ **Sync was not gated on a paid plan.** Closed in the database by migration
  `0009_sync_is_paid.sql`: inserts and updates need a paid plan; reads and
  deletes deliberately do not, so cancelling never strands a library. Verified
  live, both directions, by `supabase/verify-sync-gate.mjs`.
- ✅ **No task-manager push.** Linear, Todoist and Asana, from the Tasks list or
  automatically after a meeting. `packages/core/src/tasks/push.ts` (pure,
  tested) plus `apps/desktop/src/lib/taskPush.ts` (delivery). One-way by design.
- ✅ **Team tier priced at a third of the category median.** $6 to $12, and
  Enterprise given a $30 floor instead of "let's talk". **Still to do by hand:
  create the matching Stripe Price and update `STRIPE_PRICE_ID`.**
- ✅ **Circleback and Grain missing from `/alternatives`.** Added, with real
  pricing checked against their own pages on 2026-09-09.
- ✅ **No pillar structure.** Three pillars at `/guides`, each with a cluster,
  each cluster link asserted by test.
- ✅ **"Meeting notes template" (22,200/mo) unserved.** `/templates` and six
  children, generated from `NOTE_TEMPLATES` in core.
- ✅ **The Contextely integration had nowhere to live.** `/company-memory`.
- ✅ **No diarization page.** `/speaker-identification`.
- ✅ **No SEO plan document.** `docs/seo_geo_content_plan.md`.
- ✅ **The HIPAA post implied more than we offer.** It now says we sign no BAAs,
  hold no certifications, and that sync uploads transcripts to a database we run.
- ❎ **"Register ledgeur.com in Search Console."** Already registered and owned.
  The real finding is that it has returned **zero impressions** in ninety days.
- ❎ **"The native engine is opt-in, so most installs fall back to the browser
  path."** Not true of shipped builds: `scripts/release-macos.mjs` builds with
  `native-ai` unless `LEDGEUR_MAC_NATIVE_AI=0`. It stays opt-in for `cargo
  build` and `tauri:dev`, deliberately, because it is a slow native build and
  the mobile targets cannot cross-compile sherpa.
- ⬜ **Mobile apps into the App Store and Google Play.** Both produce signed,
  store-ready binaries. What is left needs a human in App Store Connect and Play
  Console. See `docs/MOBILE.md`.
- ⬜ **Submit the sitemap in Search Console** and re-measure in 90 days.

### Follow-through, checked 2026-09-09 (same day, after the deploy above)

- 🟡 **Re-inspected `ledgeur.com/` and `.../pricing` in Search Console.** Both
  still show pre-fix data (`userCanonical` apex, `googleCanonical` www,
  `coverageState: "Page with redirect"` on the apex), with `lastCrawlTime`
  before today's deploy. Expected: Google has not recrawled yet. The sitemap
  was last downloaded 2026-09-08T21:50, still reporting 71 submitted / 0
  indexed, which predates the new pages going live, so it will read 87 once
  Google refetches it. The Search Console API has no "request indexing" or
  "resubmit sitemap" endpoint; only the UI does, and it is rate-limited to
  manual, occasional use. There is nothing left to trigger from here. Re-check
  in the UI or re-run this inspection in a few days.
- ❎ **Confirmed the Stripe Price object is not creatable from this session.**
  `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` are already set on Vercel, but as
  **Sensitive**-type env vars, which Vercel deliberately makes write-only:
  `vercel env pull` returns `[SENSITIVE]` instead of the value, so the secret
  key can't be recovered to call the Stripe API directly. The Stripe MCP server
  is configured but requires an interactive OAuth grant (`/mcp` in an
  interactive terminal session), which a non-interactive session cannot do.
  Once either is unblocked, whether the Stripe MCP gets authorized or a fresh
  `STRIPE_SECRET_KEY` is handed to a session directly, creating the $12 Price and
  updating `STRIPE_PRICE_ID` is a five-minute job. Until then this stays a
  by-hand step; see `docs/MANUAL_TESTING.md` item 30.
- ❎ **Real Linear/Todoist/Asana tokens are not something to create.** These
  are the *user's own* third-party accounts, entered per-user in
  Settings → Automation, not project credentials. Creating an account on
  somebody's behalf is out of scope regardless of session type. Stays a manual
  test; see `docs/MANUAL_TESTING.md` item 28.
