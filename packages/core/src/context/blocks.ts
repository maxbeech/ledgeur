// Context blocks — the unit of grounding for every question Ledgeur answers.
//
// A block is a named piece of real evidence ("Live transcript", "Contextely:
// Pricing policy", "Meeting: Q3 planning"). The model is told to answer from
// blocks and cite the source name, so the block list *is* the provenance: the
// UI can show exactly what a given answer was allowed to see.
//
// This lives in core rather than in the desktop app because both the in-meeting
// copilot and the app-wide Ask build the same structure, and they must pack,
// rank and render it identically — otherwise "why did it answer that?" has two
// different answers depending on which input box you used.

import { documentFrequency, relevance } from "../text/tokens.ts";

export interface ContextBlock {
  /** Human-readable origin, e.g. "Live transcript" or "Notion: Roadmap". */
  source: string;
  text: string;
  /**
   * Never dropped when packing, however irrelevant it scores.
   *
   * The live transcript is pinned: a question asked inside a meeting is almost
   * always *about* that meeting, and lexical overlap is a bad judge of that
   * ("what did I miss?" shares no words with anything).
   */
  pinned?: boolean;
}

export interface PackedContext {
  blocks: ContextBlock[];
  /** Source names that were dropped to fit the budget — shown, not hidden. */
  dropped: string[];
  /** Total characters of block text kept. */
  chars: number;
}

const DEFAULT_BUDGET = 24_000;

/**
 * Choose the blocks that fit a character budget, best first.
 *
 * Truncating one concatenated string — which is what every call site did before
 * — silently cut whichever source happened to sort last, usually the local
 * meetings appended at the end. Packing whole blocks instead means a source is
 * either present and complete or reported as dropped, and `dropped` gives the
 * UI something honest to say.
 *
 * Pinned blocks are kept first and in order, then the rest by relevance to the
 * question. A block longer than the remaining budget is skipped rather than cut
 * in half, unless nothing has been kept yet — a lone oversized block is clipped
 * with an explicit marker, because no context at all is worse.
 */
export function packContext(
  question: string,
  blocks: readonly ContextBlock[],
  budget = DEFAULT_BUDGET,
): PackedContext {
  const usable = blocks.filter((b) => b.text.trim().length > 0);
  const df = documentFrequency(usable.map((b) => b.text));
  const scored = usable.map((b, i) => ({
    block: b,
    i,
    score: b.pinned ? Infinity : relevance(question, `${b.source}\n${b.text}`, df, usable.length),
  }));
  // Ties keep the caller's order, which is meaningful: gatherers list their
  // sources most-authoritative first.
  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.i - b.i));

  const kept: { block: ContextBlock; i: number }[] = [];
  const dropped: string[] = [];
  let chars = 0;
  for (const { block, i } of scored) {
    const cost = block.text.length + block.source.length + 8;
    if (chars + cost <= budget) {
      kept.push({ block, i });
      chars += cost;
      continue;
    }
    if (kept.length === 0) {
      const room = Math.max(0, budget - block.source.length - 8);
      kept.push({ block: { ...block, text: `${block.text.slice(0, room)}\n…(truncated to fit)` }, i });
      chars = budget;
      continue;
    }
    dropped.push(block.source);
  }
  // Restore the caller's order so the rendered prompt reads consistently.
  kept.sort((a, b) => a.i - b.i);
  return { blocks: kept.map((k) => k.block), dropped, chars };
}

/** The blocks as prompt text. One rendering, shared by every caller. */
export function renderContext(blocks: readonly ContextBlock[]): string {
  if (blocks.length === 0) return "(no context available)";
  return blocks.map((b) => `### ${b.source}\n${b.text}`).join("\n\n");
}
