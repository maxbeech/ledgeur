# Changelog

## 2026-08-26: Marketing observability

- Added Sentry browser, server, edge, and request-error monitoring to `apps/marketing`, with source-map uploads and the in-product feedback widget.

## Unreleased — Speakers, a real web app, and a price list that is true

### Recording felt broken even when it worked

Four reports after actually using the recorder, all traced to real causes
rather than fixed by guessing:

- **"Loading the on-device model" sat at 100%** even right after the sidebar
  said the speech model was already downloaded. The background warmup
  (`modelWarmup.ts`) loaded the model into a worker just to populate the
  browser's cache, then threw the worker away — so starting a recording always
  rebuilt the ONNX/WebGPU session and recompiled shaders from scratch, the part
  that actually takes time, not the download. Reproduced live (Browser pane:
  started a recording right after the sidebar reported 100%, watched it reload
  from 8%) before fixing it. The warmed worker is now kept alive and claimed by
  `useRecorder.start()` instead of rebuilt — verified with a new test
  (`apps/desktop/test/modelWarmup.mts`) exercising the claim/dispose contract,
  and by re-running the same live repro, which now resolves near-instantly.
- **"Finishing the record" could hang for minutes.** `stop()` waited
  unconditionally for every background speaker-analysis call made during the
  meeting to land — a backlog with no bound if the speaker models fell behind
  real time. Now bounded to 15s (`DIARIZE_WAIT_TIMEOUT_MS`); whatever hasn't
  landed by then is left out of that meeting's speaker clustering rather than
  blocking Stop, matching diarization's existing "never fail the meeting"
  contract. Post-meeting note generation is separately bounded to 45s with the
  same local-fallback behavior it already had on any other model failure.
- **The live transcript could fall further and further behind.** Drains fired
  on a plain `setInterval` regardless of whether the previous drain (which
  awaits transcription) had finished — a chunk slower than 5s meant calls
  piled up and the lag never recovered for the rest of the meeting. Replaced
  with a self-rescheduling loop that only starts the next drain once the
  current one resolves.
- **Transcript accuracy**: the default "English" option was whisper-tiny.en,
  the smallest and least accurate rung. Default is now "English, more
  accurate" (whisper-base.en) — larger download, slower per-chunk, meaningfully
  better transcripts.
- **System audio without the screen-share picker (macOS).** `getDisplayMedia`
  (video + a picker dialog, just to get audio) is now only the fallback.
  `apps/desktop/src-tauri/src/audio/` adds Core Audio's Process Tap API
  (`AudioHardwareCreateProcessTap`, macOS 14.2+) behind a new opt-in
  `system-audio-tap` Cargo feature — modelled on Apple's own reference sample
  (`insidegui/AudioCap`) rather than guessed, using the `objc2-core-audio`
  bindings so the FFI surface isn't hand-rolled. No picker, no video, no
  menu-bar recording indicator; still a one-time OS permission grant. Compiles
  cleanly alone, with `native-ai`, and without either feature — **not yet
  verified capturing real audio**, since that needs a signed build and real
  hardware this environment doesn't have. Falls back to `getDisplayMedia`
  automatically wherever the tap isn't available, so nothing regresses for
  Windows, older macOS, or the plain website.

### A download page, and the first published desktop build

The desktop app existed but there was nowhere to get it: `/download` 404ed and
nothing linked to it, so the only Mac build was one you compiled yourself.

- **v0.2.0 is published** on GitHub Releases — a universal DMG (13 MB), signed
  with a Developer ID and notarised by Apple, with the ticket stapled. Verified
  by downloading the published file and checking it: the SHA-256 matches the
  artefact that was notarised, Gatekeeper reports `accepted / Notarized
  Developer ID`, and `lipo` finds both architectures.
- **The page asks GitHub what exists** rather than hardcoding a link. Assets are
  classified by filename, and Tauri's updater artifacts (`.app.tar.gz`, `.sig`,
  `latest.json`) are filtered out — offering one of those as a download hands
  someone a file they cannot open.
- **It never invents a download.** No published release, a draft, a prerelease,
  an unreachable GitHub, or a release with no installable asset all render the
  same honest state: no build yet, here is the browser version, here is how to
  build from source. Windows and Linux say "not built yet" rather than
  "coming soon", which is a promise with no date behind it.
- **The binary is not in this repo**, and should not be: 13 MB per release would
  bloat every clone and every deployment for a file GitHub's CDN already serves.
- ISR at one hour, so a new release appears without a redeploy while still
  costing one request per region per hour. Linked from the header and the
  footer, and added to the sitemap — a page nothing links to is a page nobody
  reads.

This is the overhaul pass. The engine room was in good shape; everything a
customer touched was not.

### The paid tier was selling things that do not exist

`/pricing` advertised a Team plan with a "shared team workspace" and a Company
license with "self-host bundle (Docker + Helm), SSO / SAML & SCIM, admin console
& audit log, on-prem / air-gapped option". None of that is in this repository.
Checkout was live. Somebody could pay and receive nothing that was described.

The plans are now defined once, in `apps/marketing/lib/plans.ts`, and that file
carries the rule it is held to: nothing goes in a feature list unless it ships
today, and each line names the code that implements it. A test fails the build
if a paid plan mentions SSO, SAML, SCIM, an audit log, Helm, Docker, SOC 2 or
ISO 27001. `/pricing` now has a "what we do not have" section, and `/security`
publishes the missing certifications rather than a badge.

### Checkout took money and activated nothing

`POST /api/checkout` accepted an optional `orgId` from the browser and, when it
was absent, opened a Stripe session anyway. Every purchase started from
`/pricing` therefore had no `client_reference_id`, so `stripe-webhook` had no org
to flip. The button worked, the payment worked, and the product never turned on.
The `?org=` deep link from the app was the only path that ever activated
anything — and it was a query parameter, so it could be edited to activate
somebody else's workspace.

The org is now resolved server-side from the caller's own Supabase session, and
a session that cannot be attributed to a workspace is **refused rather than
sold**. There is also a billing portal, because a subscription that takes two
clicks to start and an email to cancel is a dark pattern.

### Every agent access token was dead on arrival

`mcp_tokens.token_hash` is documented as "sha-256 of the issued token; the
plaintext is shown once and never stored". The mint function recorded
`sha256(random uuid)`. The hosted endpoint looked up `sha256(refresh_token)`.
Those are different values, so no token ever matched — and had they matched,
GoTrue rotates refresh tokens on use, so a long-lived token would have worked
exactly once.

A token is now an opaque `ldg_` secret with 256 bits of entropy, generated in the
edge function, stored only as a hash, and returned exactly once. Redeeming it
mints a five-minute Supabase JWT signed with the project secret, so the request
arrives as an ordinary authenticated user and every row-level security policy
already written applies unchanged. The endpoint holds no standing authority: a
bug in a tool handler cannot show another organisation's meetings, because the
database would refuse.

### Ledgeur now knows who is speaking

The schema has modelled `speakers` and `transcript_segments` since the first
migration. Nothing produced them: the worker called Whisper without
`return_timestamps`, so the output was one undifferentiated string and there was
nothing to attribute. Speaker identity existed only in a native build behind an
opt-in cargo feature, and only as "match this against a voice you enrolled by
hand" — there was no separation of unknown voices at all.

`packages/asr/diarize.worker.js` runs two models in the browser:
`onnx-community/pyannote-segmentation-3.0` for where the voice changes
(a powerset head over 7 classes, so people talking over each other is handled
rather than mangled), and `onnx-community/wespeaker-voxceleb-resnet34-LM` for a
voice vector per turn. Both are un-gated MIT/CC mirrors, both are around
10–30 MB, both run on the pinned transformers.js the ASR ladder already trusts.

The deciding is pure and in `packages/core/src/diarize` — average-linkage
agglomerative clustering over cosine similarity, rather than single linkage,
because single linkage chains two people together through one ambiguous turn.
The merge threshold sits deliberately above pyannote's tuned value: splitting
one person in two is a mistake the user fixes with one click, whereas welding
two people into one silently corrupts the transcript.

### And it remembers them

Name "Speaker 2" as Priya once and every later meeting recognises her. The voice
print is the mean of her turns, updated as a running average weighted by how
many recordings have contributed, so a bad headset on the eleventh meeting does
not redefine a voice heard clearly in ten. Identification demands a higher
similarity than clustering does, and refuses when the top two candidates are too
close to separate: saying "Speaker 2" is better than putting a colleague's name
on a stranger's words.

Voice prints live in IndexedDB and are **never synced**, not even on the paid
plan. A voice print identifies a person after the transcript is deleted, so it
stays on the device that heard the voice.

### Memory, which is why the live path looks the way it does

An hour at 16 kHz mono is about 230 MB of Float32. Holding a meeting in a tab
just to diarize it at the end is not reasonable, so live capture analyses each
drained slice as it arrives and keeps only the turns and their vectors — a few
hundred bytes each. Clustering still runs once, over everything, at the end,
because "which of these voices is the same person" cannot be answered twenty
seconds at a time.

### Drag in a recording you already have

Anywhere on the app, not into a bordered box in one corner. A dropped file goes
through the same pipeline as a live meeting — same transcription, same speaker
separation, same names, same notes, same library entry — and is filed under the
file's own date rather than pretending it happened now.

### `/app` is a product now

It was an anonymous recorder with a textarea. It is now a library with search
across everything ever said, meeting detail with speakers and timestamps,
per-speaker talking time, rename-a-voice, Markdown export and your own notes
kept verbatim. All of it works signed out, on-device, with the network off.

Accounts arrived on the web, so sync and agent access can be bought and used
without installing anything. Signing in adds sync; it is never a gate.

### The website and the app were two different products

`packages/ui/src/tokens.ts` describes a genuinely distinctive design language.
The app used it. The website used default Tailwind `stone`/`emerald`,
`font-extrabold`, rounded cards and ✓-bullet pricing columns — it read as
generated rather than designed, and a visitor who signed up met a second product
wearing different clothes.

`packages/ui/src/theme.css` is now the single stylesheet both apps import, and
`packages/ui/src/components` holds the primitives both render. A test asserts
`tokens.ts` and `theme.css` describe the same palette, and that every colour
meant for text clears WCAG AA. **It found five real failures**, including the
small mono label above every section at 2.86:1 — unreadable, and never noticed
because nobody re-measured after choosing it.

### Four files existed twice

`authMessages.ts`, `capture.ts`, `transcriber.ts` and the notes/audio helpers
were each forked between the two apps, and every one of them had already
drifted: one capture called the shared-audio option `tab` and the other `system`;
one stopped the video track and the other did not; core's `toMarkdown` took the
user's own notes and the fork did not. They exist once now, and a test asserts
they are not forked back out.

### Pages a product taking payments must have

There was no privacy notice, no terms, no refund policy and no security page.
There are now, along with a changelog and an agent-access page whose tool list is
generated from the real tool definitions so it cannot document something that
does not exist. The privacy notice names Hugging Face's CDN, which is the one
third party involved on the free plan and was previously unmentioned.

### Two thresholds were guessed, then measured

The clustering threshold started at 0.42, on the reasoning that over-splitting a
speaker is recoverable in one click while welding two people together silently
corrupts a transcript. The reasoning was right and the number was wrong. Running
the real models over real speech and sweeping it:

    60 s, two speakers      0.15–0.35 → 2 speakers   0.40–0.45 → 4   0.50 → 6

0.42 sat on a cliff edge. 0.30 sits in the middle of that plateau and is
independently what pyannote's own pipeline tunes to over these same embeddings.

The identification threshold was corrected the same way. Splitting each real
speaker's turns in half and treating one half as "last week's profile" gives
0.647–0.872 for the same person and 0.027–0.121 for different people. The
original 0.62 was safe but sat barely under the worst same-speaker case, so
somebody on a poor microphone would silently stop being recognised. It is 0.50.

`packages/asr/verify/diarize.mjs` is the script, so this is repeatable rather
than a story about a spreadsheet somebody once had.

### The end of a meeting could be silently cut off

Stopping a recording drained the capture buffer once. But a drain refuses to run
while a transcription is already in flight — correct during a meeting, where the
audio simply waits for the next tick, and wrong at the end, where there is no
next tick. Whatever arrived during that last transcription was discarded along
with the capture.

The result was a transcript missing its final seconds, with nothing in the
console, on a recording nobody could reproduce because it depended on where the
six-second tick happened to fall. Stopping now waits its turn and drains until
the buffer is genuinely empty, and the speaker analyses — which were fired
without being awaited so they could never delay the transcript — are now waited
for, so a meeting's last turns are clustered with the rest rather than landing
after the decision has been made.

### Two bugs that only a browser could find

Recording **failed silently** when the browser refused the microphone. The
rejection is a `DOMException` whose name is `NotAllowedError`, and nothing in the
UI had wording for it, so the button appeared to do nothing at all. Permissions
are now requested *before* the 40 MB model download rather than after — failing
in the second it takes to click Block, with a message that says which padlock to
click — and every capture failure has a sentence written for a person.

The guard that decides whether a failure needs translating was also the wrong
way round. It read "translate it unless it is an `Error` that is not a
`DOMException`" — true for real browser rejections and nothing else, so a plain
`Error` from a polyfill or another realm passed through untouched. Translation is
now the default, and only messages this codebase wrote itself opt out.

The library could hang on "Opening your library…" **forever**. When another
connection holds an older version of the database, `indexedDB.open` fires
`blocked` and then fires neither `success` nor `error`; a promise wired to those
two events never settles, and nothing appears in the console. Every open is now
bounded, handles `blocked`, and says "close your other tab".

### Also

- Syncing a meeting rolls back if it fails half-way. There is no client-side
  transaction across Supabase tables, so a segment insert that failed used to
  leave a meeting in the workspace with a title, no transcript and no notes —
  which reads to a colleague as a recording that captured nothing.
- The sitemap covers everything indexable, omits the authenticated pages, and
  uses real `lastModified` dates. It previously stamped every URL with the build
  time, which teaches crawlers to ignore the field entirely.
- The transcription language picker and the model load plan now come from one
  list. A picker offering a value the plan does not know silently falls back to
  English — somebody chooses "Other languages" and gets a nonsense transcript
  with no error anywhere.
- `AudioCapture` closes a half-opened capture before rethrowing, instead of
  leaving a live microphone light and a screen-share banner over a recording
  that will never start. It also reports when the user stops the share from the
  browser's own bar, which was previously a silent recording of nothing.
- The app warns before closing during a recording.
- The social-share image rendered a **"P"** as the logo mark, on a palette the
  site no longer used. It now reads its colours from the design tokens.
- The desktop app's sidebar used raw Tailwind reds because the `danger` token is
  2.55:1 on the ink chrome and genuinely unreadable there. The fix was a
  `dangerOnInk` token, not a hand-picked hex in a component — and a test now
  fails the build if any component reaches for a raw palette colour again.
- Drag-and-drop import works in the app as well as on the web.
- You can now name a speaker from a saved transcript in the app, not only by
  sitting down to enrol them in advance. Meetings keep each speaker's voice
  print, so "who is this?" is still answerable a week later — which is when
  anybody actually asks it. The web app already worked this way; the two now
  match.
- Voice enrolment in the app was native-only, and said so. Since the webview
  gained speaker separation it recognises voices too, so enrolling now goes to
  whichever store the engine in that build will actually read. The card says
  which one, because the two use different models and therefore incompatible
  voice prints — somebody whose profiles "disappeared" after rebuilding with the
  native engine deserves to know why rather than to guess.

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
