// Grounding: tokens, block packing, transcript windowing, and the two prompt
// framings. These decide what a question is allowed to see, so a regression
// here is a wrong answer rather than a crash — which is exactly why they are
// pure functions with tests.

import { STOPWORDS, tokenize, contentTokens, relevance, documentFrequency } from "../src/text/tokens.ts";
import { packContext, renderContext, type ContextBlock } from "../src/context/blocks.ts";
import {
  formatTranscriptLine, formatTranscript, selectTranscriptContext, speakerRoster,
  type TranscriptLine,
} from "../src/context/transcript.ts";
import { buildGroundedPrompt } from "../src/context/prompt.ts";

export function runContextTests(ok: (name: string, cond: boolean, detail?: string) => void): void {
  // ── tokens ────────────────────────────────────────────────────────────────
  ok("tokenize keeps apostrophes together", tokenize("we'll ship it").join("|") === "we'll|ship|it");
  ok("contentTokens drops stopwords and short words", contentTokens("we will ship the pricing page").join("|") === "ship|pricing|page");
  ok("STOPWORDS covers speech filler", STOPWORDS.has("um") && STOPWORDS.has("basically") && STOPWORDS.has("yeah"));

  ok("relevance is 1 when every query term is present",
    relevance("pricing page", "the pricing page ships friday") === 1);
  ok("relevance is 0 with no overlap", relevance("pricing", "the weather is nice") === 0);
  ok("relevance is 0 for a query of only stopwords", relevance("what is the", "anything at all") === 0);
  ok("relevance partial credit", (() => {
    const r = relevance("pricing rollout", "the pricing page");
    return r > 0.4 && r < 0.6;
  })());

  // A term in every candidate should decide less than a term in one of them.
  ok("relevance weights rare terms above common ones", (() => {
    const corpus = ["meeting about pricing", "meeting about hiring", "meeting about roadmap"];
    const df = documentFrequency(corpus);
    const rare = relevance("meeting pricing", corpus[0], df, corpus.length);
    const common = relevance("meeting hiring", corpus[0], df, corpus.length);
    // "pricing" is rare (1 of 3) and present; "hiring" is equally rare but
    // absent — so the first must score higher on the same document.
    return rare > common;
  })());
  ok("documentFrequency counts documents not occurrences",
    documentFrequency(["pricing pricing pricing", "pricing page"]).get("pricing") === 2);

  // ── packing ───────────────────────────────────────────────────────────────
  const blocks: ContextBlock[] = [
    { source: "Live transcript", text: "totally unrelated chatter about lunch", pinned: true },
    { source: "Contextely: Pricing policy", text: "enterprise pricing starts at 40k" },
    { source: "Notion: Office plants", text: "the ficus needs watering" },
  ];
  ok("packContext keeps everything under budget", packContext("pricing", blocks, 10_000).blocks.length === 3);
  ok("packContext keeps a pinned block even when irrelevant", (() => {
    const packed = packContext("pricing", blocks, 90);
    return packed.blocks.some((b) => b.source === "Live transcript");
  })());
  // 130 chars is room for the pinned block plus exactly one more: the packer
  // has to choose, and it must choose on relevance rather than on input order
  // (the irrelevant Notion block is both shorter and later).
  ok("packContext prefers the relevant block over the irrelevant one", (() => {
    const packed = packContext("pricing", blocks, 130);
    return packed.blocks.length === 2
      && packed.blocks.some((b) => b.source.includes("Pricing"))
      && packed.dropped.includes("Notion: Office plants");
  })());
  ok("packContext reports what it dropped", packContext("pricing", blocks, 90).dropped.length > 0);
  ok("packContext preserves caller order in the output", (() => {
    const packed = packContext("pricing", blocks, 10_000);
    return packed.blocks[0].source === "Live transcript" && packed.blocks[2].source === "Notion: Office plants";
  })());
  ok("packContext truncates rather than returning nothing", (() => {
    const packed = packContext("x", [{ source: "S", text: "y".repeat(500) }], 100);
    return packed.blocks.length === 1 && packed.blocks[0].text.includes("truncated");
  })());
  ok("packContext ignores empty blocks", packContext("x", [{ source: "S", text: "  " }], 999).blocks.length === 0);
  ok("renderContext names every source", renderContext(blocks).includes("### Contextely: Pricing policy"));
  ok("renderContext is explicit when empty", renderContext([]) === "(no context available)");

  // ── transcript ────────────────────────────────────────────────────────────
  const line = (speakerLabel: string, sec: number, text: string): TranscriptLine =>
    ({ speakerLabel, startMs: sec * 1000, text });

  ok("formatTranscriptLine carries speaker and time",
    formatTranscriptLine(line("Sarah", 64, "we should ship")) === "[01:04] Sarah: we should ship");
  ok("formatTranscript joins with newlines",
    formatTranscript([line("A", 0, "one"), line("B", 1, "two")]) === "[00:00] A: one\n[00:01] B: two");

  const short = [line("Sarah", 0, "let's talk pricing"), line("Ravi", 5, "forty thousand for enterprise")];
  const shortCtx = selectTranscriptContext(short, "pricing");
  ok("a short transcript is not elided", !shortCtx.elided && shortCtx.includedLines === 2);
  ok("a short transcript includes every line", shortCtx.text.includes("forty thousand"));

  ok("an empty transcript is empty, not an error", (() => {
    const c = selectTranscriptContext([], "anything");
    return c.text === "" && c.totalLines === 0 && !c.elided;
  })());

  // A long meeting: one relevant exchange near the start, filler in the middle,
  // and a distinct ending. The tail must survive and the relevant early bit
  // must be retrieved.
  const long: TranscriptLine[] = [];
  long.push(line("Sarah", 0, "the enterprise pricing tier is going to be forty thousand a year"));
  long.push(line("Ravi", 6, "and that includes the onboarding package we discussed"));
  for (let i = 0; i < 400; i++) {
    long.push(line(i % 2 ? "Sarah" : "Ravi", 12 + i * 5, "we talked about the weather and the office move at some length"));
  }
  long.push(line("Sarah", 3000, "so to close out, who is writing the summary"));
  long.push(line("Ravi", 3006, "I will send it round tomorrow morning"));

  const longCtx = selectTranscriptContext(long, "what did we say about enterprise pricing", { budget: 2000 });
  ok("a long transcript is elided", longCtx.elided);
  ok("elision is stated in the text", longCtx.text.includes("not shown"));
  ok("the recent tail always survives", longCtx.text.includes("send it round tomorrow morning"));
  ok("the relevant early passage is retrieved", longCtx.text.includes("forty thousand a year"),
    longCtx.text.slice(0, 200));
  ok("the window stays inside its budget", longCtx.text.length <= 2400, `${longCtx.text.length}`);
  ok("included is fewer than total", longCtx.includedLines < longCtx.totalLines);

  // With no lexical hook at all, the tail is still the answer.
  const vague = selectTranscriptContext(long, "what did I miss", { budget: 2000 });
  ok("a question with no keywords still gets the recent tail", vague.text.includes("who is writing the summary"));

  ok("speakerRoster counts words per speaker", (() => {
    const roster = speakerRoster([line("Sarah", 0, "one two three"), line("Ravi", 4, "four")]);
    return roster.includes("Sarah: 3 words") && roster.includes("Ravi: 1 words");
  })());
  ok("speakerRoster is empty for an empty transcript", speakerRoster([]) === "");

  // ── prompt ────────────────────────────────────────────────────────────────
  const meeting = buildGroundedPrompt("what did we decide", blocks, { mode: "meeting", situation: "You are in a meeting titled \"Q3 planning\"." });
  ok("meeting mode frames the answer as live", meeting.messages[0].content.includes("happening"));
  ok("meeting mode distinguishes 'not discussed' from 'unknown'",
    meeting.messages[0].content.includes("not been discussed"));
  ok("meeting mode warns about speech-to-text errors", meeting.messages[0].content.includes("mishearings"));
  ok("the situation leads the user turn", meeting.messages[1].content.startsWith("You are in a meeting"));
  ok("the question is in the user turn", meeting.messages[1].content.includes("Question: what did we decide"));
  ok("used blocks are reported for provenance", meeting.used.length === 3);

  const library = buildGroundedPrompt("what did we decide", blocks);
  ok("library mode is the default", library.messages[0].content.includes("meeting record"));
  ok("both modes forbid inventing", (() => {
    const forbids = (s: string) => s.includes("Never invent");
    return forbids(library.messages[0].content) && forbids(meeting.messages[0].content);
  })());
  ok("both modes require citing the source", (() => {
    const cites = (s: string) => s.includes("Cite the source name");
    return cites(library.messages[0].content) && cites(meeting.messages[0].content);
  })());
  ok("a dropped source is reported by the prompt builder",
    buildGroundedPrompt("pricing", blocks, { budget: 90 }).dropped.length > 0);
  ok("no context still builds a valid prompt", (() => {
    const p = buildGroundedPrompt("anything", []);
    return p.messages.length === 2 && p.messages[1].content.includes("(no context available)");
  })());
}
