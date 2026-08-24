# Manual test checklist

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
  `/manifest.webmanifest` all return 200. `/download` 404s, which is correct —
  no such page exists yet and nothing links to it.

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

1. **Notarise the universal build.** The earlier arm64-only build was
   notarised and stapled successfully (verified: `accepted / source=Notarized
   Developer ID`), which proves the credentials and the pipeline work. The
   universal bundle is a different binary, so it needs its own notarisation:

   ```sh
   APPLE_ID=you@example.com APPLE_PASSWORD=abcd-efgh-ijkl-mnop \
   APPLE_TEAM_ID=E353LGUVGH pnpm --filter @ledgeur/desktop release:mac
   ```

   It should end with "Accepted". Confirm with:

   ```sh
   xcrun stapler validate apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/Ledgeur_0.2.0_universal.dmg
   ```

   Windows signing still needs its own certificate, and there is no `/download`
   page on the marketing site yet to put the DMG on.

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
