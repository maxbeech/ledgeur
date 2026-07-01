// ParleyNotes test suite. Pure-logic + data-integrity checks. Run: npm test
import { splitSentences, extractiveSummary, summarizeTranscript, notesToMarkdown } from "../lib/summarize.ts";
import { resample, mergeToMono, rms, concatFloat32, WHISPER_SAMPLE_RATE } from "../lib/audio.ts";
import { buildNotesRequest, providerById, AI_PROVIDERS } from "../lib/ai-notes.ts";
import { evaluateSupport } from "../lib/support.ts";
import { COMPETITORS } from "../lib/competitors.ts";
import { PLATFORMS } from "../lib/platforms.ts";
import { USE_CASES } from "../lib/usecases.ts";
import { POSTS } from "../lib/posts.ts";

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
ok("a question is NOT also listed as an action item", !notes.actionItems.some((a) => a.endsWith("?")), JSON.stringify(notes.actionItems));
ok("wordCount > 0", notes.wordCount > 30);
ok("empty transcript is safe", (() => { const n = summarizeTranscript(""); return n.summary.length === 0 && n.wordCount === 0; })());

const md = notesToMarkdown("Planning call", "2026-06-14", notes, transcript);
ok("markdown has title", md.startsWith("# Planning call"));
ok("markdown has action items as checkboxes", md.includes("- [ ] "));
ok("markdown includes transcript", md.includes("## Transcript"));

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
ok("mergeToMono single passthrough", mergeToMono([new Float32Array([0.5])])[0] === 0.5);
ok("rms of zeros is 0", rms(new Float32Array([0, 0, 0])) === 0);
ok("rms of constant equals magnitude", Math.abs(rms(new Float32Array([0.5, 0.5])) - 0.5) < 1e-9);
ok("concatFloat32 length sums", concatFloat32([new Float32Array(4), new Float32Array(6)]).length === 10);

// --- ai-notes ---
const req = buildNotesRequest("gpt-4o-mini", "hello world");
ok("request has model", req.model === "gpt-4o-mini");
ok("request has system + user", req.messages.length === 2 && req.messages[0].role === "system");
ok("request truncates long transcript", (() => {
  const big = "x".repeat(60000);
  return buildNotesRequest("m", big).messages[1].content.includes("(truncated)");
})());
ok("providerById falls back", providerById("nope").id === AI_PROVIDERS[0].id);
ok("every provider has baseUrl + model", AI_PROVIDERS.every((p) => p.baseUrl.startsWith("https://") && !!p.defaultModel));

// --- browser support detection ---
const full = evaluateSupport({ getDisplayMedia: true, getUserMedia: true, audioContext: true, worker: true });
ok("full support → all modes, no warning", full.canRecordMeeting && full.canRecordMic && full.canTranscribeFile && full.warning === "");
const noTab = evaluateSupport({ getDisplayMedia: false, getUserMedia: true, audioContext: true, worker: true });
ok("no getDisplayMedia → meeting off, mic+file on, warning shown", !noTab.canRecordMeeting && noTab.canRecordMic && noTab.canTranscribeFile && noTab.warning.length > 0);
const noEngine = evaluateSupport({ getDisplayMedia: true, getUserMedia: true, audioContext: false, worker: true });
ok("no AudioContext → nothing works, clear warning", !noEngine.canTranscribeFile && !noEngine.canRecordMic && !noEngine.canRecordMeeting && noEngine.warning.length > 0);

// --- data integrity ---
const uniq = (arr: string[]) => new Set(arr).size === arr.length;
ok("competitor slugs unique", uniq(COMPETITORS.map((c) => c.slug)));
ok("platform slugs unique", uniq(PLATFORMS.map((p) => p.slug)));
ok("usecase slugs unique", uniq(USE_CASES.map((u) => u.slug)));
ok("post slugs unique", uniq(POSTS.map((p) => p.slug)));
ok("at least 15 blog posts (Stage 4)", POSTS.length >= 15, `got ${POSTS.length}`);
ok("competitors populated", COMPETITORS.length >= 10 && COMPETITORS.every((c) => c.diff.length >= 3 && c.what.length > 10));
ok("platforms populated", PLATFORMS.length >= 6 && PLATFORMS.every((p) => p.tips.length >= 3));
ok("usecases populated", USE_CASES.length >= 8 && USE_CASES.every((u) => u.captures.length >= 3));
ok("posts well-formed", POSTS.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.body.length >= 4 && p.title.length > 5));
ok("slugs are url-safe", [...COMPETITORS, ...PLATFORMS].every((x) => /^[a-z0-9-]+$/.test(x.slug)) && POSTS.every((p) => /^[a-z0-9-]+$/.test(p.slug)));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
