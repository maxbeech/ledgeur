# Changelog

## Unreleased — A hosted MCP endpoint, and a Mac build Intel users can run

### The MCP server now has two front doors, and one set of tools

`apps/mcp-server` speaks stdio, which is what Claude Desktop and Cursor want and
what a person runs on their own machine. Nothing else could reach Ledgeur: a
hosted agent, another product's connector or a script has no way to spawn a
process, so the paid tier was unreachable for exactly the callers most likely to
pay for it.

`POST /api/mcp` on the marketing site is the same server over HTTP. It
authenticates with the data-access token the app already issues under
Integrations, Data access, resolves it to a Supabase session for the person who
created it, and runs every query under their row level security. The route has
no privileges of its own: the one service-role step reads a single row of
`mcp_tokens` to check the hash and never touches meeting content.

### The tools moved to `packages/mcp`, and that is the point

They were defined inline in the stdio server. A second transport would have
meant a second definition of the same four tools, which drifts and is only
noticed when somebody switches transport and finds a tool missing or shaped
differently. Both servers now read `TOOLS` from one array.

The input schema is written once, in zod, because the SDK wants a zod shape and
the JSON-RPC wire wants JSON Schema. `jsonSchemaFor` derives the second from the
first rather than the two being written separately with a test hoping they
agree.

### Details worth knowing

- An unknown TOOL comes back as a tool error the agent can read and retry;
  an unknown METHOD comes back as a JSON-RPC error. They are different failures
  and a client acts on them differently.
- A notification (no `id` at all) is answered with 202 and no body. `id: null`
  is a request and IS answered, which is the mistake every hand-rolled JSON-RPC
  implementation makes once.
- An unknown protocol version negotiates down to the newest we speak rather than
  refusing, so a newer client still connects.
- A revoked token and an unknown token get the same answer, so the endpoint does
  not confirm that a token was once real.
- `GET` declines with 405 and `Allow: POST` rather than holding open an SSE
  stream a serverless function would drop.
- 28 tests in `packages/mcp`, covering the tool set, the derived schemas, the
  JSON-RPC surface and the auth header parsing.

**Not yet exercised against a live deployment.** The endpoint needs
`SUPABASE_SERVICE_ROLE_KEY` on the marketing project and a real token from a
paid org. Until somebody runs that once, this is code that typechecks and passes
its unit tests rather than a proven path.

### macOS: universal builds, so Intel Macs are not left out

`release:mac` shipped an Apple Silicon-only DMG, which simply would not run for
anyone on an Intel Mac. It now builds `universal-apple-darwin` by default.

- The blocker was the toolchain, not the config: the `cargo` on PATH is
  Homebrew's, which carries std for the host architecture only. rustup was
  installed but shadowed, so the script now puts `~/.cargo/bin` ahead of it for
  the build (`rustup target add x86_64-apple-darwin aarch64-apple-darwin`).
- **No silent single-arch builds**: the script refuses to start when a Rust
  target is missing (naming the exact `rustup target add` to run), and after the
  build asks `lipo` what is actually in the binary, failing if either
  architecture is absent.
- `LEDGEUR_MAC_TARGET=native` keeps the fast host-only build for development.
- Verified: `lipo` reports `x86_64` + `arm64`; `codesign --verify --deep
  --strict` passes; hardened runtime, mic entitlement and usage string all
  present; and the Intel slice was launched under Rosetta 2 and ran, rather than
  just being inspected.
- Two latent bugs in the script fixed along the way: the bundled executable is
  lowercase `ledgeur`, not `Ledgeur` (the hardcoded path would have failed), and
  the DMG to notarise is now chosen by modification time rather than
  alphabetically.


## [0.6.3] — 2026-08-17 — Production fixes: transcription outage, and a way to sign in

### Fix: browser transcription was dead for every user without WebGPU

A user reported that Ledgeur could not transcribe at all:

```
Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE: qdq_actions.cc:137
TransposeDQWeightsForMatMulNBits Missing required scale:
model.decoder.embed_tokens.weight_merged_0_scale
```

**Cause.** The transcription worker loaded `@huggingface/transformers@4.2.0`,
whose bundled onnxruntime-web dev build rejects the published int8 ("q8")
Whisper exports. q8 is the default dtype on the WASM backend, so *everyone
without WebGPU* — older machines, locked-down corporate browsers, Safari — hit
it on first use. WebGPU users were unaffected, which is why it went unnoticed.
Upstream: https://github.com/huggingface/transformers.js/issues/1707

Verified in Chrome 152, each case in a clean browser profile with real audio:

| runtime | device | dtype | result |
| ------- | ------ | ----- | ------ |
| 4.2.0   | wasm   | q8    | **fails** (the error above) |
| 4.2.0   | wasm   | fp32  | ok — 152 MB, ~27 s first load |
| 3.8.1   | wasm   | q8    | ok — 41 MB, ~9 s first load |
| 3.8.1   | webgpu | fp32  | ok |
| 4.2.0   | webgpu | fp32  | ok |

- **Fix**: pin the runtime to the newest release that loads the int8 exports,
  and pin an explicit `dtype` on every path instead of inheriting a runtime
  default that changes between releases.
- **Resilience**: model loading now walks an ordered *plan* (WebGPU → CPU int8 →
  CPU fp32) instead of a single hardcoded choice. A failed onnxruntime session
  poisons the runtime — a later load of a known-good model in the same worker
  fails with the same stale error — so each rung is attempted in a **fresh
  worker**, torn down between attempts.
- **Explicit failure states**: raw onnxruntime text is mapped to a message a
  person can act on (update your browser / check the firewall / close tabs),
  with the raw error kept on a second line for support. Load failures now
  surface in the UI; previously `preload()` could fail silently and the user
  only saw a raw runtime error later, mid-recording.
- **Audio is no longer lost on a retry**: `transcribe()` waits for a live
  pipeline before transferring the audio buffer into the worker.
- **Single source of truth**: the worker and its load plan were a byte-identical
  copy-paste in two apps. They now live once in `packages/asr/` and are synced
  into each app's `public/` by `predev`/`prebuild`; a test fails if a copy
  drifts.
- **Faster recovery**: the worker and plan were served with a 24-hour
  `max-age`, so a broken worker stayed broken for a day after a fix shipped.
  They now revalidate on every load (they are a few KB; the model weights are
  cached separately by the Hugging Face CDN), so a fix reaches users on their
  next page load.
- **Tests**: new `@ledgeur/asr` suite (58 assertions) covers the plan, the
  runtime/dtype invariant that caused the outage, lang handling and error
  mapping. End-to-end, a real browser with WebGPU disabled now transcribes the
  sample clip, and an injected dead first rung is proven to recover in a fresh
  worker.

### Sign-in: email + password, and no dead-end buttons

The app offered only Google and Microsoft sign-in, but the production Supabase
project has both providers switched **off** (`/auth/v1/settings` reports
`google: false, azure: false, email: true`) — so both buttons led to a failed
redirect, and there was no way in at all.

- **Email + password sign-in, sign-up and password reset** in the account card,
  using the email provider that is already enabled server-side.
- **Providers are discovered, not assumed**: the app asks the backend which
  OAuth providers are configured and renders buttons only for those. Enabling
  Google or Azure in Supabase makes the buttons appear with no code change; a
  provider that is off can no longer be clicked into a broken redirect.
- **Real failure states**: Supabase auth errors are mapped to something a person
  can act on ("That email and password don't match an account", "Confirm your
  email address first", "New accounts are disabled on this workspace"), instead
  of raw API strings — with unrecognised errors passed through verbatim rather
  than swallowed. A backend with no auth method at all says so explicitly.
- Credentials are validated client-side before any network round-trip.
- `AccountCard.tsx` extracted from `Integrations.tsx`; pure logic lives in
  `lib/authMessages.ts` and is covered by 31 new assertions.

**Still needed to make sign-in work in production** (neither is a code change —
see `docs/MANUAL_TESTING.md`): configure custom SMTP in Supabase (its built-in
mailer only delivers to project team members, 2/hour), or register Google/Azure
OAuth apps and enable those providers.

### Production wiring: paid plans actually activate, auth emails actually send

With access to the live Supabase project, three things turned out to be broken
in production rather than merely unconfigured.

- **The billing migration had never been applied.** `orgs` had no
  `stripe_customer_id` / `stripe_subscription_id` columns, so every write the
  `stripe-webhook` function made was against columns that did not exist: a
  completed checkout took the money and never flipped the plan. Migration
  `0004_billing_stripe` is now applied and recorded in `schema_migrations`.
  Verified with 18 assertions against the deployed function using genuinely
  signed events — activation, lapse, recovery, trial, cancellation, and the
  `org_is_paid()` gate — plus forged signatures, replayed events and unsigned
  requests, which are all rejected without side effects.
- **No mail provider was configured**, so Supabase fell back to its built-in
  mailer, which only delivers to project team members at 2 messages/hour. Custom
  SMTP now goes through Resend from the verified `mail.ledgeur.com` domain, with
  the send rate raised from 2/hour to 100. Verified live: sign-up, confirmation,
  refusal-until-confirmed, sign-in, and password reset.
- **Auth emails landed nowhere.** Confirmation and reset links pointed at the
  marketing home page, which ignores the URL fragment — so a confirmed account
  looked like nothing happened, an expired link looked identical to a working
  one, and a password reset had no form to finish at. New `/auth/callback` page
  handles all of it, including a real set-a-new-password form, and `site_url`
  now points at it. It also re-reads on `hashchange`, so opening a second auth
  link in an already-open tab (a same-document navigation) updates the page
  instead of showing the previous outcome.

### macOS: the app would have been killed on first use

- **`NSMicrophoneUsageDescription` was missing.** macOS terminates an app that
  reaches for the microphone without it — for a meeting recorder that is fatal,
  and it would have happened to every user on first record. Added, along with a
  `com.apple.security.device.audio-input` entitlement, which the hardened
  runtime requires before a signed build may use the mic at all.
- **Builds were ad-hoc signed** (`TeamIdentifier=not set`). New
  `pnpm --filter @ledgeur/desktop release:mac` signs with the Developer ID in
  the keychain, notarises and staples when Apple credentials are present, and
  then asks Gatekeeper for a verdict rather than assuming success. Verified:
  hardened runtime on, correct authority chain, entitlement present. Notarising
  needs an app-specific password — see `docs/MANUAL_TESTING.md`.

Also: the 404 page still showed a "P" logo from before the rename.

## [0.6.2] — 2026-07-08 — Rebrand: ParleyNotes → Ledgeur

Full rebrand across the monorepo, docs and infrastructure — no functional
changes.

- **Naming**: `ParleyNotes`/`parleynotes` → `Ledgeur`/`ledgeur` everywhere —
  npm scope (`@parleynotes/*` → `@ledgeur/*`), Rust crate (`parleynotes` →
  `ledgeur`, `parleynotes_lib` → `ledgeur_lib`), Tauri identifier
  (`com.parleynotes.app` → `com.ledgeur.app`), env var prefix (`PARLEY_*` →
  `LEDGEUR_*`), internal CSS class prefix (`pn-*` → `ldg-*`), and the
  `fireflies-vs-otter-vs-parleynotes` blog slug.
- **Domain**: `parleynotes.com` → `ledgeur.com` in `apps/marketing/lib/site.ts`
  (single source of truth for brand/domain), `.env.example`, docs.
- **Infra**: GitHub repo and Vercel project renamed to `ledgeur`; local
  workspace folder renamed from `parleynotes` to `ledgeur`.
- Lockfiles (`pnpm-lock.yaml`, `Cargo.lock`) regenerated; `cargo check`,
  `pnpm typecheck`, `pnpm lint` and `pnpm test` all pass post-rename.

## [0.6.1] — 2026-07-08 — Fix HMR-driven recording reset, add Sentry + real dev logs

A live recording could be silently stopped and reset during `pnpm dev`: editing
`recorderContext.tsx` or `chatDock.tsx` (or a file that imports them) forced a
full Vite Fast Refresh reload instead of a state-preserving hot update, because
each file mixed a component export with a hook export — a documented Fast
Refresh incompatibility. The reload remounted `RecorderProvider`, whose cleanup
effect tore down the live capture/transcriber and reset state to idle.

- **Fix**: split `useRecorderCtx`/`useChatDock` into their own modules
  (`lib/useRecorderCtx.ts`, `lib/useChatDock.ts`); `recorderContext.tsx` and
  `chatDock.tsx` now export components only.
- **Diagnosability**: `useRecorder.ts`'s unmount cleanup now warns loudly if it
  fires while still `"recording"`, instead of silently resetting.
- **Sentry** (desktop app): `@sentry/react` on the frontend, the `sentry` crate
  (panic capture) on the Rust side — both opt-in via `VITE_SENTRY_DSN`/
  `SENTRY_DSN` in `.env` (blank = fully disabled, no network calls). New
  `lib/logger.ts` scoped logger wraps console + Sentry breadcrumbs/events; a new
  `AppErrorBoundary` catches render crashes instead of blank-screening.
- **Local dev logs**: Rust backend previously had zero logging infrastructure.
  Added `tauri-plugin-log` + `log` crate calls at AI command entry/error points
  (model downloads, transcription, LLM chat) — visible in the `tauri dev`
  terminal and webview devtools console.

## [0.6.0] — 2026-07-06 — Notion + Calendar as Ask context, real Google Calendar card

Notion save-to-page and Google Calendar read/auto-prompt already shipped; this
pass adds the missing piece — pulling both into the Ask copilot's grounding
context — and fixes a dead placeholder card plus a CSP gap.

- **Notion as Ask context**: new `notion-context` edge function does a live
  Notion search per question (title-matching, same as Notion's own search UI)
  and returns page snippets; wired into `askContext.ts`'s `gatherContext()` as
  a `"Notion: <page>"` context source, alongside the existing semantic-search
  and local-meeting sources.
- **Calendar as Ask context**: `calendar.ts` gained `fetchUpcomingEvents`
  (generalized from the day-only `fetchTodayEvents`) and `calendarContext()`,
  which surfaces the next 7 days of events as a `"Calendar"` context source.
  New pure `formatEventsForContext` in `packages/core` (unit-tested).
- **Google Calendar card fixed**: Integrations previously showed a disabled,
  hardcoded "planned" placeholder for Google Calendar even though calendar
  read + the record auto-prompt already worked via the Account Google sign-in.
  New `GoogleCalendarCard` reflects real connection state and live event count.
- **CSP fix**: `tauri.conf.json`'s `connect-src` was missing `googleapis.com`
  and `graph.microsoft.com` — calendar fetches were likely silently blocked in
  the packaged native app (only worked in dev/browser-preview, which has no
  CSP). Both domains are now allow-listed.

## [0.5.0] — 2026-07-03 — Seamless on-device copilot, unified meeting thread, chat-first shell

Everything the copilot does now runs on the user's own device with nothing to
install, the live meeting is one continuous chat thread, and the whole app is a
chat surface with an ever-present input.

### Seamless on-device LLM — no third-party app
- The copilot (chat), coaching suggestions and post-meeting notes now run **in
  process** via `llama-cpp-2` (`src-tauri/src/ai/llm.rs`) — no separate server,
  nothing for the user to install. Weights (Qwen2.5-1.5B-Instruct, ~1.1 GB) are
  **auto-downloaded once** (streamed with progress) and cached; the model loads
  once and is reused. New Tauri commands: `llm_status`, `download_llm`, `llm_chat`.
- New frontend abstraction `src/lib/llm.ts` (`chatComplete`): **native first**,
  OpenAI-compatible HTTP fallback (BYO key / external llama.cpp), then an honest
  error — `chat.ts`, `suggestions.ts`, `embeddings.ts` all route through it (one
  source of truth). The old "start a local llama.cpp server" message is gone.
- First time you use the copilot, a **one-tap "Download assistant"** prompt
  appears inline (and in Settings → On-device AI) — the model download is
  automated and seamless.

### Notes are written by the model (req 3)
- On stop, the summary / action items / decisions / questions are generated by
  the on-device model (`src/lib/notes.ts`), falling back to the local heuristic
  extractor (`packages/core` `summarizeTranscript`) when no model is present —
  always real, never blank, never invented. Structured-JSON parsing is unit-tested.

### One unified meeting thread (req 2)
- The live transcript, the copilot's answers, your questions and its proactive
  suggestions are now **one continuous chat thread** (`mergeThread`, time-ordered,
  unit-tested) — spoken lines render as bubbles too. The old three-tab rail
  (Copilot / Notes / Suggest) is gone.
- **Quote any bubble** — a transcript line or any message — and it's prepended to
  your reply's context.
- **Proactive suggestions** post into the thread as the copilot speaking
  (toggle in Settings → Meeting copilot; interval configurable).
- The right rail is now **just your notes**.
- By default the saved meeting keeps **only the transcript**; a setting ("Save
  copilot chat with the meeting") opts the copilot/user messages in.

### Chat-first app shell (req 4)
- The app is now a **persistent chat surface** (MainDraw-style): a dark nav rail,
  the current screen rendered as an embedded "window" card, and **one
  ever-present bottom input** that never unmounts on navigation.
- The bottom input is context-aware: it talks to the app copilot normally, and to
  the **live meeting's** copilot while recording. Reusable bubble/composer/thread
  components live in `src/components/chat/`; the shell in `src/components/shell/`.
- `Ask` is now the shared copilot conversation rendered by the global thread.

### Fixes & housekeeping
- Resolved the `apps/marketing/lib/posts/set-3.ts` merge with origin/master.
- `config.ts` guards `import.meta.env` so lib modules are unit-testable under Node;
  added a desktop pure-logic test runner (`apps/desktop/test/run.mts`, 14 checks).

## [0.4.0] — 2026-07-02 — "Library of Record" redesign, in-meeting notes & suggestions, speaker identification

A ground-up redesign of the app around a distinctive editorial identity, plus
the three missing product capabilities: manual in-meeting notes, proactive
"you could say" suggestions, and named speaker identification with confidence.

### Design system — "The Library of Record"
- New visual language: warm paper pages inside dark spruce-ink furniture; bundled offline fonts (**Fraunces** display serif · **Schibsted Grotesk** UI · **Spline Sans Mono** data/timestamps); strict color semantics (emerald = live/you, burnished gold = the brain speaking, madder = recording/danger); paper-grain texture; heritage-toned speaker palette. Tokens live in `packages/ui/src/tokens.ts` (single source of truth) mirrored in `theme.css`.
- Motion grammar: staggered "settle" page loads (`pn-stagger`), recording halo, gold shimmer for AI thinking, palette spring — all CSS, honoring `prefers-reduced-motion`.
- Every screen rebuilt: Home (dated greeting, gold ask bar, ledger tiles), Record pre-flight composer, live meeting room, Library, editorial Meeting detail, Ask, Tasks, Settings.

### App shell & UX
- **Recording survives navigation** — the recorder now lives in an app-level provider; the sidebar/tab bar show a live pill (elapsed time) that returns to the take. Previously navigating away killed the recording.
- **⌘K command palette**: navigate, start recording, jump to any meeting, or ask free-text straight from anywhere.
- **Mobile layout**: bottom tab bar with a raised Record button (safe-area aware); responsive grids throughout — one codebase, desktop + phone.
- Scroll position resets on navigation; delete asks for confirmation; explicit, actionable "model isn't running" errors everywhere the local model is used (shared `modelFetch`).

### In-meeting capabilities
- **Manual notes (req 14)**: a Notes tab during recording; kept verbatim in a "Your notes" section of the meeting and its Markdown/Notion export (`notesToMarkdown` extended, tested).
- **Proactive suggestions (req 13)**: a Suggest tab — the on-device model proposes 3 things you could say next, grounded in the live transcript (on-demand or auto every 60 s); parser in core (tested), explicit unavailable state.
- In-meeting chat restyled (gold = the brain), live transcript typeset with mono timestamp gutter, speaker marks and low-confidence flags.

### Speaker identification (native engine)
- **Voice profiles**: enrol a named voice from ~10 s of speech (`enroll_voice` / `list_voice_profiles` / `delete_voice_profile` Tauri commands, sherpa-onnx speaker embeddings, cosine matching — pure + unit-tested). Enrolment UI in Settings; voice prints stay on-device (`voices.json`).
- `transcribe_diarize` now identifies diarized speakers against enrolled profiles: transcripts show **real names with a confidence figure** (`speaker_confidence`), anonymous "Speaker N" otherwise — never guessed.
- Sync now preserves speakers: `pushMeeting` creates `speakers` rows (label, identified name, confidence) and links segments; cloud read-back restores names + confidence on any device.

### Tasks
- Tasks are cross-device: cloud `action_items` (real DB status, toggled via RLS-checked update in core) merged with unsynced local items; grouped by meeting with explicit local chips.

### Tests
- Core: 58 checks (was 49) — manual-notes markdown, suggestion parsing. Rust: 5 (voice cosine/threshold + identified merge). All typechecks + builds green; browser E2E pass of all screens.

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
- **`@ledgeur/core`** — shared domain model, ported notes/audio logic, note→domain mappers, Supabase client factory. 28 unit tests.
- **`@ledgeur/ui`** — design tokens + framework-agnostic helpers (single source of truth for the premium look & feel).
- **`apps/desktop`** — Tauri 2 + Vite + React app targeting all four platforms:
  - Premium UI with 6 screens: Brain (home), Record, Meetings, Meeting detail, Ask, Tasks, Integrations.
  - Working **record → on-device transcribe → notes → tasks** vertical slice (webview path), cached locally in IndexedDB.
  - In-meeting + anytime chat UI grounded in real context (targets the local llama.cpp sidecar; explicit failure if unavailable — never fabricates).
  - Honest empty/failure states throughout (no dummy data): calendar/connections show "connect" states until the backend is configured.
  - Generated app icon + full macOS/Windows/iOS/Android icon set.
- **Supabase schema** (`supabase/migrations`): orgs, profiles, memberships, meetings, speakers, transcript segments, notes, action items, integrations, and pgvector embeddings — with full **RLS** enforcing the hive-mind sharing model and a `match_embeddings` RAG RPC.
- **Shared data layer** (`packages/core/src/data`): RLS-aware Supabase repository (list/get/search meetings, tasks, semantic-search RPC) used by both the app and the MCP server.
- **`@ledgeur/mcp-server`** — the paid tier: a Model Context Protocol server (stdio) exposing `list_meetings`, `search_meetings`, `get_meeting`, `list_tasks` to Claude/Cursor/etc., authenticated per-user so RLS is never bypassed.
- **Notion export** (`packages/core/src/integrations`): pure, tested markdown→Notion-blocks converter + API client; "Save to Notion" wired in the meeting view.
- **Docs**: `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`.

### Changed
- Existing Next.js marketing site moved intact to `apps/marketing` (history preserved). Package renamed `@ledgeur/marketing`. Its 38 tests still pass.
- Standardised the workspace on **pnpm** (removed the npm lockfile).

### Migration notes
- Update the Vercel project **Root Directory** to `apps/marketing`.
- Apply `supabase/migrations` to a Supabase project and set `apps/desktop/.env` to enable accounts/sync.

### Not yet implemented (see ROADMAP)
- Auth + calendar + meeting auto-prompt · native whisper.cpp/sherpa-onnx/llama.cpp · RAG across the hive mind · Notion export · paid MCP server · iOS/Windows/Android builds.
