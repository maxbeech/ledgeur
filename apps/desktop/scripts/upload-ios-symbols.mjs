#!/usr/bin/env node
// Upload dSYMs from the most recent iOS archive to Sentry so native crashes
// symbolicate.
//
//   pnpm --filter @ledgeur/desktop release:ios:symbols
//
// `tauri ios build` writes the archive to
// src-tauri/gen/apple/build/ledgeur_iOS.xcarchive, which survives `cargo
// clean` and Xcode DerivedData cleanup (it lives under gen/apple, not
// DerivedData), so this can run any time after a build, independently of it.
//
// Requires `sentry-cli` on PATH and authenticated (`sentry-cli login`) —
// never pass a token on the command line or commit one.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE = join(ROOT, "src-tauri/gen/apple/build/ledgeur_iOS.xcarchive");
const DSYMS = join(ARCHIVE, "dSYMs");
const SENTRY_ORG = "maxed-labs";
const SENTRY_PROJECT = "ledgeur_desktop";

if (!existsSync(DSYMS)) {
  console.error(`No dSYMs found at ${DSYMS} — build with 'tauri ios build' first.`);
  process.exit(1);
}

execFileSync(
  "sentry-cli",
  ["debug-files", "upload", "--org", SENTRY_ORG, "--project", SENTRY_PROJECT, "--include-sources", DSYMS],
  { stdio: "inherit" },
);
