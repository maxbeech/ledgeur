# The phone app

Ledgeur on iOS and Android is the desktop app: the same React code, the same
Rust core, the same account. There is no second codebase. The shell decides
what a phone can do — a light sidebar becomes bottom tabs, system audio is not
offered because a phone hears the room through its microphone, and the
settings a phone cannot act on (webhooks, the native engine) are not shown.

Everything a phone records syncs to the account under the same id the laptop
will use, and everything the laptop records appears on the phone — see
`docs/ARCHITECTURE.md`, "Sync", and `supabase/migrations/0007_sync.sql`.

## Status

Built from source, not in the stores. The Xcode and Android Studio projects
are generated into `apps/desktop/src-tauri/gen/` by the Tauri CLI and are
committed, so a checkout can build without running `init` again.

## Prerequisites

- Rust with the mobile targets:
  `rustup target add aarch64-apple-ios aarch64-apple-ios-sim aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`
- **iOS:** Xcode 16 or later with the iOS platform installed. A simulator is
  enough for development; a device needs a signing team in Xcode.
- **Android:** Android Studio with an SDK (platform 34+), an NDK (27+), and a
  JDK 17. Export `ANDROID_HOME`, `NDK_HOME` and `JAVA_HOME`.

## Run it on your own iPhone

The signing team is set in `tauri.conf.json` (`bundle.iOS.developmentTeam`), so
this needs no Xcode fiddling beyond trusting the app once on the phone. A team
id is an identifier rather than a secret; set `APPLE_DEVELOPMENT_TEAM` to build
under a different account.

1. Plug the iPhone into the Mac and unlock it; tap **Trust** if it asks. The
   first time, also turn on **Settings → Privacy & Security → Developer Mode**
   on the phone and let it restart.
2. From the repo root:

   ```bash
   pnpm --filter @ledgeur/desktop tauri ios dev --open --host
   ```

   `--host` puts the Vite dev server on the LAN, which a real phone needs: a
   simulator shares the Mac's `localhost`, a phone does not. `--open` opens
   Xcode.
3. In Xcode, choose the iPhone in the device menu and press **Run**. Xcode
   creates the provisioning profile itself the first time.
4. iOS blocks the first launch until you allow it: **Settings → General → VPN &
   Device Management → Developer App → Trust**.

The app stays on the phone and keeps working unplugged, though the signing
profile expires (7 days on a free Apple account, a year on a paid one), after
which you re-run step 2. To give a build to someone else without a cable:

```bash
pnpm --filter @ledgeur/desktop tauri ios build --export-method release-testing
```

and send them the `.ipa` — their device's UDID has to be registered in the
developer account first. TestFlight is the way to avoid that, and needs an App
Store Connect record.

## Publish to the App Store

Verified end-to-end on 2026-09-07: this produces a correctly signed,
App-Store-ready `.ipa` with no manual Xcode signing step.

```bash
PATH="$HOME/.cargo/bin:$PATH" pnpm --filter @ledgeur/desktop tauri ios build --export-method app-store-connect
```

The `PATH` prefix matters for the same reason it does in `release-macos.mjs`.
Homebrew's `rustc` is usually first on `PATH` and has no iOS standard
library, so the build fails with `error[E0463]: can't find crate for 'core'`
unless rustup's toolchain goes first.

**Custom `Info.plist` keys (the microphone string, `ITSAppUsesNonExemptEncryption`)
live in `apps/desktop/src-tauri/Info.ios.plist`**, not in `gen/apple` directly.
Tauri auto-detects that filename and merges it into the generated Info.plist
at build time. This matters because `gen/apple` and `gen/android` are meant
to be disposable: if the bundle identifier ever changes, delete both and
regenerate with `tauri ios init --ci` / `tauri android init --ci` rather than
hand-editing the old ones, since Android's package name is baked into
Kotlin source paths (`gen/android/app/src/main/java/<package>/...`), not
just a config value. Editing `gen/apple`'s `project.yml` directly does not
survive that regeneration; `Info.ios.plist` does.

**App icons need `tauri icon <path> --ios-color '#ffffff'` run *after* `ios
init`/`android init`, not before.** `ios init`/`android init` overwrite
`gen/apple/Assets.xcassets` and `gen/android/.../mipmap-*` from their own
template, clobbering whatever `tauri icon` had already put there. Also: the
iOS 1024 App Store icon must have no alpha channel at all, and `--ios-color`
alone doesn't strip it (it just paints an opaque background behind a PNG
that still carries the channel), so flatten it after generating or App Store
Connect will reject the binary:

```bash
for f in apps/desktop/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/AppIcon-*.png; do
  magick "$f" -background white -alpha remove -alpha off "$f"
done
```

Automatic signing needs no `.env.local` credentials beyond what's already
there for the macOS notarised release (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`). It fetches an **"Apple Distribution: Maxed Labs Ltd"**
certificate and creates an **"iOS Team Store Provisioning Profile:
com.maxbeech.ledgeur"** on its own, using the Apple account already signed into
Xcode on this Mac (Xcode → Settings → Accounts). That was confirmed, not
assumed, by unzipping the output and checking `embedded.mobileprovision` and
the code signature directly.

The result lands at:

```
apps/desktop/src-tauri/gen/apple/build/arm64/Ledgeur.ipa
```

**Upload it** with [Transporter](https://apps.apple.com/app/transporter/id1450874784),
Apple's own Mac App Store app: open it, sign in with the Apple ID, drag in
the `.ipa`. That's a better bet than a CLI tool here, since Apple has been
moving upload auth from `xcrun altool` (username + app-specific password) to
App Store Connect API keys, and which one actually works can change between
Xcode releases. Transporter always matches whatever Xcode currently supports.

**Before the first upload can succeed, an App Store Connect app record for
`com.maxbeech.ledgeur` has to exist.** That, and everything after it, needs a
human signed into https://appstoreconnect.apple.com; none of it can be done
from here:

1. **App Store Connect → Apps → +** → new app, bundle ID `com.maxbeech.ledgeur`,
   name "Ledgeur" (or whatever isn't already taken, since app names are
   global).
2. **App Privacy** (the "nutrition label"): declare what's collected. Today
   that's an account email/password for sync, and audio/transcripts *only if*
   the user turns on sync; recording stays on-device otherwise. Describe it
   that way, not as blanket "we collect audio."
3. **Age rating** questionnaire, **Export Compliance** (this app only uses
   standard HTTPS/TLS, so the `ITSAppUsesNonExemptEncryption: false` already
   set in `Info.plist` answers this automatically), **pricing** (free),
   **support URL** and **privacy policy URL** (ledgeur.com already has one
   at `/privacy`).
4. **Screenshots**: at minimum a 6.9" (or 6.5") iPhone set. Apple no longer
   requires iPad screenshots if the app doesn't support iPad, but this one
   does (`TARGETED_DEVICE_FAMILY = "1,2"`), so a 13" iPad set too. The
   simulator can produce these (`xcrun simctl io <device> screenshot`).
5. Upload the `.ipa` (Transporter, above), pick the build in App Store
   Connect, fill in the description/keywords/"What's New" text, and submit.
   **TestFlight first is strongly recommended.** The same build can go to
   internal testers immediately after upload, before it's ever submitted for
   public review, and it's the only realistic way to find out whether Notion
   and Google Calendar's OAuth "Connect" buttons actually complete their
   round trip in a real WKWebView on a phone, which has not been tested on
   iOS yet.

One rough edge worth knowing about before a reviewer finds it: "Connect
Google Calendar" in Settings calls the same Google sign-in as the desktop
account flow. On the live backend only email/password is enabled today, so
tapping it surfaces a clear "provider not available" error instead of
hanging. That's correct, but worth a second look before submitting in case
it's not the impression you want a reviewer to get.

## Publish to the Play Store

Release signing is wired up and verified end to end on 2026-09-07: a signed,
Play-Store-ready `.aab` builds with one command.

```bash
ANDROID_HOME=~/Library/Android/sdk NDK_HOME=~/Library/Android/sdk/ndk/<version> \
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
pnpm --filter @ledgeur/desktop tauri android build --aab --target aarch64 --ci
```

Output: `apps/desktop/src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`
(an `.aab` always bundles every ABI regardless of `--target`; the flag only
scopes which native library actually gets built). Confirmed signed, not just
built: `jarsigner -verify -verbose -certs` on it reports "jar verified" with
the `Maxed Labs Ltd` certificate from the new keystore.

**The signing key.** Unlike iOS, Android release signing has no equivalent of
automatic provisioning: you own the key outright, and it lives at
`~/.tauri/ledgeur-release.keystore` (generated 2026-09-07, alongside the
existing updater key, same reasoning: **never regenerate it**. Every future
update to this app on the Play Store has to be signed with the same key
forever, or the Play Store will refuse the upload as "a different app").
`apps/desktop/src-tauri/gen/android/keystore.properties` (git-ignored, points
`build.gradle.kts`'s signing config at it) and the keystore's password (in
the repo-root `.env.local` as `ANDROID_KEYSTORE_PASSWORD`) both need backing
up somewhere durable outside this machine. Losing either one, with no other
copy, means never being able to update this app on the Play Store again
under this listing.

Since `keystore.properties` doesn't exist until generated, and
`gen/android` gets deleted and regenerated on things like a bundle-id change
(see the note above about `Info.ios.plist`), regenerating `gen/android` will
require recreating `keystore.properties` (not the keystore itself) and the
few lines it adds to `build.gradle.kts`'s `signingConfigs`/`buildTypes.release`
blocks. The build silently produces an *unsigned* release artifact instead
of failing if that file is missing, which is worth knowing before wondering
why an upload was rejected.

**Play Console, all of which needs a human signed into
https://play.google.com/console, none of it can be done from here:**

1. **Create a developer account** if one doesn't exist yet (one-time $25 fee,
   identity verification that can take a few days, so start this early).
2. **Create the app**: Play Console → Create app → name "Ledgeur", package
   `com.maxbeech.ledgeur`, free.
3. **Play App Signing**: when prompted during the first release, let Google
   manage the actual signing key and treat the local keystore as an "upload
   key." This is the default and the recommended path, since it means a
   lost/compromised upload key can be reset without losing the app's Play
   Store identity, unlike losing the key outright under self-managed signing.
4. **Store listing**: description, screenshots (phone, and a tablet set is
   recommended since `minSdk`/the manifest don't restrict form factor),
   feature graphic, icon (`apps/desktop/src-tauri/gen/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`
   is the 192×192 source Play Console wants scaled from), privacy policy URL
   (ledgeur.com's `/privacy`), and the **Data safety** section (Play's
   equivalent of Apple's nutrition label: the same honest answer as iOS,
   account email for sync, audio/transcripts only if sync is turned on).
5. **Content rating questionnaire**, **target audience**, **app category**.
6. **Upload the `.aab`** to a testing track first. Internal testing is
   instant and doesn't need a review, and is the same "find out if OAuth
   actually works on a real device" opportunity TestFlight is for iOS.
   Production release from there does need Google's review, which is
   usually hours to a couple of days for a first submission.

## Run it on a simulator or emulator


```bash
# iOS, on the default booted simulator (or name one: … ios dev "iPhone 17 Pro")
pnpm --filter @ledgeur/desktop tauri ios dev

# Android, on a running emulator or a connected device
ANDROID_HOME=~/Library/Android/sdk NDK_HOME=~/Library/Android/sdk/ndk/<version> \
JAVA_HOME=/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home \
pnpm --filter @ledgeur/desktop tauri android dev
```

`dev` starts the Vite server, compiles the Rust core for the target, and
launches the app with hot reload for the frontend. The first build compiles
every crate for the phone's architecture and takes several minutes.

## Build it

```bash
pnpm --filter @ledgeur/desktop tauri ios build      # an .ipa, via Xcode archive
pnpm --filter @ledgeur/desktop tauri android build  # an .apk / .aab
```

Store distribution needs a signing identity and an App Store Connect / Play
Console listing, which are not in this repository.

## What is different on a phone

| | Desktop | Phone |
|---|---|---|
| Layout | Sidebar, pages, pinned composer | Bottom tabs, large titles, sheets |
| Capture | Microphone and system audio (Core Audio tap on macOS) | Microphone only |
| Speech model | Warmed at launch | Downloaded the first time you record, so a metered connection is never used silently |
| Transcription | WebGPU where the webview has it, else WebAssembly | WebGPU on iOS 26+ WKWebView, else WebAssembly — slower on older phones |
| Notes, copilot | On-device model or configured endpoint | Configured endpoint; the on-device LLM is desktop-only |
| Updates | In-app auto-updater | The store |
| Webhooks | Native HTTP from Rust | Not offered |

## Permissions

- iOS: `NSMicrophoneUsageDescription` in `gen/apple/ledgeur_iOS/Info.plist`.
- Android: `RECORD_AUDIO` in `gen/android/app/src/main/AndroidManifest.xml`.

Both strings say what is taken and where it goes: audio is transcribed on the
phone and stays there unless the meeting is synced.

## Testing

Both apps have been run (2026-09-07).

**iOS.** Built with Xcode 26.6 against the iOS 26.5 runtime and launched on an
iPhone 17 Pro simulator. Signed in, pulled every cloud meeting, recorded, and
the recording was on the laptop under the same id within seconds of Stop.

**Android.** The debug APK installs and launches on a Pixel 3a arm64 emulator
and renders Home with the phone shell. Two things about the emulator, learned
the hard way: it needs real free memory — under swap pressure its package
service dies mid-install with `cmd: Can't find service: package` or a broken
pipe, which looks like a corrupt APK and is not — and `gradlew assemble…` on
its own fails in `:app:rustBuildArm64Debug`, because that task shells back into
`tauri android android-studio-script`, which expects a dev-server address file.
Build with `pnpm tauri android build`, never with Gradle directly.

The one thing running on Android caught that a phone-width browser did not:
the system's gesture pill was drawn straight through the "Record" label,
because `env(safe-area-inset-*)` reports nothing in the Android WebView. Both
safe-area rules now floor at the height of an Android system bar.

Not yet covered by either run, and listed in `docs/MANUAL_TESTING.md`: the
microphone permission prompt (a simulator grants it without asking) and a real
transcript on a phone — the iOS simulator has no WebGPU, so transformers.js
falls back to WebAssembly and runs far behind a live recording.

The debug APK lands at
`apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/debug/`
and installs with `adb install -r <apk>` on any arm64 device with developer
mode on. It is large (about 470 MB) because a debug build carries unstripped
Rust symbols; a release build is a fraction of that.

## Widgets

Both phones get a widget whose only job is to get somebody from a locked phone
to a live microphone in one tap. A widget cannot run app code, reach the
database or record anything — it renders, and it can ask the system to open a
URL. That URL is the entire interface:

| Link | What the app does |
|---|---|
| `ledgeur://capture` | Opens the capture box, ready to type |
| `ledgeur://capture?mode=speak` | Opens it and starts listening immediately |
| `ledgeur://record` | Starts a recording |

They are parsed by `parseCaptureLink` in `apps/desktop/src/lib/captureLinks.ts`
and pinned by tests on both sides. **Changing a string in a widget without
changing that parser is a tap that silently does nothing on somebody's lock
screen** — the kind of bug nobody reports; they just stop using the widget.

### iOS

`gen/apple/LedgeurWidget/LedgeurWidget.swift`, added to `gen/apple/project.yml`
as an `app-extension` target that the app embeds. Home screen (small and
medium) plus the iOS 16 lock-screen families (circular and rectangular).

Two things to know:

* The extension deploys to **iOS 16** while the app deploys to 14, because the
  lock-screen families do not exist before then. On an older system the app is
  unchanged and the widget is simply not offered.
* Its `CFBundleShortVersionString` / `CFBundleVersion` in `project.yml` **must
  match the app target's**. App Store Connect rejects a mismatch *after* the
  archive, the signing and the upload, so a one-character drift costs a release
  cycle to find.

`project.yml` is hand-extended: `tauri ios init` regenerates it and would drop
the widget target. Re-run `xcodegen generate` (or `tauri ios build`) after
editing it, and check `git diff` if you ever re-run `ios init`.

> **Never hand-edit `ledgeur_iOS/Info.plist`.** XcodeGen rewrites that file from
> `project.yml` every time it runs, keeping only what the spec lists. Adding this
> widget did exactly that and silently deleted `NSMicrophoneUsageDescription`,
> `NSAudioCaptureUsageDescription` and `ITSAppUsesNonExemptEncryption`, which had
> only ever been added to the plist. iOS does not warn about a missing usage
> description: it **terminates the app** the moment it asks for the microphone,
> which is both recording and dictation. They live in `project.yml` now. Anything
> else that belongs in that plist goes there too, and `git diff` on the generated
> plist is worth reading after any `xcodegen` run.

Automatic signing has to mint a second provisioning profile, for
`com.maxbeech.ledgeur.widget`. Xcode does that on the first build with the team
selected; a CI machine that has never built it will need the same.

### Android

`gen/android/app/src/main/java/com/maxbeech/ledgeur/CaptureWidget.kt`, with its
layout in `res/layout/widget_capture.xml`, its declaration in
`res/xml/capture_widget_info.xml` and a palette in `res/values*/colors.xml` that
follows the app's own tokens in light and dark.

The `ledgeur://` intent filter on `MainActivity` in `AndroidManifest.xml` is
what makes the tap land: the deep-link plugin's own Android manifest is empty
and contributes none, which was checked rather than assumed. `MainActivity` is
already `singleTask`, so a tap while the app is open delivers the URL to the
running instance instead of starting a second one.

### Still to verify on hardware

Both widgets compile (`swiftc -typecheck` against the iOS 16 SDK;
`:app:compileUniversalDebugKotlin`), and the link contract is unit-tested from
the app's side. What no test here covers is the tap itself on a real device —
adding the widget from the gallery, tapping it on a locked phone, and landing
in a listening capture box. That is in `docs/MANUAL_TESTING.md`.
