// Desktop app pure-logic tests. Run: pnpm --filter @ledgeur/desktop test
// Only import modules free of browser-only globals (no import.meta.env, DOM).
import { mergeThread, quoteOf, messageToItem, type ThreadItem } from "../src/lib/thread.ts";
import { parseAiNotes } from "../src/lib/notes.ts";
import type { LocalSegment, ChatMessage } from "../src/lib/meetingsStore.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};

// --- mergeThread ---
const seg = (id: string, startMs: number, text: string): LocalSegment => ({
  id, speakerLabel: "Speaker 1", startMs, endMs: startMs + 500, text, confidence: 0.9,
});
const msg = (id: string, role: ChatMessage["role"], atMs: number, text: string): ChatMessage => ({ id, role, atMs, text });

const segs = [seg("s1", 0, "hello"), seg("s2", 2000, "world")];
const msgs = [msg("m1", "user", 1000, "who said that?"), msg("m2", "assistant", 1500, "you did")];
const merged = mergeThread(segs, msgs);
ok("mergeThread orders by time", merged.map((i) => i.id).join(",") === "s1,m1,m2,s2", merged.map((i) => i.id).join(","));
ok("mergeThread keeps transcript kind", merged[0].kind === "transcript");
ok("mergeThread maps message role to kind", merged[1].kind === "user" && merged[2].kind === "assistant");
ok("ties keep transcript before message", (() => {
  const m = mergeThread([seg("s", 1000, "x")], [msg("m", "user", 1000, "y")]);
  return m[0].id === "s" && m[1].id === "m";
})());
ok("empty inputs → empty thread", mergeThread([], []).length === 0);

// --- quoteOf / messageToItem ---
const t: ThreadItem = merged[0];
ok("quoteOf transcript uses speaker label", quoteOf(t).label === "Speaker 1");
ok("quoteOf user is You", quoteOf({ kind: "user", id: "u", atMs: 0, text: "hi" }).label === "You");
ok("quoteOf suggestion is Suggestion", quoteOf({ kind: "suggestion", id: "s", atMs: 0, text: "try this" }).label === "Suggestion");
ok("messageToItem preserves quote", (() => {
  const item = messageToItem({ id: "m", role: "user", atMs: 5, text: "hey", quote: { text: "q", label: "You" } });
  return item.kind === "user" && item.quote?.text === "q" && item.atMs === 5;
})());

// --- parseAiNotes ---
const good = JSON.stringify({
  summary: ["Shipped pricing page", "Copy due Friday"],
  actionItems: ["Max — write copy by Friday", ""],
  decisions: ["Ship next week"],
  questions: ["Update the docs?"],
});
const parsed = parseAiNotes(`Here are the notes:\n${good}\nDone.`, "one two three four");
ok("parseAiNotes extracts summary", parsed.summary.length === 2);
ok("parseAiNotes drops empty strings", parsed.actionItems.length === 1 && parsed.actionItems[0].startsWith("Max"));
ok("parseAiNotes counts words from transcript", parsed.wordCount === 4);
ok("parseAiNotes throws on non-JSON", (() => { try { parseAiNotes("no json here", "x"); return false; } catch { return true; } })());
ok("parseAiNotes throws on empty summary", (() => {
  try { parseAiNotes(JSON.stringify({ summary: [] }), "x"); return false; } catch { return true; }
})());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
