// Turning a live transcript into something a model can answer questions from.
//
// ── Why this is not just `segments.map(s => s.text).join(" ")` ───────────────
// That is what the in-meeting copilot used to send, and it fails three ways:
//
//   1. No speakers. "What did Sarah commit to?" is unanswerable from a wall of
//      undifferentiated text, and the model will happily attribute a line to
//      whoever was named most recently.
//   2. No time. "What did we just decide?" needs to know which end is recent.
//   3. No budget discipline. An hour of speech is ~60k characters; the prompt
//      builder clipped it with `.slice(0, 48000)`, which drops the END — the
//      most recent, most relevant part — and does so silently.
//
// So: label every line with its speaker and timestamp, always keep the recent
// tail intact, and spend whatever budget is left on the earlier passages that
// actually bear on the question, marking every elision so the model can see it
// was not given the whole meeting.

import { documentFrequency, relevance } from "../text/tokens.ts";

/** The minimum a transcript line has to be renderable — matches the desktop
 *  app's LocalSegment and the repository's segment rows, so both pass through
 *  without a mapping step. */
export interface TranscriptLine {
  speakerLabel: string;
  startMs: number;
  text: string;
}

export interface TranscriptContextOptions {
  /** Characters the rendered transcript may occupy. */
  budget?: number;
  /**
   * Share of the budget reserved for the most recent lines, 0..1.
   *
   * High on purpose. Mid-meeting questions are overwhelmingly about the last
   * few minutes ("what did he just say", "summarise where we've got to"), and
   * relevance scoring cannot recognise that — those questions share almost no
   * vocabulary with the lines that answer them.
   */
  recentShare?: number;
  /** Lines per window when scoring earlier material, so a retrieved passage
   *  keeps its surrounding exchange rather than arriving as one orphan line. */
  windowLines?: number;
}

const DEFAULTS = {
  budget: 12_000,
  recentShare: 0.6,
  windowLines: 6,
} as const;

const mmss = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** One line as the model sees it: `[12:04] Sarah: we should ship on Friday`. */
export function formatTranscriptLine(line: TranscriptLine): string {
  return `[${mmss(line.startMs)}] ${line.speakerLabel}: ${line.text.trim()}`;
}

/** Plain speaker-labelled transcript, no selection — for exports and notes. */
export function formatTranscript(lines: readonly TranscriptLine[]): string {
  return lines.map(formatTranscriptLine).join("\n");
}

export interface TranscriptContext {
  text: string;
  /** True when anything was left out — the caller says so rather than
   *  pretending the model saw the whole meeting. */
  elided: boolean;
  /** Lines actually included. */
  includedLines: number;
  totalLines: number;
}

/**
 * The transcript as context for one specific question.
 *
 * Recent lines first-class, earlier ones retrieved by relevance in whole
 * windows, chronological order preserved, elisions marked with `…`.
 */
export function selectTranscriptContext(
  lines: readonly TranscriptLine[],
  question: string,
  options: TranscriptContextOptions = {},
): TranscriptContext {
  const { budget, recentShare, windowLines } = { ...DEFAULTS, ...options };
  const rendered = lines.map(formatTranscriptLine);
  const total = rendered.reduce((n, l) => n + l.length + 1, 0);

  if (lines.length === 0) {
    return { text: "", elided: false, includedLines: 0, totalLines: 0 };
  }
  if (total <= budget) {
    return { text: rendered.join("\n"), elided: false, includedLines: lines.length, totalLines: lines.length };
  }

  // 1. The tail, taken backwards until the reserved share is full.
  const tailBudget = Math.round(budget * recentShare);
  const keep = new Set<number>();
  let used = 0;
  for (let i = rendered.length - 1; i >= 0; i--) {
    const cost = rendered[i].length + 1;
    if (used + cost > tailBudget && keep.size > 0) break;
    keep.add(i);
    used += cost;
  }

  // 2. Whatever is left goes to the earlier windows that bear on the question,
  //    highest-scoring first. Windows are scored against the whole corpus so a
  //    term common to the entire meeting doesn't decide the retrieval.
  const earliest = Math.min(...keep);
  const windows: { start: number; end: number; text: string }[] = [];
  for (let start = 0; start < earliest; start += windowLines) {
    const end = Math.min(start + windowLines, earliest);
    windows.push({ start, end, text: rendered.slice(start, end).join("\n") });
  }
  const df = documentFrequency(windows.map((w) => w.text));
  const ranked = windows
    .map((w, i) => ({ ...w, i, score: relevance(question, w.text, df, windows.length) }))
    .filter((w) => w.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : b.i - a.i));

  for (const w of ranked) {
    const cost = w.text.length + 1;
    if (used + cost > budget) continue;
    for (let i = w.start; i < w.end; i++) keep.add(i);
    used += cost;
  }

  // 3. Emit in order, marking every gap.
  const indices = [...keep].sort((a, b) => a - b);
  const out: string[] = [];
  let previous = -1;
  for (const i of indices) {
    if (previous >= 0 && i > previous + 1) out.push(`… (${i - previous - 1} lines not shown)`);
    else if (previous < 0 && i > 0) out.push(`… (${i} earlier lines not shown)`);
    out.push(rendered[i]);
    previous = i;
  }
  return { text: out.join("\n"), elided: true, includedLines: indices.length, totalLines: lines.length };
}

/** Who has spoken and for how long — so the copilot can answer "who is in this
 *  meeting?" from the record rather than from the words themselves. */
export function speakerRoster(lines: readonly TranscriptLine[]): string {
  const seconds = new Map<string, number>();
  const words = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    const span = next ? Math.max(0, next.startMs - line.startMs) : 0;
    seconds.set(line.speakerLabel, (seconds.get(line.speakerLabel) ?? 0) + span / 1000);
    words.set(line.speakerLabel, (words.get(line.speakerLabel) ?? 0) + (line.text.trim().split(/\s+/).filter(Boolean).length));
  }
  return [...words.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, w]) => `${label}: ${w} words spoken${seconds.get(label) ? `, about ${Math.round(seconds.get(label)!)}s of the meeting` : ""}`)
    .join("\n");
}
