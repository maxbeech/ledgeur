# Manual test checklist

## The grounding pass (2026-09-05)

### Verified automatically — no need to re-test by hand

Unit tests (1252 across the workspace) cover the tokenizer and relevance
scoring, transcript windowing and elision, context packing and both prompt
framings, note provenance (including that an unsupported line gets no citation),
follow-up drafting and parsing, recipe validation and resolution, the webhook
payload/signature and the rule that a voice embedding can never be in one, the
calendar auto-start rules, all 32 spoken languages against the load plan, the
people directory and meeting ranking.

Driven for real in a browser against the live pipeline (see
`packages/asr/verify` and the memory note on substituting a speech clip for
`getUserMedia`):

- Recording started, 60s of real speech transcribed accurately with speakers and
  timestamps, live UI in ~2s with no blocking loader, Stop → saved in 1.2s.
- A question asked mid-meeting: the prompt actually sent was captured and
  confirmed to contain the meeting-mode system prompt, the situation line, the
  speaker-labelled transcript, the speaker roster, the user's typed notes and
  five ranked past meetings. The source chips under the answer matched.
- A space created, a meeting filed into it, the filter chips counting correctly.
- Note provenance: clicking "from 00:07" switched to the transcript tab and
  highlighted the right line. Loose matches were flagged as loose.
- A follow-up email drafted (local path, correctly labelled).
- A webhook delivered to a real HTTP receiver that verified the HMAC with its
  own independent implementation: signature valid, transcript correctly absent,
  no embedding anywhere in the body. Then again automatically on a real meeting
  completing.

### Needs a human, and why

- **Webhooks from the packaged app.** Delivery goes through the native side
  (`src-tauri/src/net.rs`) to avoid CORS. That path was compile-checked and the
  frontend path was proven against a real receiver, but the *native* path has
  not been exercised in a built app. Configure a webhook in Settings → Data
  access, hit "Send a test", and confirm it arrives.
- **Calendar auto-start.** Needs a real connected calendar and a real meeting
  with a join link starting. Turn it on in Settings → Automation, then watch a
  meeting begin. Confirm: it starts, a notification says so, the meeting room
  opens, and a "Lunch"-style block with no join link does **not** start
  anything.
- **SAML SSO.** Needs a Supabase project with SAML enabled and a registered
  domain. The button only appears when the backend reports SSO on, so on a
  project without it the correct observation is that no SSO field is shown.
- **Contextely in a mid-meeting answer.** Needs a live Contextely workspace with
  a Ledgeur source. Ask a question mid-meeting whose answer is only in company
  memory and confirm "Contextely company memory" appears in the source chips.
- **A non-English meeting.** Pick a language in the Record screen and confirm
  the transcript comes back in that language rather than hallucinated English.

## The overhaul pass (2026-08-24)

### Verified automatically — no need to re-test by hand

- **940 assertions** across six packages, every package typechecks, both apps
  build (`pnpm test && pnpm typecheck && pnpm build`).
- **Speaker separation, on real audio.** `packages/asr/verify/diarize.mjs` runs
  the actual models over a real recording. A 60-second interview clip: 8 windows
  → 38 raw turns → 24 embedded (256-d vectors) → **2 speakers**, 48.6 s and
  11.6 s, alternating in the pattern an interview actually has — long answer,
  short question, long answer. About three seconds of compute after a
  fourteen-second model load. The alternation is the check that matters: a
  plausible speaker *count* with the turns attributed to the wrong people would
  look identical in a summary. This is also how the clustering threshold was
  set; the sweep is recorded in `packages/core/src/diarize/cluster.ts`.
- **Speaker identification margins.** Splitting one speaker's turns in half and
  treating one half as a stored profile: same person 0.647–0.872, different
  people 0.027–0.121. The threshold sits at 0.50, between them.
- **Site routes.** Every path named in the header, footer, plan CTAs and the
  homepage — 37 unique URLs — returns 200, and an unknown path returns the
  custom 404.
- **The checkout auth gate.** "Start the free trial" while signed out redirects
  to `/signin?next=%2Fpricing` and does **not** reach Stripe.
- **Contrast.** Every text token is asserted ≥ 4.5:1 against every surface it is
  used on, in `packages/ui/test`.
- **Brand drift.** Every `.tsx` in both apps is asserted to use design tokens
  rather than raw Tailwind palette colours.

### Verified in a real browser

Driven end to end against a running build:

- Denying the screen share shows: *"You dismissed the sharing window, so nothing
  was captured. Start again and pick the tab or window your meeting is in — and
  tick 'Also share tab audio', or the other people will not be recorded."*
- Denying the microphone shows: *"Ledgeur needs permission to use your
  microphone. Allow it when your browser asks — or, if you blocked it earlier,
  click the padlock in the address bar and re-enable the microphone for this
  site."* Neither leaks a `DOMException` name.
- "Try again" clears the error and returns the panel to its start state.
- The library sidebar reaches its empty state on five consecutive reloads; it
  never sticks on "Opening your library…".
- Between roughly 20 ms and 200 ms after clicking Record, the panel shows
  *"Waiting for permission…"* and **no** download progress bar — confirming the
  40 MB model no longer downloads before the browser has asked.
- The sample clip progresses through real steps: fetching → reading → loading
  the speech model.

### The paid path, proven against production

Run end to end on 2026-08-24 with a throwaway account, which was deleted
afterwards (production is back to zero users, zero orgs, zero meetings, zero
tokens):

- A new account signs in, and the signup trigger builds its workspace.
- A **free** workspace is refused a token — HTTP 402, coded `upgrade_required`
  so the UI can render it as an upsell rather than an error.
- Upgraded to `team` (exactly what the Stripe webhook does), the same call mints
  a token. It is an opaque `ldg_` secret, and only its SHA-256 is in the database
  — checked, not assumed.
- Presenting it to `https://www.ledgeur.com/api/mcp` returns all four tools, and
  `tools/call` on `list_meetings` succeeds, scoped by row-level security to that
  user (empty, correctly, for a new account).
- Revoking it makes the very next request 401.

The script is `e2e-paid-path.mjs` in the session scratchpad; it needs a service
role key, so it is not committed.

### Needs a human, and why

These cannot be driven headlessly, so they are the manual list:

1. **Record a real meeting, in a real browser, and grant permission.** A
   headless browser cannot grant microphone or screen-share access, so the happy
   path of `/app` is untested end to end. Check: the timer runs, the transcript
   appears within about ten seconds, and stopping it produces separated speakers.
   The failure paths (permission denied, no device, device busy) *are* covered by
   stubs and by unit tests.
2. **Name a speaker, then record a second meeting with the same person.** The
   headline feature — that a named voice is recognised next time — needs two
   recordings of the same real person. The logic is unit-tested and the
   thresholds are measured, but the round trip through IndexedDB has only been
   tested with synthetic vectors.
3. **The packaged desktop app's live transcription, with a real microphone and
   two real people.** The engine numbers are measured against the real models
   (`measures_the_live_loop` and friends — see docs/NATIVE_AI.md), and the whole
   record → stop → notes flow was driven end to end through the browser path
   with a speech clip fed in where the mic would be. What that cannot show is
   the packaged `native-ai` build against live audio. Check, in order:
   - the "Transcribing Ns behind" line stays away, or clears quickly — it should
     no longer name the engine either;
   - live lines from two different voices get **different** speaker chips once
     each person has said a few seconds, and short utterances show no chip at
     all rather than a wrong one;
   - Stop settles in roughly a sixth of the meeting's length, not minutes, and
     the phase reads "separating speakers" (there is no re-transcription step
     any more);
   - the saved transcript's timestamps still line up with when things were
     actually said, including after a long silence mid-meeting;
   - the notes are written by the assistant — no "pulled out of the transcript"
     banner — and the copilot's "Download" prompt is absent with the weights on
     disk;
   - **the app is still running at the end of it.** A long meeting is the case
     that crashed: the live coach's prompt grows with the transcript, and once
     it passed 2048 tokens llama.cpp called `abort()` and took the recording
     with it. Covered now by `answers_a_prompt_larger_than_one_batch`, but that
     runs one prompt, not an hour of a real meeting;
   - **quit the app afterwards and check no crash report appears** in
     Console → Crash Reports. Releasing the model at exit is wired to Tauri's
     `Exit` event, which no test can reach; the integration tests only prove
     the release itself works.
4. **Drag a real Zoom/Teams export in.** Decoding depends on the browser's own
   codec support, which varies. Try an `.mp4`, an `.m4a` and a `.webm`.
5. **A real purchase, end to end.** Buy on a test card, then confirm `/account`
   flips to the Team plan within a few seconds, generate an access token, and
   call `/api/mcp` with it. Then cancel from the billing portal and confirm the
   plan reverts. This needs live Stripe keys and the webhook wired — see
   `docs/DEPLOYMENT.md`.
6. ~~`SUPABASE_SERVICE_ROLE_KEY` in production.~~ Set, and the endpoint is
   verified working — see above.
7. **A long meeting.** The live path is designed to keep memory flat by
   discarding audio behind the models; an hour-long recording would confirm it.
8. **Safari and Firefox.** The load ladder has rungs for them, and the fallback
   logic is tested, but the models have only been driven in Chromium here.

## Production readiness (2026-08-17)

### Verified automatically — no need to re-test by hand

- **Browser transcription (the reported outage)**. Fixed and confirmed on the
  live site, `https://www.ledgeur.com/app`, in a real Chrome 152 driven end to
  end: with WebGPU **disabled** (the environment that was broken) the sample
  clip transcribes correctly in ~16 s on the CPU rung; with WebGPU enabled it
  transcribes in ~28 s on the WebGPU rung. Zero console errors on both.
- **Fallback ladder**. With a deliberately dead first rung injected (the exact
  production failure), the app discards the poisoned worker, spawns a fresh
  one, and still produces a transcript. With *every* rung dead, the user sees
  "This browser couldn't start the speech model…" plus the raw error, rather
  than a silent hang.
- **Checkout**. `POST https://www.ledgeur.com/api/checkout` returns a real
  Stripe Checkout session URL (HTTP 200) against live keys.
- **Builds**. `pnpm test` (171 assertions), `pnpm typecheck`, `pnpm lint`, the
  marketing production build, and `tauri build` (produces `Ledgeur.app` and
  `Ledgeur_0.2.0_aarch64.dmg`, **unsigned**) all pass.
- **Site smoke test**: `/`, `/app`, `/pricing`, `/blog`, `/transcribe`,
  `/use-cases`, `/open-source`, `/sitemap.xml` (65 URLs), `/robots.txt`,
  `/manifest.webmanifest` all return 200. `/download` now serves the published
  desktop build (see below).

### Also verified against production (second pass, with the Supabase PAT)

- **Auth now works end to end.** Custom SMTP is configured (Resend, sending from
  the verified `mail.ledgeur.com`), so Supabase's team-members-only 2/hour
  default mailer is out of the picture. Proven live: sign-up → confirmation
  email lands in the inbox → sign-in is refused until confirmed → confirmed →
  token issued. A new user automatically gets a profile, an org and a
  membership (the `on_auth_user_created` trigger). Password reset was driven
  through the browser with a real recovery link: the form sets the password,
  the new password signs in, and the old one stops working. Test user and org
  were deleted afterwards; production is back to zero rows.
- **Billing activates for real.** 18 assertions against the deployed
  `stripe-webhook` function, signed with the registered test-mode secret:
  a completed checkout flips `orgs.plan` to `team` and stores the customer and
  subscription ids; `past_due` drops it to `free`; `active`/`trialing` restore
  it; cancellation revokes it; `org_is_paid()` agrees throughout. Forged
  signatures, replayed (stale-timestamp) events and unsigned requests are all
  rejected with 400 and change nothing.
- **macOS build is signed and universal.**
  `pnpm --filter @ledgeur/desktop release:mac` produces a **universal** bundle
  (`Ledgeur_0.2.0_universal.dmg`, 13 MB) signed with the *Developer ID
  Application: Maxed Labs Ltd (E353LGUVGH)* certificate in the keychain.
  Verified on the output: `lipo` reports both `x86_64` and `arm64`;
  `codesign --verify --deep --strict` passes and the app satisfies its
  designated requirement; hardened runtime on;
  `com.apple.security.device.audio-input` entitlement and
  `NSMicrophoneUsageDescription` both present. The Intel slice was *launched*
  under Rosetta 2 and ran without crashing — not merely inspected.

  The script refuses to start a universal build when a Rust target is missing,
  and fails afterwards if `lipo` does not report both architectures, so a
  "universal" build cannot silently ship as one arch. `LEDGEUR_MAC_TARGET=native`
  gives a fast host-only build for development.

  Note: this is the default feature set. A universal build with `--features
  native-ai` is a separate problem — `sherpa-rs` downloads prebuilt native libs
  per architecture and `whisper-rs`/`llama-cpp-2` compile native code, so those
  would need per-arch handling before a universal AI build works.

### TO STILL TEST / DO — needs credentials or accounts Claude Code cannot reach

1. **Distributing the Mac app — done.** v0.2.0 is published on GitHub Releases
   as a universal DMG, signed and notarised, and `/download` serves it. Verified
   by downloading the published file: its SHA-256 matches the artefact that was
   notarised, Gatekeeper reports `accepted / source=Notarized Developer ID`, the
   stapled ticket validates, and `lipo` reports `x86_64 arm64`. Eleven checks
   run against the production page (header link, version, asset reachability,
   mobile layout, console errors).

   Still open on this front: **Windows and Linux installers**. Both build from
   source today; what is missing is a signed installer for each. Windows needs
   its own code-signing certificate.

2. **Notion integration.** `NOTION_CLIENT_ID` in Supabase is set to an *empty
   string* (confirmed: its stored hash is the SHA-256 of ""), and
   `NOTION_CLIENT_SECRET` is not set at all. Create the integration at
   <https://www.notion.so/my-integrations> as a **public** integration (only
   public integrations do OAuth), with the redirect URI set to exactly
   `https://www.ledgeur.com/oauth/notion` — the `www` host matters, because the
   apex 308-redirects and Notion matches the string exactly, so a callback
   registered on the apex fails the token exchange. Then
   `supabase secrets set NOTION_CLIENT_ID=… NOTION_CLIENT_SECRET=…` and put the
   client id in `VITE_NOTION_CLIENT_ID` in `apps/desktop/.env`.

3. **A live-money Stripe check.** The webhook logic is proven with signed
   events, but nobody has yet put a real card through the live checkout. Worth
   one test-mode purchase end to end (`4242 4242 4242 4242`) from
   `/pricing?org=<org uuid>` once you have a real org.

4. **Desktop native shell.** The auth UI was browser-tested against the Vite
   dev server; the native Tauri window (menu bar, microphone prompt, OS
   keychain) was not. Worth one pass with `tauri:dev` — in particular, confirm
   macOS shows the microphone permission prompt with the wording from
   `src-tauri/Info.plist` the first time you hit record.

5. **OAuth sign-in**, if you want Google/Microsoft buttons back. Create the
   OAuth apps with callback
   `https://ysmzzxkchfzbdxsrpgpw.supabase.co/auth/v1/callback` and enable the
   providers in Supabase. The app reads `/auth/v1/settings` at runtime and will
   show the buttons automatically — no code change needed.

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

## Domain: ledgeur.com — RESOLVED (verified live 2026-08-17)

`ledgeur.com` now resolves to Vercel: the apex 308-redirects to
`https://www.ledgeur.com`, which serves the site (HTTP 200). `site.ts` points
at `https://ledgeur.com`. The historical instructions below are kept for
reference only.

<details><summary>Original (2026-07-08) DNS instructions</summary>

### Domain: ledgeur.com — DNS pending (2026-07-08)

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

</details>

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
3. Sign in (Integrations → Account — email + password, or an OAuth provider if
   one is enabled on the project). Sidebar shows "Synced".

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

## The phone app and sync (2026-09-07)

The iOS and Android projects are generated and committed under
`apps/desktop/src-tauri/gen/`; see `docs/MOBILE.md` for the toolchain.
Migration `0007_sync.sql` has been applied to the live project, so the engine
is out of its "Limited" mode and the whole two-way path is live.

**Driven end to end on 2026-09-07** — items 15 to 20 below now pass, and are
kept here as the regression list rather than as unknowns:

- The iOS app runs on an iPhone 17 Pro simulator, signed in, and pulled every
  cloud meeting. A meeting recorded on it reached the laptop under the same id
  within seconds of Stop.
- The Android debug APK installs and launches on a Pixel 3a arm64 emulator
  (`com.ledgeur.app`) and renders Home with the phone shell.
- Edits, filings and deletions travel both ways between two devices, live,
  without a refresh.
- Offline, the library, search and reading a meeting all work; the app says so
  honestly and resyncs by itself about two seconds after the network returns.
- Every screen clears WCAG AA in both light and dark mode, measured.

What still needs a real phone, a real room, or a Windows machine:

14. **First record on a phone.** Tap Record → Start. The OS asks for the
    microphone once, with the app's own wording. The speech model downloads
    now (not at launch) with a visible progress line, and the transcript
    starts once it is ready. Stop → the meeting opens with notes.

    Mostly done on the simulator on 2026-09-07: Record offers the microphone
    only, the model downloaded on the first record with a visible percentage,
    audio was captured (live waveform), and Stop was near-instant and opened
    the meeting. Two parts still need a real handset. The **permission prompt**
    never appeared because a simulator grants the microphone without asking.
    And the **transcript came back empty**: the simulator has no WebGPU, so
    transformers.js falls back to WebAssembly and ran about 50 seconds behind a
    live recording before stalling — the app reported that honestly
    ("Transcribing 50s behind on this device (CPU)") but produced no words in
    90 seconds of clear speech. On an iPhone with WebGPU in WKWebView this
    should be far faster; that is the thing to check first on a device.
15. **A phone recording reaches the laptop.** ✅ 2026-09-07 — recorded on the
    iOS simulator; `e12db456-fdba-404f-bc9b-6d5dfbd2ba81` was in the cloud
    within seconds of Stop and in the laptop's library under the same id, with
    no duplicate. Still worth repeating on a device with a real transcript in
    it, since this one was empty (see 14).
16. **An edit travels both ways.** ✅ 2026-09-07 — filing a meeting into a
    space on one device changed it on the other, with the meeting open and no
    refresh, in about a second; the space itself travelled too. This needed a
    fix: the open meeting screen was the one screen that never subscribed to
    the store, so sync updated the data underneath it and the page went on
    showing what it looked like when it was opened. Still worth doing by hand:
    renaming a **speaker**, and an edit made on the phone rather than received
    by it.
17. **A deletion travels.** ✅ 2026-09-07 — deleted on device B, tombstoned in
    the cloud (`deleted_at` set, not a hard delete), gone from device A's
    library within seconds without a refresh, and still gone after "Sync
    now".
18. **Offline.** ✅ 2026-09-07, with the network cut under the app — library,
    search and reading a meeting all worked, and it resynced by itself about
    two seconds after the network came back. Two fixes came out of it: a failed
    sync used to report "This account has no workspace yet. Sign out and in
    again to create one", which is the worst possible advice for someone
    offline, because signing back in needs the network they have not got; and
    nothing listened for the network returning, so recovery waited for the
    five-minute tick. Still to do on a handset: **record** while offline and
    watch it sync when the radio comes back.
19. **Settings → Sync** ✅ 2026-09-07 — seen in both states: "Limited" naming
    `supabase/migrations/0007_sync.sql` before the migration, and "In step"
    with the "Live" badge after it, on the laptop and on the phone. Note that
    the schema answer is cached for the life of the process; pressing "Sync
    now" re-asks, which is what someone does straight after applying it.
20. **Dark mode.** ✅ 2026-09-07 — every text/background pair on Home,
    Library, Record, Ask, Tasks, People, Settings and a meeting was measured
    against WCAG AA in both themes, and all pass. The **live room** is not
    covered by that sweep because it needs a recording in progress; it was seen
    in light mode on the simulator only.
21. Windows: `tauri build` on a Windows host (unchanged, still untested —
    there is no Windows machine here).

## Error tracking (Sentry)
15. With `VITE_SENTRY_DSN`/`SENTRY_DSN` set in `apps/desktop/.env`, throw a test
    error from the console (`throw new Error("test")`) and confirm it appears
    in the `ledgeur/ledgeur-desktop` Sentry project within a minute.
16. `tauri:dev`: confirm `log::info!` lines from `src/ai/mod.rs` (e.g. starting
    a model download) appear in the terminal running `tauri dev`.
17. Blank both DSN vars and confirm the app behaves identically with zero
    network calls to Sentry (check the Network tab / no `ingest.sentry.io` requests).
