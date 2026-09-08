# Changelog

## Unreleased (2026-09-08) — Speakers that name themselves

Speaker separation has always ended at "Speaker 1" and "Speaker 2". That is
useful exactly once: next Tuesday's Speaker 1 is somebody else, and until a
person sits down and names each voice, the transcript reads as a conversation
between numbers.

Meetings, though, routinely say who is in them:

```
Speaker 1: Hi, I'm Max, I look after product here.
Speaker 2: Thanks for joining, Max. I'm Priya on the engineering side.
```

A person reading that knows both names. Now the on-device model does too. When a
recording finishes — between separating the speakers and writing the notes — it
reads the transcript and names the voices it can prove. Local model, no API, no
audio and no transcript leaving the machine.

### It is not allowed to guess

There is deliberately no pattern matching here. A regex cannot tell "I'm Max"
from "I'm afraid not" or "I'm Sarah's manager", and a wrong name on a transcript
is a serious error, so if no model is available the meeting keeps its numbers and
says why. The model proposes; `packages/core/src/diarize/names.ts` then refuses
anything it cannot check against the transcript:

* the name has to be spoken in the meeting — an invented one is dropped;
* the model's quoted evidence has to be a real line, word for word;
* that line has to be the line that says the name, which is what stops a real
  quote being used to launder a plausible-sounding invention;
* it has to clear a belief threshold — 0.75 to put a name on the transcript,
  0.85 to teach the voice store, because one is undone by a click and the other
  follows you into every future meeting;
* one name per voice and one voice per name, strongest evidence winning.

Fifty-odd tests in `packages/core/test/names.mts`, and most of them are about
what gets **rejected**.

### Every guessed name says it is a guess

A name the app decided never looks like a name a person typed. It carries a mark
on the chip, the belief behind it, and the words it came from — on the speaker
list, on every transcript line, and in the People directory, which otherwise
reads as a list of people you actually know.

Three one-click answers, because there are three different things a person means:

| | |
|---|---|
| **That's right** | Accept it. The name stops being a guess and the voice is enrolled. |
| **Change** | It is somebody else. |
| **Not them** | Reject it without offering a name — the voice goes back to a number. |

Correcting a guess also **un-teaches** it: if the guess was confident enough to
have written a voice print, that print is removed before the correction is
saved. Without that, a wrong name arrives more confidently in every later
meeting and the correction achieves nothing but a tidier transcript for one
afternoon.

A single line can be moved on its own, too — click the speaker on any line and
pick who really said it. That fixes the other mistake, the one at every
hand-over where two people talk over each other. Moving one line never touches
the voice store: one misattributed sentence is no evidence about what anybody
sounds like.

### Remembering a voice, without remembering what it said

To recognise somebody next time, the app now keeps a few seconds of them
speaking with the meeting. This closes a real gap: the native engine builds
profiles from audio, not from stored vectors, so on those builds naming a
speaker a week later taught the app nothing at all.

Keeping audio of somebody talking means keeping whatever they were talking
about, so the sample is not "the first few seconds". Every candidate window is
scored for card and account numbers, email addresses, sort codes, credentials,
salaries and redundancies, health, and legal or deal terms
(`packages/core/src/diarize/snippet.ts`); the blandest window wins, and if
everything a person said looks sensitive, **nothing is kept**. A missing sample
costs one manual enrolment; a kept one containing a card number is a different
category of problem entirely.

The samples are 16 kHz, capped at eight seconds, and never leave the device —
the same rule voice prints have always had, and now asserted by a test over the
actual sync payload rather than by a comment.

### Also

* `Suggest names` in a meeting's speaker list, for recordings made before this
  existed or finished before the model had downloaded. "No model" and "nobody
  said a name" are reported as the different answers they are.
* Imported recordings go through the same pass as live ones.

## Unreleased (2026-09-08) — The assistant stops taking the app down with it

0.3.5 was the first build in which the on-device assistant actually ran: until
the wire-name fix landed, `modelReady` was permanently `undefined` and every
call bailed out before reaching llama.cpp. Running it for the first time found
two ways it could abort the process — not return an error, abort — and one of
them ate a recording that was 72 minutes in.

### A meeting no longer disappears partway through

The crash report named the line:

```
Thread 31 (tokio-rt-worker)  CRASHED
  abort
  ggml_abort
  llama_context::decode(llama_batch const&)
  ledgeur_lib::ai::llm::inner::chat
```

`llama_context::decode` opens with `GGML_ASSERT(n_tokens_all <= cparams.n_batch)`,
and `cparams.n_batch` had been left at llama.cpp's default of 2048. The whole
prompt went in as a single batch of up to a full 8192-token window. Every prompt
longer than 2048 tokens therefore called `abort()` — a SIGABRT no error boundary
can catch, taking the window, the recording and the audio with it.

Which is exactly the shape of the report: it crashed *midway through* a meeting.
The live coach sends the tail of the transcript, and the transcript grows. Early
on the prompt fits; once the meeting has produced enough speech it does not, and
the app is simply gone. Writing up the notes on Stop, which sends the whole
transcript, would have done the same thing.

The prompt is now fed to the model in pieces no larger than the batch the
context was built with (`prefill_chunks`), and that batch size is stated in one
place rather than inherited from a default. The KV cache carries across
`decode` calls, so the model sees the same prompt it always did.

Nothing caught this earlier because the only test that runs the real weights
uses a nine-line transcript — about 300 tokens, comfortably under the limit.
There is now one that does not: `answers_a_prompt_larger_than_one_batch` sends
roughly a 45-minute meeting. Before the fix it did not fail, it *aborted the
test runner*, which is the right noise for this bug to make.

### Quitting no longer crashes either

Fixing that surfaced a second abort, at the other end of the process:

```
ggml-metal-device.m:622: GGML_ASSERT([rsets->data count] == 0) failed
  ggml_metal_device_free  <-  __cxa_finalize_ranges  <-  exit
```

ggml frees its Metal device from a C++ static destructor and checks there that
every resource set has been handed back. The model is deliberately cached in a
`static` for the life of the app — reloading 1.1 GB per request is what made the
assistant unusable in the first place — and Rust never drops statics, so its
Metal buffers were still checked out when that destructor ran. Every quit after
the assistant had been used at all was a SIGABRT and a crash report.

The engine is now released on Tauri's `Exit` event, before libc's exit handlers
run.

### Telling you the assistant is installed

"Unclear if the model installed, as I can't see the download banner now" — a
finished download and a broken banner look identical when the only signal is a
prompt that vanishes. The composer now says so once, when the weights arrive,
having previously been missing. It announces the transition, not the state:
on every later meeting the model is simply there, and saying so would be noise.
The durable answer stays where it was, in Settings, On-device AI.

### Noted, not fixed

whisper.cpp and llama.cpp each vendor their own copy of ggml, and only one
survives linking — llama's, as it happens, so whisper.cpp calls into a ggml it
was not compiled against. It is currently benign: `struct ggml_tensor`,
`enum ggml_unary_op` and `enum ggml_glu_op` are identical between the two, the
`enum ggml_op` values whisper.cpp names by hand (`GGML_OP_MUL_MAT`,
`GGML_OP_GET_ROWS`) sit below the point where the two enums diverge, and every
other op value is assigned inside the single linked ggml, so it stays
self-consistent. It is worth re-checking on any bump of either crate, because
nothing enforces it.


## Unreleased (2026-09-08) — The model stops reloading itself

Five more things came back from a production build. Four of them turned out to
be two causes, and the app's own log had the numbers all along:

```
transcribe_diarize: starting full pass (99s of audio)
transcribe_diarize: transcribed in 227.752728583s
transcribe_diarize: diarized in 306.191162375s
```

Nearly nine minutes of "Finishing up" for a meeting that lasted a minute and a
half, on an M1 Pro.

### The live transcript kept up

`engine::transcribe` built a whole new `WhisperContext` on every call — reading
and preparing the 148 MB `ggml-base.en.bin` once per utterance of a live
recording, dwarfing the inference it was setting up for. That is the whole of
"Transcribing 171s behind": the backlog could only grow.

The model and its decoding state are now loaded once and kept for the life of
the process, and the same was done for the 29 MB speaker-embedding model.
Measured over a 60-second clip on an M1 Pro (`measures_transcription_speed`):

```
pass 1 (cold, includes loading the weights)  15.8s   3.8x real time
pass 2                                        7.0s   8.6x
pass 3                                        3.3s  18.0x
```

Replaying a clip the way the recorder actually does — utterance by utterance,
one pass at a time, live speaker labelling included — now runs at **4.0x real
time including the cold start** (`measures_the_live_loop`). The old path paid
that cold start on every chunk.

The status line also no longer names the engine. Which model is doing the work
is ours to worry about, not the user's.

### Stop stopped re-transcribing the whole meeting

The pass on Stop re-transcribed the entire recording before it started on
speakers — the same model over the same audio the live pass had already
transcribed, differing only in where the chunk boundaries fell. It is now a
speaker pass only (`diarize_meeting`), returning turns for the transcript the
user has been watching appear, so only the names on it change. That removes
228 s of a measured 534 s outright; diarization itself runs at 6–8x real time.

Two smaller things were making Stop worse than it needed to be:

- **The live drain loop never stood down.** `pumpTranscription` exits when the
  status leaves "recording" *or* "processing" — and Stop immediately sets
  "processing". So a pass already in flight carried on chewing through the
  entire backlog, in parallel with Stop's own budgeted drain and then with the
  speaker pass, competing for the same cores at exactly the moment somebody is
  waiting. Stop now takes the loop off the audio first and lets the pass in
  flight finish.
- **The two halves were on different clocks.** Utterances the silence gate
  rejects were never appended to the audio held back for the speaker pass, so
  that buffer is the meeting with its quiet parts cut out. Nothing noticed while
  the pass also re-transcribed that same buffer — both halves agreed with each
  other, and the saved transcript just had timestamps that quietly disagreed
  with the recording. `turnsToMeetingClock` now reconciles them, splitting any
  turn that straddles a cut.

### Live speaker labels, or none at all

Every live line was stamped "Speaker 1", because the live path had no speaker
model in it — so a two-person meeting was rendered, confidently, as one person
talking to themselves for its whole duration.

Each utterance is now embedded once and matched against the running centroid of
every voice heard so far in the meeting, so an index, once handed out, belongs
to that voice for the rest of the take. An enrolled voice gets its real name.

Both numbers governing that were measured, and the first guess at them was
wrong in the most embarrassing way available — 0.45 collapses every voice in the
test clip into one speaker, which is the exact bug being fixed.
`measures_speaker_separability` pools each speaker's audio and reports how far
apart CAM++ puts two clips of the same person versus two of different people:

```
window      same person    different people
   1 s          0.334            0.368        indistinguishable
   2 s          0.223            0.292
   3 s          0.158            0.248
   5 s          0.075            0.197
```

So: at least **3 seconds** of speech before attributing anything, and a distance
ceiling of **0.20**. Below that bar the engine returns no speaker and the line
renders with no chip at all. An unlabelled line costs the reader nothing; a
confidently wrong name costs them the transcript. The full pass on Stop
re-labels everything from a global view regardless.

### The copilot was never actually available

`LlmStatus` was serialised with Rust's snake_case field names while the UI has
always read `modelReady` and `modelName`. Readiness was therefore permanently
`undefined` with the weights sitting on disk — one missing serde attribute,
three reported bugs:

- the "download the copilot" banner never went away;
- its Download button did nothing visible, because `download_llm` correctly
  returns at once when the file is already there (the app log is eight
  consecutive `weights already present` lines, one per click);
- and `nativeChat` refused to run at all, so **every** meeting fell back to the
  extractive summariser and said the assistant "wasn't available when this
  meeting ended".

The wire names are now pinned by a test that asserts the JSON keys rather than
the struct, because both sides compile perfectly either way.

## Unreleased (2026-09-08) — Writing up a meeting, at a speed a meeting takes

Six things were reported after testing a production build on a Mac. They came
down to four causes, all in the on-device engine.

### Stopping a long meeting no longer looks like a crash

Sampling a build stuck for over an hour after Stop put 100% of the main thread
inside one call: `SpeakerEmbeddingExtractorGeneralImpl::Compute`, on a single
core. Three separate things were making that happen.

- **Diarization ran on one thread.** `sherpa-rs`'s `Diarize` wrapper hardcodes
  `num_threads: 1` for both the segmentation and embedding models and offers no
  way to change it. The config is now built against sherpa-onnx's C API
  directly, purely so the thread count is ours to set. Whisper was likewise
  left on its own `min(4, cores)` default.
- **The audio went over IPC as JSON.** `Array.from(samples)` turned a ten-minute
  meeting into a ~10-million-element array, which Tauri then serialised to a
  couple of hundred megabytes of JSON text — built in the webview and parsed in
  Rust, both on the main thread, before any transcription started. It is sent
  as raw `Float32Array` bytes now, which Tauri passes straight through.
- **Nothing said it was working.** The pass now reports its phase and progress,
  and logs how long each step took. Minutes of silence and a spinner is
  indistinguishable from a hang, which is how it was reported.

### Speakers who aren't the same person

The speaker-embedding model was `3dspeaker_..._sv_zh-cn_...` — trained on
Mandarin, and being asked to tell English speakers apart. It is now WeSpeaker's
English CAM++, which is also several times cheaper to run. The stale weights are
deleted on the next model download.

The clustering threshold was then **measured** rather than chosen, by sweeping
it over a 60-second two-speaker interview clip:

```
threshold   0.05  0.10  0.15  0.20  0.25  0.30  0.35  0.40 … 0.70
speakers       7     4     3     2     2     2     2     1 …    1
```

Two speakers hold from 0.20 to 0.35, so the value is 0.28, the middle of that
plateau. Every value that looked reasonable on paper is on the wrong side of the
cliff at 0.40: sherpa-onnx's own default is 0.5, and the previous value, 0.70,
came from a threshold that *was* measured but against the webview path's
different embedding model. Both put the interviewer and the guest in one person,
which is the reported symptom exactly. The sweep is a checked-in test, so the
next model change gets measured too instead of inheriting a number.

### Summaries that read like the transcript

They *were* the transcript. When the model fails, notes fall back to a heuristic
extractor that picks sentences verbatim — correct behaviour, invisible failure:
the `catch` was bare, so a fallback looked exactly like the model doing a bad
job. Four things were making it fire, or making its output worse:

- The transcript reached the model as one undifferentiated wall of text, with
  no speakers and no timestamps, so nothing could be attributed to anyone. It
  is now speaker- and time-labelled, using the formatter the copilot already
  used.
- It was clipped at 48,000 characters — which still overflows the model's
  8192-token window, *and* drops the end of a long meeting, where things get
  decided. Long meetings are now summarised in windows and condensed, so no
  part is dropped.
- On overflow the Rust side kept the most recent tokens, discarding the head —
  which for note-writing is the instructions and the JSON contract. It now
  protects the system prompt and trims the conversation instead.
- The 45-second timeout did not cover loading a 1.1 GB model off disk, so the
  first meeting after launch tended to fall back.

Then the prompt itself was measured against the real weights, and it needed
work. Given a transcript where a team agreed a price of 29, the old prompt got
back fluent notes saying the decision was "pending" and the audit log was "being
considered" — the number gone entirely. Plausible, ungrounded, and exactly what
the "never invent" line was there to stop. Naming each field, giving it a test
("something the group settled on", "someone committed to") and asking explicitly
for figures and owners to survive fixed it: the same transcript now yields the
decision with its number and date, and both action items with their owners. That
run is a checked-in test, so the next prompt edit gets measured too.

A meeting whose notes came from the extractor now says so, rather than leaving
transcript lines to look like a model doing a bad job.

### Live transcript arrives as it is spoken

Only a pause at the very *end* of the buffer counted as an utterance boundary,
and in flowing speech the tail is rarely quiet at the instant it is checked — so
nothing emitted until the 18-second ceiling, and then several chunks came due at
once. Past seven seconds, a gap the speaker already gave us is now used.

### You can see whether other people are being recorded

The system-audio toggle stated an intent and nothing more. `available()` answers
yes on macOS without probing, so an unsupported OS version or a refused
permission only surfaced once recording had started — and because the
screen-share route had already been skipped, the meeting quietly continued with
this device's microphone alone. It now falls back to the share picker, and the
live header says whether other voices are actually being *heard*, which is not
the same claim as the capture having started.

### The copilot download button

`startDownload` had a `finally` and no `catch`, so a failure became an unhandled
rejection and the prompt reverted with no explanation. Readiness was also read
exactly once on mount, so weights downloaded anywhere else left the prompt up
over a model that was already there — and pressing it did nothing visible,
because the command correctly returns straight away when the file exists.

## Unreleased (2026-09-07) — The redesign, the phone, and sync that is sync

### One design system, actually shared

The desktop app had been importing a hand copy of the theme rather than the
shared one, and the copy had drifted: its secondary text colour measured
**2.86:1** on the page — below WCAG AA — and it was the colour of every
timestamp, hint and metadata line in the product. Its `.ldg-prose` set no
typography at all. It had its own `Button`, `Card`, `Chip`, `EmptyState` and
`ErrorNote`, with a different primary colour, radii, press feedback and focus
ring from the site's.

- **New system.** Plus Jakarta Sans for everything (display is a weight, not a
  serif); a neutral canvas; six pastel families — iris, mint, peach, butter,
  sky, rose — each a soft tint, a fill and a text tone that clears AA on white
  and on its own tint; a twelve-step type scale; radii on one scale; layered
  shadows. **Dark mode** follows the system, with an override in Settings.
- **One source.** `packages/ui/src/tokens.ts` generates `tokens.css`; the
  test suite regenerates and fails on a stale file. Both apps import the one
  `theme.css`. 223 contrast and mirroring assertions, both modes.
- **One primitive set** — Button, IconButton, Card, Label, Badge, SpeakerChip,
  Avatar, Field/Input/Select/Textarea, Toggle, Segmented, Spinner,
  ProgressBar, Notice, EmptyState, ErrorNote, Logo — and the app's `ui.tsx`
  is now a re-export of it.
- **Every screen rebuilt**: a light sidebar with spaces and recent meetings,
  the page as a page rather than a window inside a window, a composer pill,
  the copilot answering in the open beside its mark, transcript lines with
  pastel speaker marks, real checkboxes on tasks, avatars from the person's
  family colour. Every page of the site rebuilt likewise; the favicon was still
  a green "P" in Arial and the install manifest a third palette.
- **Removed on purpose**: the paper grain, the serif, the all-caps mono
  labels, the eyebrow on every heading, three copies of a gradient avatar, two
  spinners, five loading patterns, six one-off notice boxes, and the
  fade-and-slide on every section.

### The phone app

- iOS and Android projects generated and committed
  (`apps/desktop/src-tauri/gen/`). The phone is the desktop app with a phone
  shell: bottom tabs, a notes sheet in the live room, microphone-only
  capture, the speech model downloaded on the first record rather than at
  launch, and no settings a phone cannot act on. Capabilities split so the
  desktop-only updater is not asked for on a phone. See `docs/MOBILE.md`.
- **Both run.** The iOS app (Xcode 26.6, iOS 26.5 runtime) runs on an iPhone
  17 Pro simulator: signed in, pulled every cloud meeting, recorded one, and it
  was on the laptop under the same id within seconds of Stop. The Android debug
  APK (`com.ledgeur.app`, arm64-v8a, NDK 29) installs and launches on a Pixel
  3a arm64 emulator and renders Home with the phone shell.
- **The Android system bars no longer sit on the app.** `env(safe-area-inset-*)`
  reports nothing in the Android WebView, so the gesture pill was drawn
  straight through the "Record" label in the tab bar. Both safe-area rules now
  floor at the height of a system bar; a real iOS inset is larger and still
  wins. This is the one defect a phone-width browser window could not show.
- Still needing a real handset, and listed in `docs/MANUAL_TESTING.md`: the
  microphone permission prompt (a simulator grants it without asking) and a
  real transcript — the simulator has no WebGPU, so transformers.js falls back
  to WebAssembly and runs far behind a live recording. The app says so
  ("Transcribing 50s behind on this device (CPU)") rather than appearing stuck.

### What running it on real devices found

Five defects that only show up on a phone, across two devices, or without a
network. All fixed, with tests where the logic is testable.

- **An open meeting never updated.** Every screen subscribed to the meetings
  store except the one showing a single meeting, which loaded once and never
  again — so a rename, a filing or a deletion arriving from another device did
  not appear until a reload.
- **"Sign out and in again" told to someone offline.** The workspace lookup
  read its query results and dropped the errors, so no network was
  indistinguishable from no workspace — and the advice for no workspace is to
  sign out, which needs the network they have not got.
- **`TypeError: Failed to fetch` shown to a person**, next to a "Live" badge
  claiming a Realtime channel that had gone. Both replaced by one honest
  state: "No connection. Everything is saved on this device, and syncs by
  itself once you are back online."
- **Recovery waited up to five minutes.** Nothing listened for the network
  coming back; it now resyncs about two seconds after it does.
- **A warning that could not be taken back.** Three audible-but-empty slices
  raised "the speech model isn't returning any text", and nothing ever cleared
  it — so on a device with no WebGPU, where the transcriber works through the
  silence before anyone speaks, it sat contradicting the live "transcribing
  50s behind" line for the rest of the meeting.

### iOS App Store readiness

`tauri ios build --export-method app-store-connect` now produces a correctly
signed, submission-ready `.ipa`, verified by unzipping the output and
checking the embedded provisioning profile and code signature rather than
assuming the export succeeded.

- Added `ITSAppUsesNonExemptEncryption: false` to the iOS `Info.plist`: the
  app only uses standard HTTPS/TLS, so this answers the export-compliance
  question automatically on every upload instead of asking each time.
- Found and documented the same Homebrew-vs-rustup `PATH` conflict that
  `release-macos.mjs` already works around: an iOS device build needs
  rustup's toolchain first on `PATH`, or it fails with `can't find crate for
  'core'`.
- `docs/MOBILE.md` now has a "Publish to the App Store" section covering the
  build command, where the signed `.ipa` lands, uploading it with
  Transporter, and the App Store Connect steps that need a human signed in
  (app record, privacy nutrition label, screenshots, TestFlight).
- The app identifier changed from `com.ledgeur.app` to `com.maxbeech.ledgeur`
  (the old one triggered a Tauri warning for conflicting with the `.app`
  bundle extension on macOS, and the App Store Connect record needed to be
  created fresh anyway). That meant deleting and regenerating both
  `gen/apple` and `gen/android`, since Android's package name is baked into
  Kotlin source paths, not just a config value. Custom `Info.plist` keys
  (the microphone string, the encryption flag) were moved out of `gen/apple`
  and into `apps/desktop/src-tauri/Info.ios.plist`, which Tauri merges in at
  build time and which survives that kind of regeneration; hand-edits to
  `gen/apple` do not. Re-verified end to end: the rebuilt `.ipa` carries the
  new identifier, a freshly issued "iOS Team Store Provisioning Profile:
  com.maxbeech.ledgeur", and the merged `Info.plist` keys.

### New logo, everywhere

Replaced the hand-drawn three-bar mark (a leftover from before the
ParleyNotes → Ledgeur rebrand) with the real logo, end to end: the shared
`Logo`/`LogoMark` primitives in `packages/ui` now render the actual
`/logo.png` and `/logo_with_text.png` files rather than inline SVG bars, so
every screen that uses them, the desktop sidebar, the "Ask anything" empty
state, the assistant-message marker, and the marketing site's header and
footer, picked it up automatically. Also regenerated from the same source:
the macOS/iOS/Android app icons (`tauri icon`, with the iOS/App Store 1024
icon re-flattened afterward to strip the alpha channel `--ios-color` leaves
behind — App Store Connect rejects an icon that still carries one, even a
fully opaque one), the site favicon and Apple touch icon, the PWA manifest
icon, and the Open Graph image, which previously redrew the old mark by hand
in `next/og` and now inlines the real PNG as a data URI instead.

The wordmark PNG's text is baked in near-black, so it read as blank space on
a dark background. A second PNG was generated by separating the mark's blue
pixels from the text's near-black ones (the blue channel is what tells them
apart, not lightness) and setting only the text to white; `Logo` now renders
both and `theme.css` shows whichever one matches the current theme, the same
`[data-theme]`/`prefers-color-scheme` rule `tokens.css` already uses.

### Accent colour: iris purple → the logo's blue

`iris` (aliased everywhere as `brand`) was the one pastel family that was a
placeholder colour rather than a considered one. Retuned to a blue sampled
from the real logo, both light and dark tints, keeping the same triad
structure (a pale tint, a vivid fill, an AA-legible strong tone) so nothing
that reads `bg-brand`/`text-brand-strong`/`iris-soft` needed to change. All
223 tokens tests, including every contrast assertion, pass unchanged against
the new values.

### Android release signing, and a path to the Play Store

Generated `~/.tauri/ledgeur-release.keystore` (2026-09-07, alongside the
existing macOS updater key, same rule: never regenerate it, or every future
update becomes impossible to publish under this listing) and wired
`build.gradle.kts` to sign release builds with it via a git-ignored
`keystore.properties`. `tauri android build --aab` now produces an
`app-universal-release.aab` verified actually signed (`jarsigner -verify`
reports "jar verified" against the new certificate), not just built.
`docs/MOBILE.md` has a new "Publish to the Play Store" section covering the
build command, the signing-key backup story, and the Play Console steps that
need a human signed in (developer account, Play App Signing, store listing,
Data safety section, content rating, a testing track before production).

### Sync

- A meeting was pushed once, on stop, under a server id the device never
  learned; nothing ever updated it. A renamed speaker, an edited title, a
  filed meeting, notes typed during the meeting — none of it reached the
  cloud. Spaces, recipes and manual notes were not in the database at all.
- **Now:** meetings keep their device id everywhere; every edit is stamped and
  pushed; deletions are tombstones the other device honours; spaces and
  recipes sync; the later edit wins by a rule tested in
  `packages/core/src/data/merge.ts`; Realtime change events pull the other
  device's work without a refresh; the whole library is cached locally so
  search and Ask work offline. `supabase/migrations/0007_sync.sql`.
- Against a backend that has not had the migration, the engine does what the
  old one could and **says so** in Settings, naming the migration. The live
  project has now had it applied, so Settings → Sync reads "In step" · "Live";
  the migration was made safe to run twice first, and
  `supabase/apply-migration.mjs` applies it over the Management API rather
  than by hand. Pressing "Sync now" re-asks the backend which schema it has —
  the schema answer is cached for the life of the process, and pressing Sync
  now is exactly what someone does straight after applying it.

### Also
- `bg-line`, a border class that did not exist, left three sign-in fields
  with no border. Two checkboxes read a CSS variable that did not exist and
  fell back to a hand-typed hex.
- The site's navigation is read from one list in `lib/site.ts`; the header
  and footer had drifted apart.

## 2026-08-26: Marketing observability

- Added Sentry browser, server, edge, and request-error monitoring to `apps/marketing`, with source-map uploads and the in-product feedback widget.

## Unreleased — Asking mid-meeting, and the parts of the job the app was missing

### The in-meeting copilot now knows more than the last few minutes

Asking a question during a meeting was grounded in exactly one thing:

```ts
getContext: () => [{ source: "Live transcript", text: segments.map(s => s.text).join(" ") }]
```

An unpunctuated, unattributed, untimed wall of text — and nothing else. So it
could not answer "what did Priya commit to?" (no speakers), "what did we just
decide?" (no order), or anything at all about what the company already knows,
which is the entire point of having Contextely connected. Every question needing
a fact from outside the room got "I don't have that information yet" while the
fact sat one API call away.

- **The room, properly described.** The transcript reaches the model
  speaker-labelled and timestamped (`[12:04] Sarah: …`), with a roster of who
  has spoken and for how long, plus whatever the user has typed into the notes
  panel. A question about who said what is now answerable at all.
- **The company, in the same prompt.** Contextely memory, Notion, the org's
  indexed meetings, this device's own past recordings and the calendar are
  fetched in parallel and packed alongside the transcript
  (`apps/desktop/src/lib/meetingContext.ts`).
- **On a deadline, and honest about it.** Remote sources get 5 seconds — past
  that the person has stopped waiting or missed what was said while waiting, so
  the answer goes without them and *names them*: "Answered without Contextely
  company memory (timed out)." A source that errored is named with its own
  error, instead of the previous single `catch {}` that made "not connected",
  "key expired" and "endpoint down" all look identical to "nothing found".
- **Retrieval instead of truncation.** An hour of speech is ~60k characters and
  was clipped with `.slice(0, 48000)` — which drops the *end*, the most recent
  and most relevant part, silently. `selectTranscriptContext`
  (`packages/core/src/context/transcript.ts`, pure and unit-tested) always keeps
  the recent tail intact and spends the rest of the budget on earlier passages
  that bear on the question, marking every elision so the model can see it was
  not given the whole meeting.
- **Whole blocks, or none.** `packContext` fits sources to a budget by relevance
  and reports what it dropped, rather than truncating one concatenated string
  and losing whichever source happened to sort last.
- **A prompt written for a live meeting.** Brief by default (the person may be
  about to speak), told that the transcript is speech-to-text and contains
  mishearings, and told that "this has not come up yet" is a different and more
  useful answer than "I don't know".
- **Every answer shows what it could see.** The source names are rendered under
  the bubble. "Grounded in the room and the company's memory" and "grounded in
  the last four minutes of speech" are different claims, and that difference was
  invisible from the prose.
- **Past meetings are ranked, not recent.** Ask used the newest twelve meetings
  regardless of the question, so anything about a meeting from three weeks ago
  was answered with "I don't have that information" while the answer sat in
  IndexedDB.
- **Fixed: a second meeting opened with the first one's conversation in it.**
  The thread cleared itself on "recording AND the model is still loading" —
  true only on a cold start, so it stopped working the moment the speech model
  began staying warm between recordings. The recorder now carries a `takeId`.

### Granola-parity work

Named honestly: this closes most of the gap, not all of it. See the end.

- **Per-line provenance.** Every note line links back to the transcript lines it
  came from; clicking "from 12:04" opens the transcript there and highlights it.
  A line the transcript does not support gets **no** citation rather than the
  least-bad guess — a wrong citation is worse than none, because it looks
  verified — and the count of unsupported lines is surfaced, since a bullet
  nothing in the meeting backs is either paraphrasing or a mishearing.
- **Follow-up emails.** Drafted from the meeting's real notes, editable before
  sending, opened in whatever mail app the person uses. Two paths, both marked:
  the on-device model, or a deterministic assembler that produces a genuinely
  sendable recap offline. Neither invents a recipient, an owner or a date; an
  action item with no owner stays without one.
- **Recipes.** User-written note templates alongside the six built-ins, flowing
  through the identical prompt path. A template that would do nothing is refused
  at the point of writing rather than discovered after a meeting.
- **32 spoken languages.** "Other languages" used to mean *let Whisper detect
  it*, which is the app's worst failure mode: a meeting that opens in English
  small talk and continues in German is transcribed as an entire meeting of
  confidently hallucinated English, with no error anywhere. The language is now
  passed to the decoder. Each is labelled with how well the model actually does
  on it rather than presented as uniformly supported.
- **Spaces.** One level deep on purpose. Deleting a space keeps its meetings and
  moves them back to Unfiled.
- **People directory.** Entirely derived from who has actually spoken and been
  named — there is no "add a person", because a hand-maintained directory is
  wrong within a month. Unnamed voices are counted, not listed as people.
- **Webhooks.** `meeting.completed` POSTed to a URL you control, HMAC-SHA256
  signed over `<timestamp>.<body>` in the GitHub/Stripe shape. Notes by default,
  transcript only on request, and **voice embeddings never**, under any setting.
  Settings shows the last real delivery rather than "configured".
- **Calendar auto-start.** Off by default. Only meetings with a join link, only
  within two minutes of the start, only once, never over a running take, and it
  fires a notification and opens the meeting room every time — recording that
  starts without a button press has to announce itself.
- **SAML single sign-on**, offered only when the backend actually has it on.
- **`list_people` over MCP**, so Contextely can ingest who's who alongside the
  meetings.

### Fixed: webhooks would have failed against almost every real receiver

Found by pointing the feature at an actual HTTP server rather than trusting it.
Ledgeur runs in a webview, so `fetch` obeys the browser's same-origin rules: a
cross-origin POST with custom headers (which every signed delivery is) triggers
a CORS preflight, and Zapier catch hooks, n8n and internal CRMs do not answer
one — they are not called by browsers and have no reason to implement CORS.
Every delivery would have failed with a bare "Failed to fetch", indistinguishable
from a typo in the URL. Deliveries now go through the native side
(`apps/desktop/src-tauri/src/net.rs`), where there is no origin and no preflight.

### Also

- `packages/core/src/text/tokens.ts` — one tokenizer and one relevance function
  underneath the summariser, the context builder and provenance. They were three
  private copies; provenance can only link a note back to its transcript line if
  it scores words the same way the summariser that produced it did.
- The calendar watcher moved out of the Home screen's schedule card into the
  Shell. It only ran while Home was on screen, so the "your meeting is starting"
  prompt depended on which page you were looking at, and auto-start could not
  have worked there at all.

### Still not Granola

Spaces are personal, not shared; there are no user groups, no org-wide sharing
of a space, no SSO-provisioned teams, no people *profiles* beyond what was
spoken, and no recipe sharing between users.

## Unreleased — Speakers, a real web app, and a price list that is true

### The recorder, properly this time

The previous round (below) found the right causes and then under-fixed three of
them. Reported again after real use: the model still loaded when starting a
recording, the live transcript was still slow, and system audio still asked for
screen recording. All three were true, and all three are now verified against
the real pipeline rather than argued from the code.

- **The speech pipeline is now owned by the process, not by a recording.**
  Keeping the warmed worker alive was right; handing it over with a *one-shot
  claim* and then calling `dispose()` in `stop()` was not. Only the first
  recording of a session ever benefited — every one after it terminated the
  worker and rebuilt the ONNX/WebGPU session from scratch, which is exactly what
  was reported. Worse, hitting Record before the warmup finished got `null` from
  the claim and built a *second* controller alongside the still-loading first,
  so two ONNX sessions competed for the GPU and the orphan leaked. There is now
  one transcriber and one diarizer for the life of the app
  (`apps/desktop/src/lib/asrEngine.ts`), created lazily, shared by warmup and
  recorder, never disposed. Concurrent callers share one load.
- **Recording no longer waits for the model at all.** `start()` used to `await`
  the pipeline before setting the status to recording, so the meeting was
  replaced by a full-screen "Loading the on-device model…" card. Capture now
  begins immediately, the meeting UI appears immediately, and audio banks up and
  is transcribed the moment a pipeline is live — so even a genuinely cold first
  launch starts recording instantly instead of showing a wait. The model's state
  is one quiet line under the header, and nothing at all in the normal case.
- **Chunks are cut on speech pauses, not on a clock.** A fixed 5-second slice
  lands mid-word, and Whisper does not lose a half-word — it *guesses* it, and
  the guess drags the rest of the decode with it. That was a direct cause of
  "the transcript was poor and inaccurate". `UtteranceSegmenter`
  (`packages/core/src/audio/segmenter.ts`, pure and unit-tested) accumulates and
  emits on a trailing pause, bounded to 3–18 seconds, cutting at the quietest
  frame when a monologue offers no pause. It also fixes latency the other way
  round: Whisper pads every input to a 30-second window, so a 3-second slice
  costs almost what an 18-second one does, and slicing more often to feel faster
  buys latency at a large multiple of the compute.
- **Capture and transcription are now separate loops.** The pump moves PCM out
  of the capture buffer every 250 ms and does no model work; a separate loop
  takes whole utterances and runs the model over them one at a time. Capture can
  no longer be starved by a slow model, and two model passes can never overlap.
  Speaker analysis for a slice is started only after that slice's transcription
  returns, so the two stop competing for the same GPU.
- **The level meter no longer re-renders the meeting.** It lived on recorder
  state and fired about twelve times a second, re-rendering the transcript,
  every chat bubble and the notes panel to move one bar. It is a module store
  (`audioLevel.ts`) that only the meter subscribes to.
- **System audio without screen recording is now on by default.** The Core Audio
  Process Tap shipped behind an opt-in Cargo feature, which meant every actual
  build had it off and still fell back to `getDisplayMedia` — the exact prompt
  it was written to remove. `system-audio-tap` is now a default feature. Its
  dependencies are declared under the macOS target only, so this is inert
  elsewhere and the command stubs stay in place on other platforms and on macOS
  older than 14.2. (Granola, for comparison, requires macOS "Screen & System
  Audio recording" permission for the same job.)
- **Backlog and failure are bounded and honest.** A pipeline that fails to start
  is retried at most every 30 seconds instead of on every 250 ms tick; audio
  beyond a five-minute backlog is dropped with a loud log rather than growing
  the heap until the app dies mid-meeting; and a transcript more than 45 seconds
  behind says so instead of looking like a hang.

**Verified end-to-end, not asserted.** The real pipeline was driven in the
browser with a 60-second speech recording substituted for the microphone:
transcription came back accurate and correctly punctuated, cut at sentence
boundaries (12s, 10s, 4s, 17s — variable, as pause-based segmentation should
be), lag held steady instead of compounding, a *second* recording in the same
session went live in about 300 ms with no model load, and Stop saved in 1.0
second against the "couple of minutes" reported.

### Meetings become company memory (Contextely)

Contextely ingests over MCP and already shipped a Ledgeur preset reading
`list_meetings` and `get_meeting`. It could never have worked: those tools
returned the repository's nested `FullMeeting` (`{ meeting, note, speakers,
segments }`), and Contextely's connector reads dotted field paths — `id`,
`title`, `notes,transcript,summary` — every one of which resolved to nothing
against that shape. Meetings would have ingested with no identifier, no title
and no content, and stored as empty memory objects rather than erroring.

- The MCP tools now return flat, self-describing records: top-level `id`,
  `title`, `url`, plus `summary`, `decisions`, `questions`, `notes` and a
  speaker-attributed `transcript` as plain text. The structured `speakers` and
  `segments` are kept alongside for agents that need "who said what".
- Pinned by tests that assert every field path the Contextely preset reads
  actually resolves — this fails silently at the far end, so it is not left to
  a manual check.
- The integrations card now shows both directions and hands over the endpoint to
  paste into Contextely.

### Notes you typed are finally used

The notes panel stored what you typed during a meeting and rendered it in the
saved record, but never sent it to the model — so the summary came out the same
whether or not you had noted what mattered. Typed notes now steer note
generation: covered first, in your order, each fragment expanded from the
transcript, with an explicit instruction to leave an unsupported fragment as you
wrote it rather than elaborating detail nobody said. Without a model, the
heuristic fallback keeps your notes verbatim at the top instead of dropping
them.

### Note templates

A sales call, a 1:1 and a user interview produce very different notes from the
same transcript, and which one you wanted is not recoverable afterwards. Six
built-in templates (`packages/core/src/notes/templates.ts`) now steer what the
summariser pays attention to, chosen on the Record screen and remembered.

They change content and emphasis, not the storage schema: notes are stored,
rendered, exported to Notion, synced and read back as one `MeetingNotes` shape,
and a per-template section list would mean changing every one of those
consumers. So a template contributes framing and a priority list that the model
folds into the existing four fields. That is a deliberate ceiling — a sales note
whose objections land under `summary` is still searchable, exportable and
diffable. A template may only ever *add* to the prompt: the JSON contract and
the never-invent rule are what keep notes parseable and grounded, and tests
assert no template can weaken either. A persisted id for a template that no
longer exists degrades to the general one rather than failing note generation.

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
