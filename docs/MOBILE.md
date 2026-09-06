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

## Run it

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

Nothing here can be verified without a simulator, an emulator or a device.
`docs/MANUAL_TESTING.md` lists the checks: a recording on the phone appearing
on the laptop under the same id, a rename on the laptop reaching the phone
without a refresh, and the microphone permission prompt on first record.
