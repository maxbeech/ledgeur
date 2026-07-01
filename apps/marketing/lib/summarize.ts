// Local, offline notes generator. Pure functions over the REAL transcript text —
// no LLM, no network, no fabrication. Used as the free fallback when the user
// has not supplied their own AI key. Deterministic, so it is unit-tested.

export interface MeetingNotes {
  summary: string[];
  actionItems: string[];
  decisions: string[];
  questions: string[];
  wordCount: number;
}

const STOPWORDS = new Set(
  ("a an the and or but so to of in on at for with as is are was were be been being " +
    "i you he she it we they me him her us them my your our their this that these those " +
    "do does did have has had will would can could should may might must just like yeah " +
    "okay ok um uh kind sort really very actually basically gonna wanna got get gets " +
    "about into over than then there here what which who whom how when where why not no yes " +
    "if because while from by up down out off again once also too more most some any all")
    .split(" "),
);

/** Split free-form transcript text into trimmed sentences. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/** Word-frequency (TF) extractive summary: highest-information sentences, kept
 *  in their original order so the summary reads naturally. */
export function extractiveSummary(sentences: string[], max: number): string[] {
  if (sentences.length <= max) return sentences.slice();
  const freq = new Map<string, number>();
  for (const s of sentences) {
    for (const w of tokenize(s)) {
      if (STOPWORDS.has(w) || w.length < 3) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  const scored = sentences.map((s, i) => {
    const words = tokenize(s).filter((w) => !STOPWORDS.has(w) && w.length >= 3);
    const raw = words.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0);
    // Length-normalise so we don't always pick the longest rambling sentence,
    // but penalise very short fragments.
    const score = words.length === 0 ? 0 : raw / Math.sqrt(words.length);
    return { i, s, score };
  });
  const top = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .sort((a, b) => a.i - b.i);
  return top.map((t) => t.s);
}

const ACTION_CUES = [
  "i'll", "i will", "we'll", "we will", "let's", "lets ", "need to", "needs to",
  "have to", "going to", "follow up", "follow-up", "next step", "action item",
  "to do", "todo", "assign", "by monday", "by tuesday", "by wednesday",
  "by thursday", "by friday", "by tomorrow", "by next", "deadline", "owner",
  "make sure", "should ", "send the", "send over", "circle back", "take care of",
];

const DECISION_CUES = [
  "we decided", "decided to", "we agreed", "agreed to", "let's go with",
  "we'll go with", "final decision", "approved", "sign off", "signed off",
  "conclusion", "the plan is", "we're going with", "consensus",
];

function matchesAny(sentence: string, cues: string[]): boolean {
  const low = ` ${sentence.toLowerCase()} `;
  return cues.some((c) => low.includes(c));
}

function dedupe(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const key = it.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

/** Build structured notes from a raw transcript using only local heuristics. */
export function summarizeTranscript(transcript: string): MeetingNotes {
  const sentences = splitSentences(transcript);
  const wordCount = (transcript.match(/[a-z0-9']+/gi) ?? []).length;
  const summaryCount = Math.max(3, Math.min(7, Math.round(sentences.length / 8)));
  // A question ("Should we…?") is an open question, not an action item, even
  // though it may contain an action cue word — classify it as a question only.
  return {
    summary: extractiveSummary(sentences, summaryCount),
    actionItems: dedupe(sentences.filter((s) => !s.endsWith("?") && matchesAny(s, ACTION_CUES)), 12),
    decisions: dedupe(sentences.filter((s) => !s.endsWith("?") && matchesAny(s, DECISION_CUES)), 8),
    questions: dedupe(sentences.filter((s) => s.endsWith("?")), 10),
    wordCount,
  };
}

/** Render notes + transcript to Markdown for export. Single source of truth for
 *  the export format, shared by the UI and tests. */
export function notesToMarkdown(
  title: string,
  dateISO: string,
  notes: MeetingNotes,
  transcript: string,
): string {
  const section = (h: string, items: string[], bullet = "- ") =>
    items.length ? `\n## ${h}\n\n${items.map((i) => bullet + i).join("\n")}\n` : "";
  return (
    `# ${title}\n\n_${dateISO} · ${notes.wordCount} words_\n` +
    section("Summary", notes.summary) +
    section("Action items", notes.actionItems, "- [ ] ") +
    section("Decisions", notes.decisions) +
    section("Open questions", notes.questions) +
    `\n## Transcript\n\n${transcript.trim()}\n`
  );
}
