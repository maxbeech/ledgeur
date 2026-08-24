// Copies the canonical ASR + diarization workers and their load plans into an
// app's public/ directory,
// so both apps serve byte-identical files from one source.
//
//   node packages/asr/sync.mjs <targetDir> [...more]   # write copies
//   node packages/asr/sync.mjs --check <targetDir> ...  # verify, exit 1 on drift
//
// Wired into each app's predev/prebuild, and asserted by packages/asr tests.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ASSETS = [
  "asr-plan.js",
  "transcribe.worker.js",
  "diarize-plan.js",
  "diarize.worker.js",
];

/** Absolute path to a canonical asset. */
export const sourcePath = (name) => join(HERE, name);

/** Default public/ directories that must carry a copy. */
export const TARGETS = [
  resolve(HERE, "../../apps/marketing/public"),
  resolve(HERE, "../../apps/desktop/public"),
];

/** @returns {string[]} list of files that differ from the canonical source. */
export function checkTargets(targets = TARGETS) {
  const drifted = [];
  for (const dir of targets) {
    for (const name of ASSETS) {
      const dest = join(dir, name);
      if (!existsSync(dest) || readFileSync(dest, "utf8") !== readFileSync(sourcePath(name), "utf8")) {
        drifted.push(dest);
      }
    }
  }
  return drifted;
}

/** @returns {string[]} list of files written (i.e. that were stale). */
export function syncTargets(targets = TARGETS) {
  const written = [];
  for (const dir of targets) {
    mkdirSync(dir, { recursive: true });
    for (const name of ASSETS) {
      const src = readFileSync(sourcePath(name), "utf8");
      const dest = join(dir, name);
      if (!existsSync(dest) || readFileSync(dest, "utf8") !== src) {
        writeFileSync(dest, src);
        written.push(dest);
      }
    }
  }
  return written;
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const dirs = args.filter((a) => a !== "--check").map((a) => resolve(a));
  const targets = dirs.length ? dirs : TARGETS;

  if (check) {
    const drifted = checkTargets(targets);
    if (drifted.length) {
      console.error("ASR assets are out of date:\n" + drifted.map((f) => `  ${f}`).join("\n") +
        "\nRun: node packages/asr/sync.mjs");
      process.exit(1);
    }
    console.log("ASR assets up to date.");
  } else {
    const written = syncTargets(targets);
    console.log(written.length ? `Synced ASR assets:\n${written.map((f) => `  ${f}`).join("\n")}` : "ASR assets already up to date.");
  }
}
