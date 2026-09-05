// The live-meeting conversation: copilot answers, the user's questions, and
// proactive coaching suggestions — all as one ordered stream of ChatMessages
// that the UI merges with transcript segments into a single thread. Lifted to
// app level (see recorderContext) so it survives navigation and can be saved
// with the meeting. Nothing is fabricated: a model failure becomes an explicit
// "error" bubble, and a context source that failed or timed out is named on the
// answer rather than quietly missing from it.

import { useCallback, useEffect, useRef, useState } from "react";
import { askWithContext } from "./chat.ts";
import { suggestNext } from "./suggestions.ts";
import { useSetting } from "./settings.ts";
import type { MeetingContext } from "./meetingContext.ts";
import type { ChatMessage, ChatQuote } from "./meetingsStore.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("meeting-thread");

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.round(Math.random() * 1e6)}`);

export interface MeetingThreadDeps {
  /** Everything the answer may see, assembled for this specific question. */
  gather: (question: string) => Promise<MeetingContext>;
  /** Speaker-labelled transcript, for proactive suggestions. */
  getTranscript: () => string;
  /** Milliseconds since the meeting started — orders messages against transcript. */
  elapsedMs: () => number;
  /** True while a take is actually recording. */
  recording: boolean;
  /**
   * Identifies the current take. A change clears the thread.
   *
   * This used to be a `starting` boolean derived from "recording AND the model
   * is still loading", which stopped working the moment the speech model began
   * staying warm between recordings: with a warm model that condition is never
   * true, so a second meeting opened with the first meeting's copilot
   * conversation still in it.
   */
  takeId: string;
}

export function useMeetingThread(deps: MeetingThreadDeps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const proactive = useSetting("proactiveSuggestions");
  const intervalSec = useSetting("suggestIntervalSec");
  const inFlightSuggest = useRef(false);

  // Keep the latest deps in a ref so the interval/callbacks never go stale.
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const append = useCallback((m: ChatMessage) => setMessages((prev) => [...prev, m]), []);
  const resetThread = useCallback(() => setMessages([]), []);

  // A fresh take clears the previous conversation.
  const lastTake = useRef(deps.takeId);
  useEffect(() => {
    if (deps.takeId !== lastTake.current) {
      lastTake.current = deps.takeId;
      setMessages([]);
    }
  }, [deps.takeId]);

  /** Send a question to the copilot, optionally quoting an earlier bubble. */
  const sendChat = useCallback(async (text: string, quote?: ChatQuote) => {
    const q = text.trim();
    if (!q || chatBusy) return;
    const d = depsRef.current;
    append({ id: uid(), role: "user", text: q, atMs: d.elapsedMs(), quote });
    setChatBusy(true);
    try {
      // The quote is folded into the question so it also steers retrieval —
      // quoting a line about pricing should pull the company's pricing memory,
      // not just show the line back to the model.
      const question = quote ? `Regarding this — "${quote.text}" (${quote.label}):\n\n${q}` : q;
      const context = await d.gather(question);
      const answer = await askWithContext({
        question,
        context: context.blocks,
        mode: "meeting",
        situation: context.situation,
      });
      append({
        id: uid(),
        role: "assistant",
        text: answer.text,
        atMs: depsRef.current.elapsedMs(),
        sources: answer.sources,
        // Only ever set when something genuinely went wrong or ran late. An
        // answer that saw everything says nothing extra.
        missing: describeGaps(context, answer.dropped),
      });
    } catch (e) {
      log.error("in-meeting question failed", e);
      append({ id: uid(), role: "error", text: e instanceof Error ? e.message : String(e), atMs: depsRef.current.elapsedMs() });
    } finally {
      setChatBusy(false);
    }
  }, [chatBusy, append]);

  /** Generate one proactive suggestion and post it as an assistant bubble. */
  const pushSuggestion = useCallback(async () => {
    if (inFlightSuggest.current) return;
    inFlightSuggest.current = true;
    try {
      const [s] = await suggestNext(depsRef.current.getTranscript());
      if (s) append({ id: uid(), role: "suggestion", text: s, atMs: depsRef.current.elapsedMs() });
    } catch {
      /* proactive tips are best-effort — never surface an error bubble for them */
    } finally {
      inFlightSuggest.current = false;
    }
  }, [append]);

  // Proactive coaching loop: only while recording, only when enabled.
  useEffect(() => {
    if (!deps.recording || !proactive) return;
    const id = setInterval(() => void pushSuggestion(), Math.max(30, intervalSec) * 1000);
    return () => clearInterval(id);
  }, [deps.recording, proactive, intervalSec, pushSuggestion]);

  return { messages, chatBusy, sendChat, pushSuggestion, resetThread };
}

/**
 * One short line naming what the answer could not see, or undefined.
 *
 * "Answered without Contextely (timed out)" is a materially different claim
 * from the answer itself, and a person deciding whether to trust it needs it.
 */
function describeGaps(context: MeetingContext, dropped: string[]): string | undefined {
  const parts: string[] = [];
  if (context.slow.length) parts.push(`${context.slow.join(", ")} (timed out)`);
  for (const f of context.failed) parts.push(`${f.label} (${f.error})`);
  if (dropped.length) parts.push(`${dropped.length} source${dropped.length === 1 ? "" : "s"} too large to include`);
  return parts.length ? `Answered without ${parts.join("; ")}.` : undefined;
}
