// The live-meeting conversation: copilot answers, the user's questions, and
// proactive coaching suggestions — all as one ordered stream of ChatMessages
// that the UI merges with transcript segments into a single thread. Lifted to
// app level (see recorderContext) so it survives navigation and can be saved
// with the meeting. Nothing is fabricated: a model failure becomes an explicit
// "error" bubble.

import { useCallback, useEffect, useRef, useState } from "react";
import { askWithContext, type ContextBlock } from "./chat.ts";
import { suggestNext } from "./suggestions.ts";
import { useSetting } from "./settings.ts";
import type { ChatMessage, ChatQuote } from "./meetingsStore.ts";

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.round(Math.random() * 1e6)}`);

export interface MeetingThreadDeps {
  /** Grounding context for the copilot (the live transcript, etc.). */
  getContext: () => ContextBlock[];
  /** Raw transcript text, for proactive suggestions. */
  getTranscript: () => string;
  /** Milliseconds since the meeting started — orders messages against transcript. */
  elapsedMs: () => number;
  /** True while a take is actually recording. */
  recording: boolean;
  /** True once a new recording begins — clears the previous thread. */
  starting: boolean;
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
  const wasStarting = useRef(false);
  useEffect(() => {
    if (deps.starting && !wasStarting.current) setMessages([]);
    wasStarting.current = deps.starting;
  }, [deps.starting]);

  /** Send a question to the copilot, optionally quoting an earlier bubble. */
  const sendChat = useCallback(async (text: string, quote?: ChatQuote) => {
    const q = text.trim();
    if (!q || chatBusy) return;
    const d = depsRef.current;
    append({ id: uid(), role: "user", text: q, atMs: d.elapsedMs(), quote });
    setChatBusy(true);
    try {
      const question = quote ? `Regarding this — "${quote.text}" (${quote.label}):\n\n${q}` : q;
      const answer = await askWithContext({ question, context: d.getContext() });
      append({ id: uid(), role: "assistant", text: answer, atMs: depsRef.current.elapsedMs() });
    } catch (e) {
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
