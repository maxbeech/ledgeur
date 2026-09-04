// @ledgeur/core test suite — pure-logic checks. Run: pnpm --filter @ledgeur/core test
import { splitSentences, extractiveSummary, summarizeTranscript, notesToMarkdown } from "../src/notes/summarize.ts";
import { parseSuggestions } from "../src/notes/suggest.ts";
import { buildNotesRequest, providerById, AI_PROVIDERS } from "../src/notes/ai-notes.ts";
import { toMeetingNote, actionItemsFromNotes } from "../src/notes/map.ts";
import { resample, mergeToMono, rms, concatFloat32, mixFloat32, WHISPER_SAMPLE_RATE } from "../src/audio/pcm.ts";
import { markdownToNotionBlocks, chunkBlocks, buildNotionPage } from "../src/integrations/notion.ts";
import { chunkText, meetingChunks } from "../src/rag/chunk.ts";
import { eventsToday, nextUpcoming, eventsNeedingPrompt, formatEventsForContext } from "../src/calendar/schedule.ts";
import { runDiarizeTests } from "./diarize.mts";
import { runBrowserTests } from "./browser.mts";
import { runLibraryTests } from "./library.mts";
import { runAssembleTests } from "./assemble.mts";
import { runSyncTests } from "./sync.mts";
import { runFailureTests } from "./failures.mts";
import type { CalendarEvent } from "../src/domain/entities.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};

// --- summarize ---
const transcript =
  "Welcome everyone to the planning call. We decided to ship the new pricing page next week. " +
  "I'll write the copy by Friday. Sarah will handle the design. " +
  "Should we also update the docs? Let's follow up on the analytics integration. " +
  "The plan is to launch on the 30th. What about the mobile layout?";

const sentences = splitSentences(transcript);
ok("splitSentences finds multiple sentences", sentences.length >= 6, `got ${sentences.length}`);
ok("extractiveSummary respects max", extractiveSummary(sentences, 3).length === 3);
ok("extractiveSummary preserves order", (() => {
  const s = extractiveSummary(sentences, 3);
  const idx = s.map((x) => sentences.indexOf(x));
  return idx.every((v, i) => i === 0 || v > idx[i - 1]);
})());

const notes = summarizeTranscript(transcript);
ok("finds action items", notes.actionItems.some((a) => a.includes("Friday")), JSON.stringify(notes.actionItems));
ok("finds decisions", notes.decisions.some((d) => d.toLowerCase().includes("decided")), JSON.stringify(notes.decisions));
ok("finds questions", notes.questions.length >= 2, JSON.stringify(notes.questions));
ok("a question is NOT also an action item", !notes.actionItems.some((a) => a.endsWith("?")), JSON.stringify(notes.actionItems));
ok("wordCount > 0", notes.wordCount > 30);
ok("empty transcript is safe", (() => { const n = summarizeTranscript(""); return n.summary.length === 0 && n.wordCount === 0; })());

const md = notesToMarkdown("Planning call", "2026-06-14", notes, transcript);
ok("markdown has title", md.startsWith("# Planning call"));
ok("markdown has action items as checkboxes", md.includes("- [ ] "));
ok("markdown includes transcript", md.includes("## Transcript"));
ok("markdown omits manual notes when absent", !md.includes("## Your notes"));
const mdManual = notesToMarkdown("Planning call", "2026-06-14", notes, transcript, "Remember: Priya owns rollout.\nBudget cap £40k.");
ok("markdown includes manual notes verbatim", mdManual.includes("## Your notes") && mdManual.includes("Budget cap £40k."));
ok("manual notes come before action items", mdManual.indexOf("## Your notes") < mdManual.indexOf("## Action items"));

// --- suggestion parsing ---
ok("suggestions: JSON array", parseSuggestions('["Ask about the deadline.", "Confirm the owner.", "Push for a decision."]').length === 3);
ok("suggestions: JSON in prose", parseSuggestions('Sure! ["Ask about scope."] hope this helps').join() === "Ask about scope.");
ok("suggestions: bulleted fallback", (() => {
  const out = parseSuggestions("- Ask who owns the launch checklist.\n- Confirm the pricing decision.");
  return out.length === 2 && out[0].startsWith("Ask who");
})());
ok("suggestions: numbered fallback", parseSuggestions("1. Clarify the budget ceiling.\n2) Suggest a follow-up on hiring.").length === 2);
ok("suggestions: caps at three", parseSuggestions('["a suggestion one","b suggestion two","c suggestion three","d suggestion four"]').length === 3);
ok("suggestions: garbage throws", (() => { try { parseSuggestions("ok"); return false; } catch { return true; } })());

// --- notes -> domain mappers ---
const mn = toMeetingNote({
  meetingId: "m1", title: "Planning call", dateISO: "2026-06-14",
  notes, transcript, generator: "local", updatedAt: "2026-06-14T00:00:00Z",
});
ok("toMeetingNote carries meetingId", mn.meetingId === "m1");
ok("toMeetingNote builds markdown", mn.markdown.startsWith("# Planning call"));
ok("toMeetingNote preserves wordCount", mn.wordCount === notes.wordCount);
const ais = actionItemsFromNotes("m1", notes);
ok("actionItemsFromNotes count matches", ais.length === notes.actionItems.length);
ok("actionItemsFromNotes carries meetingId", ais.every((a) => a.meetingId === "m1"));

// --- audio ---
ok("resample identity when same rate", resample(new Float32Array([1, 2, 3]), 16000, 16000).length === 3);
ok("resample downsamples 32k->16k by ~half", (() => {
  const out = resample(new Float32Array(3200), 32000, WHISPER_SAMPLE_RATE);
  return Math.abs(out.length - 1600) <= 2;
})());
ok("resample empty is empty", resample(new Float32Array(0), 48000).length === 0);
ok("mergeToMono averages two channels", (() => {
  const m = mergeToMono([new Float32Array([0, 1]), new Float32Array([1, 1])]);
  return m[0] === 0.5 && m[1] === 1;
})());
ok("rms of zeros is 0", rms(new Float32Array([0, 0, 0])) === 0);
ok("concatFloat32 length sums", concatFloat32([new Float32Array(4), new Float32Array(6)]).length === 10);
ok("mixFloat32 sums sample-for-sample", (() => {
  const m = mixFloat32(new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4]));
  return Math.abs(m[0] - 0.4) < 1e-6 && Math.abs(m[1] - 0.6) < 1e-6;
})());
ok("mixFloat32 clamps to [-1, 1]", mixFloat32(new Float32Array([0.9]), new Float32Array([0.9]))[0] === 1);
ok("mixFloat32 pads the shorter buffer with zero rather than truncating", (() => {
  const m = mixFloat32(new Float32Array([0.5, 0.5, 0.5]), new Float32Array([0.1]));
  return m.length === 3 && Math.abs(m[1] - 0.5) < 1e-6;
})());
ok("mixFloat32 of an empty buffer returns the other one untouched", mixFloat32(new Float32Array(0), new Float32Array([1, 2, 3])).length === 3);

// --- ai-notes ---
const req = buildNotesRequest("gpt-4o-mini", "hello world");
ok("request has model", req.model === "gpt-4o-mini");
ok("request has system + user", req.messages.length === 2 && req.messages[0].role === "system");
ok("request truncates long transcript", buildNotesRequest("m", "x".repeat(60000)).messages[1].content.includes("(truncated)"));
ok("providerById falls back", providerById("nope").id === AI_PROVIDERS[0].id);
ok("local provider is first (zero-setup default)", AI_PROVIDERS[0].id === "local");

// --- notion export ---
const nb = markdownToNotionBlocks("# Title\n\n## Summary\n\n- point one\n- [ ] do a thing\n- [x] done thing\n\nA paragraph.");
ok("notion: heading_1 for #", nb.some((b) => b.type === "heading_1"));
ok("notion: heading_2 for ##", nb.some((b) => b.type === "heading_2"));
ok("notion: bulleted item", nb.some((b) => b.type === "bulleted_list_item"));
ok("notion: unchecked to_do", nb.some((b) => b.type === "to_do" && (b.to_do as { checked: boolean }).checked === false));
ok("notion: checked to_do", nb.some((b) => b.type === "to_do" && (b.to_do as { checked: boolean }).checked === true));
ok("notion: paragraph", nb.some((b) => b.type === "paragraph"));
ok("notion: no empty blocks from blank lines", nb.every((b) => b.type !== undefined) && nb.length === 6);
ok("notion: chunkBlocks splits at 100", chunkBlocks(Array.from({ length: 250 }, () => nb[0])).length === 3);
ok("notion: buildNotionPage uses database parent", (() => {
  const p = buildNotionPage({ databaseId: "db1" }, "T", nb) as { parent: { database_id: string } };
  return p.parent.database_id === "db1";
})());
ok("notion: buildNotionPage requires a target", (() => {
  try { buildNotionPage({}, "T", nb); return false; } catch { return true; }
})());

// --- rag chunking ---
ok("chunkText empty is empty", chunkText("").length === 0);
ok("chunkText short is one chunk", chunkText("a b c", 180, 30).length === 1);
ok("chunkText long splits with overlap", (() => {
  const words = Array.from({ length: 500 }, (_, i) => `w${i}`).join(" ");
  const cs = chunkText(words, 180, 30);
  return cs.length >= 3 && cs.every((c) => c.text.split(" ").length <= 180) && cs[0].index === 0;
})());
ok("chunkText covers the end", (() => {
  const words = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
  const cs = chunkText(words, 180, 30);
  return cs[cs.length - 1].text.includes("w399");
})());
ok("chunkText indices are sequential", (() => {
  const cs = chunkText(Array.from({ length: 400 }, (_, i) => `w${i}`).join(" "));
  return cs.every((c, i) => c.index === i);
})());
ok("meetingChunks combines fields", meetingChunks({ title: "T", summary: ["s one"], transcript: "hello world" }).length >= 1);

// --- calendar scheduling ---
const now = new Date("2026-07-01T09:00:00Z");
const ev = (id: string, offsetMin: number, durMin = 30): CalendarEvent => ({
  id, provider: "google", title: `Meeting ${id}`,
  startsAt: new Date(now.getTime() + offsetMin * 60000).toISOString(),
  endsAt: new Date(now.getTime() + (offsetMin + durMin) * 60000).toISOString(),
  isOnline: true, meetingUrl: null,
});
const evs = [ev("a", 5), ev("b", 120), ev("c", -120)];
ok("nextUpcoming picks soonest future", nextUpcoming(evs, now)?.id === "a");
ok("eventsToday returns same-day sorted", eventsToday(evs, now).length >= 1);
ok("eventsNeedingPrompt within lead window", eventsNeedingPrompt(evs, now, 10 * 60000, new Set()).map((e) => e.id).join() === "a");
ok("eventsNeedingPrompt skips already-prompted", eventsNeedingPrompt(evs, now, 10 * 60000, new Set(["a"])).length === 0);
ok("eventsNeedingPrompt skips far-future", !eventsNeedingPrompt(evs, now, 10 * 60000, new Set()).some((e) => e.id === "b"));
ok("formatEventsForContext lists every event's title", formatEventsForContext(evs).split("\n").length === evs.length);
ok("formatEventsForContext marks online events", formatEventsForContext([ev("a", 5)]).includes("(online)"));
ok("formatEventsForContext is empty for no events", formatEventsForContext([]) === "");

// --- diarization ---
runDiarizeTests(ok);

// --- diarization assembly ---
runAssembleTests(ok);

// --- meeting library ---
runLibraryTests(ok);

// --- cloud sync mapping ---
runSyncTests(ok);

// --- browser controllers (fake Worker) ---
await runBrowserTests(ok);

// --- failure paths found by driving the product in a browser ---
await runFailureTests(ok);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
