// Merge the transcript (spoken segments) and the copilot thread (answers, the
// user's questions, proactive suggestions) into one time-ordered conversation.
// Pure + unit-tested so the ordering can't silently regress.

import type { LocalSegment, ChatMessage, ChatQuote } from "./meetingsStore.ts";

export type ThreadItem =
  | {
      kind: "transcript";
      id: string;
      atMs: number;
      text: string;
      speakerLabel: string;
      confidence: number | null;
      speakerConfidence: number | null;
    }
  | {
      kind: "user" | "assistant" | "suggestion" | "error";
      id: string;
      atMs: number;
      text: string;
      quote?: ChatQuote;
    };

/** Time-ordered stream of transcript lines + copilot messages. Ties keep
 *  transcript before messages, then original insertion order (stable). */
export function mergeThread(segments: LocalSegment[], messages: ChatMessage[]): ThreadItem[] {
  const items: (ThreadItem & { _o: number })[] = [];
  segments.forEach((s, i) =>
    items.push({
      kind: "transcript",
      id: s.id,
      atMs: s.startMs,
      text: s.text,
      speakerLabel: s.speakerLabel,
      confidence: s.confidence,
      speakerConfidence: s.speakerConfidence ?? null,
      _o: i,
    }),
  );
  messages.forEach((m, i) =>
    items.push({ kind: m.role, id: m.id, atMs: m.atMs, text: m.text, quote: m.quote, _o: 1e6 + i }),
  );
  items.sort((a, b) => (a.atMs !== b.atMs ? a.atMs - b.atMs : a._o - b._o));
  return items.map(({ _o, ...rest }) => rest);
}

/** A standalone chat message (no transcript) as a thread item — for the
 *  app-level copilot view, which has messages but no spoken segments. */
export function messageToItem(m: ChatMessage): ThreadItem {
  return { kind: m.role, id: m.id, atMs: m.atMs, text: m.text, quote: m.quote };
}

/** Build a quote reference from any thread item. */
export function quoteOf(item: ThreadItem): ChatQuote {
  const label =
    item.kind === "transcript"
      ? item.speakerLabel
      : item.kind === "user"
        ? "You"
        : item.kind === "suggestion"
          ? "Suggestion"
          : "Copilot";
  return { text: item.text, label };
}
