#!/usr/bin/env node
// Does migration 0009 actually stop a free account writing, and actually let a
// paid one through? Run against the live project with the test account:
//
//   node supabase/verify-sync-gate.mjs
//
// Both directions matter. A gate that refuses everybody is not a gate, it is an
// outage, and the only way to tell them apart is to flip the plan and watch the
// same write succeed. So this flips the test workspace's plan to 'team', runs
// the same writes again, and puts the plan back in a `finally` block whatever
// happens.
//
// Credentials come from apps/desktop/.env and .env.local, the same two files
// apply-migration.mjs reads. Nothing here is destructive to anybody else's
// data: every row it creates carries a "0009 gate check" title and is deleted
// on the way out, and the count of leftovers is printed so a failed cleanup is
// visible rather than assumed.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const repo = "/Users/maxbeech/Documents/Beech/Development/ProductFactory/ledgeur";
const env = {};
for (const f of [`${repo}/apps/desktop/.env`, `${repo}/.env.local`]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* optional */ }
}

const url = env.VITE_SUPABASE_URL;
const anon = env.VITE_SUPABASE_ANON_KEY;
const email = env.TEST_ACCOUNT_EMAIL;
const password = env.TEST_ACCOUNT_PASSWORD;
const pat = env.SUPABASE_PAT || env.SUPABASE_ACCESS_TOKEN;
const ref = new URL(url).hostname.split(".")[0];

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};

/** Run SQL as the service owner, over the Management API. */
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return JSON.parse(text);
}

const sb = createClient(url, anon, { auth: { persistSession: false } });
const { data: auth, error: authError } = await sb.auth.signInWithPassword({ email, password });
if (authError) { console.error("could not sign in:", authError.message); process.exit(1); }
const userId = auth.user.id;
console.log(`signed in as ${email}`);

const orgs = await sql(`select o.id, o.plan from orgs o join org_members m on m.org_id = o.id where m.user_id = '${userId}'`);
const orgId = orgs[0].id;
console.log(`workspace ${orgId}, plan ${orgs[0].plan}`);

const made = [];
const meetingId = crypto.randomUUID();
const captureId = crypto.randomUUID();

async function tryWrites() {
  const m = await sb.from("meetings").insert({
    id: meetingId, org_id: orgId, owner_id: userId, title: "0009 gate check",
    status: "complete", visibility: "private", lang: "en", created_at: new Date().toISOString(),
  });
  const c = await sb.from("captures").insert({
    id: captureId, owner_id: userId, body: "0009 gate check", kind: "note",
    kind_source: "user", space_source: "user", entry: "typed",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  return { meeting: m.error, capture: c.error };
}

try {
  // ---- free: the cloud must refuse ----
  await sql(`update orgs set plan = 'free' where id = '${orgId}'`);
  const free = await tryWrites();
  ok("a free account cannot push a meeting", Boolean(free.meeting), "it was accepted");
  ok("a free account cannot push a capture", Boolean(free.capture), "it was accepted");
  ok("the refusal is a policy refusal, not a schema error",
    /row-level security|violates/i.test(free.meeting?.message ?? ""), free.meeting?.message);

  // Reading is deliberately untouched: cancelling must not strand a library.
  const { error: readError } = await sb.from("meetings").select("id").limit(1);
  ok("a free account can still read", !readError, readError?.message);
  const { error: capReadError } = await sb.from("captures").select("id").limit(1);
  ok("a free account can still read captures", !capReadError, capReadError?.message);

  // ---- paid: the same writes must go through ----
  await sql(`update orgs set plan = 'team' where id = '${orgId}'`);
  const paid = await tryWrites();
  ok("a paid account pushes a meeting", !paid.meeting, paid.meeting?.message);
  ok("a paid account pushes a capture", !paid.capture, paid.capture?.message);
  if (!paid.meeting) made.push(["meetings", meetingId]);
  if (!paid.capture) made.push(["captures", captureId]);

  // Child rows follow the meeting, and were the easiest thing to forget: the
  // old `for all` policies covered select as well as write.
  const { error: notesError } = await sb.from("meeting_notes").insert({
    meeting_id: meetingId, summary: ["x"], decisions: [], questions: [], markdown: "x", word_count: 1,
  });
  ok("a paid account writes meeting notes", !notesError, notesError?.message);
  const { error: taskError } = await sb.from("action_items").insert({
    org_id: orgId, meeting_id: meetingId, title: "0009 gate check", status: "open",
  });
  ok("a paid account writes an action item", !taskError, taskError?.message);

  // Updating is gated separately from inserting, and a `using`-only gate would
  // have let this through.
  const { error: updateError } = await sb.from("meetings").update({ title: "renamed" }).eq("id", meetingId);
  ok("a paid account edits a meeting", !updateError, updateError?.message);

  // ---- back to free: the edit must stop, the delete must not ----
  await sql(`update orgs set plan = 'free' where id = '${orgId}'`);
  const { error: blockedEdit } = await sb.from("meetings").update({ title: "renamed again" }).eq("id", meetingId);
  const { data: after } = await sb.from("meetings").select("title").eq("id", meetingId).maybeSingle();
  ok("a downgraded account cannot edit what it uploaded",
    Boolean(blockedEdit) || after?.title === "renamed", after?.title);
  ok("a downgraded account can still see it", after !== null);

  const { error: deleteError } = await sb.from("meetings").delete().eq("id", meetingId);
  ok("a downgraded account can still delete its own rows", !deleteError, deleteError?.message);
  if (!deleteError) made.length = 0;
} finally {
  // Always leave the account and the database as they were found.
  //
  // Deleting by marker text rather than by the ids collected above: the first
  // run of this left two `action_items` rows behind, because deleting the
  // meeting does not cascade to them and the id list only tracked what the
  // happy path created. Anything this script writes carries the marker, so
  // sweeping on the marker cannot miss a row that an early failure created.
  const MARKER = "0009 gate check%";
  await sb.from("action_items").delete().like("title", MARKER);
  for (const [table, id] of made) await sb.from(table).delete().eq("id", id);
  await sb.from("meetings").delete().like("title", MARKER);
  await sb.from("captures").delete().like("body", MARKER);
  await sql(`update orgs set plan = '${orgs[0].plan}' where id = '${orgId}'`);
  // Counted with the owner's privileges, so a row RLS hid from the delete is
  // still counted here and reported rather than assumed gone.
  const left = await sql(`
    select (select count(*) from meetings     where title like '${MARKER}')
         + (select count(*) from captures     where body  like '${MARKER}')
         + (select count(*) from action_items where title like '${MARKER}') as n`);
  console.log(`plan restored to ${orgs[0].plan}; leftover rows: ${left[0].n}`);
  if (Number(left[0].n) > 0) console.error("WARNING: this run left rows behind.");
  await sb.auth.signOut();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
