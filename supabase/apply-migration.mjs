#!/usr/bin/env node
// Apply a migration to the live Supabase project over the Management API.
//
// The Supabase CLI needs a linked project and the database password; this needs
// only a personal access token, which is the credential this machine actually
// has. Point it at a file in supabase/migrations and it runs the whole file as
// one statement batch.
//
//   SUPABASE_PAT=sbp_… node supabase/apply-migration.mjs 0007_sync.sql
//
// When the token is not already in the environment it is read from the repo's
// gitignored env files — `.env.local` at the root (where the other operator
// credentials live: Apple, the updater key) or `apps/desktop/.env`, under
// either SUPABASE_PAT or SUPABASE_ACCESS_TOKEN. The project ref is derived from
// VITE_SUPABASE_URL so the project is never named twice.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

/** Parse a .env file into a plain object. Ignores comments and blank lines. */
function readEnv(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); } catch { return {}; }
  const out = {};
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// Later files do not override earlier ones, so an explicit environment variable
// always wins and the root file is preferred for operator credentials.
const env = { ...readEnv(join(repo, "apps/desktop/.env")), ...readEnv(join(repo, ".env.local")) };
const pick = (...names) => names.map((n) => process.env[n] || env[n]).find(Boolean);

const token = pick("SUPABASE_PAT", "SUPABASE_ACCESS_TOKEN");
const url = pick("VITE_SUPABASE_URL");

if (!token) {
  console.error("No Supabase personal access token. Create one at");
  console.error("  https://supabase.com/dashboard/account/tokens");
  console.error("then add it to .env.local as SUPABASE_PAT=sbp_…");
  process.exit(2);
}
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url || "")?.[1];
if (!ref) {
  console.error(`Could not read a project ref from VITE_SUPABASE_URL (${url ?? "unset"}).`);
  process.exit(2);
}

const name = process.argv[2];
if (!name) {
  console.error("Usage: node supabase/apply-migration.mjs <file in supabase/migrations>");
  process.exit(2);
}
const file = join(here, "migrations", name);
const sql = readFileSync(file, "utf8");

console.log(`Applying ${name} (${sql.split("\n").length} lines) to project ${ref}…`);

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});

const body = await res.text();
if (!res.ok) {
  console.error(`Failed (HTTP ${res.status}): ${body}`);
  process.exit(1);
}
console.log("Applied.");
if (body.trim() && body.trim() !== "[]") console.log(body);
