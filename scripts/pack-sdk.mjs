#!/usr/bin/env node
// Build @ledgeur/sdk, `npm pack` it, and hand the tarball to Plenence.
//
//   node scripts/pack-sdk.mjs
//
// The tarball is copied to ../Plenence-app-polish/vendor/ledgeur-sdk-<version>.tgz
// when that vendor directory exists (it is created if the Plenence checkout
// does), so an app that has not published the SDK can still depend on it:
//   "@ledgeur/sdk": "file:vendor/ledgeur-sdk-0.1.0.tgz"
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, mkdtempSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdk = join(repo, "packages/sdk");
const { version } = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8"));

execFileSync("pnpm", ["--filter", "@ledgeur/sdk", "build"], { cwd: repo, stdio: "inherit" });

const out = mkdtempSync(join(tmpdir(), "ledgeur-sdk-"));
const [{ filename }] = JSON.parse(
  execFileSync("npm", ["pack", "--json", "--pack-destination", out], { cwd: sdk, encoding: "utf8" }),
);
const tarball = join(out, filename);
console.log(`Packed ${tarball}`);

// Sibling checkout of Plenence, next to this repo (or its worktree folder).
const candidates = [
  resolve(repo, "../Plenence-app-polish"),
  resolve(repo, "../../Plenence-app-polish"), // when run from a worktree in ../_worktrees
  resolve("/Users/maxbeech/Documents/Beech/Development/Products/Plenence-app-polish"),
];
const plenence = candidates.find((p) => existsSync(p));
if (!plenence) {
  console.log("No ../Plenence-app-polish checkout found; tarball not copied.");
  process.exit(0);
}
const vendor = join(plenence, "vendor");
mkdirSync(vendor, { recursive: true });
const dest = join(vendor, `ledgeur-sdk-${version}.tgz`);
copyFileSync(tarball, dest);
console.log(`Copied to ${dest}`);
