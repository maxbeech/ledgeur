// The chat dock: one ever-present input driving one of two conversations —
// the app-level copilot (grounded in your meetings + connected tools) or, while
// a meeting is recording, that meeting's copilot. Quoting any bubble routes to
// whichever conversation is active. This is what makes the whole app read as a
// single chat surface (MainDraw-style).

import { createContext, useCallback, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { askWithContext } from "./chat.ts";
import { gatherContext } from "./askContext.ts";
import { useRecorderCtx } from "./useRecorderCtx.ts";
import { quoteOf, type ThreadItem } from "./thread.ts";
import type { ChatMessage, ChatQuote } from "./meetingsStore.ts";

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `a-${Date.now()}-${Math.round(Math.random() * 1e6)}`);

export interface ChatDock {
  /** The app-level copilot conversation (not the meeting one). */
  appMessages: ChatMessage[];
  /** Busy state for whichever conversation is currently targeted. */
  busy: boolean;
  /** True when the target is the live meeting rather than the app copilot. */
  recording: boolean;
  quote: ChatQuote | null;
  setQuote: (q: ChatQuote | null) => void;
  onQuote: (item: ThreadItem) => void;
  /** Send to the active conversation. */
  send: (text: string, quote?: ChatQuote) => void;
}

// Exported so useChatDock.ts can read it — kept out of that file because a
// module mixing a component export with a hook export breaks Vite Fast Refresh.
export const ChatDockCtx = createContext<ChatDock | null>(null);

export function ChatDockProvider({ children }: { children: ReactNode }) {
  const rec = useRecorderCtx();
  const nav = useNavigate();
  const [appMessages, setAppMessages] = useState<ChatMessage[]>([]);
  const [appBusy, setAppBusy] = useState(false);
  const [quote, setQuote] = useState<ChatQuote | null>(null);
  const clock = useRef(0);
  const recording = rec.state.status === "recording";

  const appSend = useCallback(async (text: string, q?: ChatQuote) => {
    const at = clock.current++;
    setAppMessages((m) => [...m, { id: uid(), role: "user", text, atMs: at, quote: q }]);
    setAppBusy(true);
    try {
      const context = await gatherContext(text);
      const question = q ? `Regarding this — "${q.text}" (${q.label}):\n\n${text}` : text;
      const answer = await askWithContext({ question, context });
      setAppMessages((m) => [...m, { id: uid(), role: "assistant", text: answer, atMs: clock.current++ }]);
    } catch (e) {
      setAppMessages((m) => [...m, { id: uid(), role: "error", text: e instanceof Error ? e.message : String(e), atMs: clock.current++ }]);
    } finally {
      setAppBusy(false);
    }
  }, []);

  const send = useCallback((text: string, q?: ChatQuote) => {
    const quoteArg = q ?? undefined;
    setQuote(null);
    if (recording) {
      void rec.sendChat(text, quoteArg);
    } else {
      // Surface the copilot conversation so the answer is visible.
      nav("/ask");
      void appSend(text, quoteArg);
    }
  }, [recording, rec, nav, appSend]);

  const onQuote = useCallback((item: ThreadItem) => setQuote(quoteOf(item)), []);

  return (
    <ChatDockCtx.Provider value={{ appMessages, busy: recording ? rec.chatBusy : appBusy, recording, quote, setQuote, onQuote, send }}>
      {children}
    </ChatDockCtx.Provider>
  );
}
