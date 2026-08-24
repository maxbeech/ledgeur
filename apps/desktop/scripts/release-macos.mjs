#!/usr/bin/env node
// Build, sign, notarise and staple the macOS app in one command.
//
//   pnpm --filter @ledgeur/desktop release:mac
//
// Why this exists: `tauri build` on its own produces an ad-hoc signed bundle,
// which macOS Gatekeeper refuses to open on anyone else's machine ("Apple cannot
// check it for malicious software"). Getting a distributable build right means
// three things happening in order — sign with a Developer ID, notarise with
// Apple, staple the ticket — and it is easy to ship something that looks fine
// locally and is dead on arrival for users. This script does all three and then
// asks Gatekeeper for a second opinion.
//
// Credentials, all from the environment (never committed):
//   APPLE_SIGNING_IDENTITY  optional — auto-detected from the keychain if unset
//   APPLE_ID                Apple account email        \
//   APPLE_PASSWORD          app-specific password       } required to notarise
//   APPLE_TEAM_ID           10-character team id       /
//
// Builds a universal binary (Apple Silicon + Intel) by default, because a
// single-architecture download simply will not run for half the people who
// click it. Set LEDGEUR_MAC_TARGET=native for a quick host-only build while
// developing — never for something you hand to someone else.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UNIVERSAL = "universal-apple-darwin";
const TARGET = process.env.LEDGEUR_MAC_TARGET === "native" ? null : UNIVERSAL;
const BUNDLE = join(ROOT, "src-tauri/target", TARGET ?? "", "release/bundle");

// Homebrew's rust ships std for the host architecture only, so a universal
// build needs the rustup toolchain (which carries both) ahead of it on PATH.
const CARGO_BIN = join(process.env.HOME ?? "", ".cargo/bin");
const BUILD_PATH = existsSync(CARGO_BIN) ? `${CARGO_BIN}:${process.env.PATH}` : process.env.PATH;

const say = (m) => console.log(m);
const die = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });

/** The Developer ID in the keychain, unless one was named explicitly. */
function signingIdentity() {
  if (process.env.APPLE_SIGNING_IDENTITY) return process.env.APPLE_SIGNING_IDENTITY;
  let out = "";
  try {
    // execFileSync, not a shell string: no interpolation, no shell to confuse.
    out = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  } catch {
    die("Could not read the keychain. Is this a Mac with Xcode command line tools?");
  }
  const found = [...out.matchAll(/"(Developer ID Application: [^"]+)"/g)].map((m) => m[1]);
  if (found.length === 0) {
    die("No 'Developer ID Application' certificate in the keychain.\n" +
        "  Create one at https://developer.apple.com/account/resources/certificates,\n" +
        "  download it, and double-click to install. Without it the build cannot be\n" +
        "  distributed — macOS will refuse to open it on other machines.");
  }
  if (found.length > 1) {
    die(`More than one Developer ID certificate found:\n${found.map((f) => `    ${f}`).join("\n")}\n` +
        "  Pick one with APPLE_SIGNING_IDENTITY=\"...\"");
  }
  return found[0];
}

/** Notarisation credentials, or null with an explanation of what is missing. */
function notaryCredentials() {
  const { APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID } = process.env;
  const missing = [
    !APPLE_ID && "APPLE_ID",
    !APPLE_PASSWORD && "APPLE_PASSWORD",
    !APPLE_TEAM_ID && "APPLE_TEAM_ID",
  ].filter(Boolean);
  return missing.length ? { missing } : { APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID };
}

/** A universal build silently falls back to one arch if a target is missing. */
function requireTargets() {
  let installed = "";
  try {
    installed = execFileSync("rustup", ["target", "list", "--installed"],
      { encoding: "utf8", env: { ...process.env, PATH: BUILD_PATH } });
  } catch {
    die("rustup is needed for a universal build but was not found.\n" +
        "  Install it from https://rustup.rs, then:\n" +
        "    rustup target add x86_64-apple-darwin aarch64-apple-darwin");
  }
  const missing = ["x86_64-apple-darwin", "aarch64-apple-darwin"].filter((t) => !installed.includes(t));
  if (missing.length) {
    die(`Missing Rust target(s): ${missing.join(", ")}\n` +
        `  rustup target add ${missing.join(" ")}`);
  }
}

/** The bundle's executable, whatever the bundler happened to name it. */
function mainExecutable(appPath) {
  const dir = join(appPath, "Contents/MacOS");
  const entries = existsSync(dir) ? readdirSync(dir) : [];
  if (entries.length !== 1) die(`Expected exactly one executable in ${dir}, found ${entries.length}.`);
  return join(dir, entries[0]);
}

/** Ask the binary what it contains, rather than trusting the build flag. */
function assertArchitectures(binary) {
  const archs = execFileSync("lipo", ["-archs", binary], { encoding: "utf8" }).trim().split(/\s+/);
  say(`\n▸ Architectures in the binary: ${archs.join(", ")}`);
  if (!TARGET) return archs;
  const missing = ["x86_64", "arm64"].filter((a) => !archs.includes(a));
  if (missing.length) die(`This was meant to be a universal build but is missing: ${missing.join(", ")}`);
  return archs;
}

/** Most recently written file with this extension — notarise what we just built,
 *  not whatever happens to sort last. */
const newestFile = (dir, ext) => {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => join(dir, f));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
};

// ── 1. build + sign ────────────────────────────────────────────────────────
const identity = signingIdentity();
say(`\n▸ Signing as: ${identity}`);
say(TARGET ? `▸ Target: ${TARGET} (Apple Silicon + Intel)` : "▸ Target: this machine only (LEDGEUR_MAC_TARGET=native)");
if (TARGET) requireTargets();
run("pnpm", ["tauri", "build", ...(TARGET ? ["--target", TARGET] : [])], {
  env: { ...process.env, PATH: BUILD_PATH, APPLE_SIGNING_IDENTITY: identity },
});

const app = join(BUNDLE, "macos/Ledgeur.app");
const dmg = newestFile(join(BUNDLE, "dmg"), ".dmg");
if (!existsSync(app)) die(`Build finished but ${app} is missing.`);
assertArchitectures(mainExecutable(app));

// ── 2. notarise ────────────────────────────────────────────────────────────
const creds = notaryCredentials();
if (creds.missing) {
  say("\n▸ Skipping notarisation — missing: " + creds.missing.join(", "));
  say(
    "\n  The build is signed but NOT notarised, so Gatekeeper will still block it\n" +
    "  for other people. To finish:\n" +
    "    1. Sign in at https://account.apple.com → App-Specific Passwords → generate one\n" +
    "    2. Re-run with:\n" +
    "         APPLE_ID=you@example.com \\\n" +
    "         APPLE_PASSWORD=abcd-efgh-ijkl-mnop \\\n" +
    "         APPLE_TEAM_ID=XXXXXXXXXX \\\n" +
    "         pnpm --filter @ledgeur/desktop release:mac\n",
  );
} else {
  if (!dmg) die("No .dmg was produced, so there is nothing to notarise.");
  say(`\n▸ Notarising ${dmg} (Apple usually takes a few minutes)…`);
  run("xcrun", [
    "notarytool", "submit", dmg,
    "--apple-id", creds.APPLE_ID,
    "--password", creds.APPLE_PASSWORD,
    "--team-id", creds.APPLE_TEAM_ID,
    "--wait",
  ]);
  say("\n▸ Stapling the ticket so it works offline…");
  run("xcrun", ["stapler", "staple", app]);
  run("xcrun", ["stapler", "staple", dmg]);
}

// ── 3. ask Gatekeeper, rather than assume ──────────────────────────────────
say("\n▸ Gatekeeper assessment:");
try {
  execFileSync("spctl", ["-a", "-vv", app], { stdio: "inherit" });
  say("\n✓ Accepted — this build will open on other Macs.");
} catch {
  say("\n✖ Rejected. If it says 'Unnotarized Developer ID', the signing worked and\n" +
      "  only notarisation is left (see the instructions above).");
  process.exit(1);
}
