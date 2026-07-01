import { useState } from "react";
import { Sparkles, Send, AlertCircle } from "lucide-react";
import { Spinner } from "../ui.tsx";
import { askWithContext, type ContextBlock } from "../../lib/chat.ts";
import { CONFIG } from "../../lib/config.ts";

interface Msg { role: "user" | "assistant" | "error"; text: string }

/** In-meeting chat. Grounds answers in the live transcript (and, once wired,
 *  past meetings / Notion / colleagues). Shows an explicit failure if the local
 *  model isn't running rather than inventing an answer. */
export function MeetingChat({ getContext }: { getContext: () => ContextBlock[] }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const answer = await askWithContext({ baseUrl: CONFIG.localLlmUrl, question: q, context: getContext() });
      setMessages((m) => [...m, { role: "assistant", text: answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
        <Sparkles className="h-4 w-4 text-accent-strong" />
        <span className="text-sm font-semibold text-ink-text">Ask this meeting</span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-sm leading-relaxed text-muted">
            Ask anything about what's being discussed. Answers are grounded in the live transcript and your knowledge base — nothing is made up.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={
                m.role === "user"
                  ? "inline-block rounded-2xl rounded-br-md bg-accent-strong px-3.5 py-2 text-sm text-white"
                  : m.role === "error"
                    ? "flex items-start gap-2 rounded-2xl bg-red-50 px-3.5 py-2 text-sm text-red-700"
                    : "inline-block rounded-2xl rounded-bl-md bg-surface-muted px-3.5 py-2 text-sm text-ink-text"
              }
            >
              {m.role === "error" && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span className="whitespace-pre-wrap">{m.text}</span>
            </div>
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> Thinking…</div>}
      </div>

      <div className="border-t border-hairline p-3">
        <div className="flex items-end gap-2 rounded-xl border border-hairline bg-surface px-3 py-2 focus-within:ring-2 focus-within:ring-accent/40">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            rows={1}
            placeholder="Ask about this meeting…"
            className="max-h-28 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button onClick={() => void send()} disabled={busy || !input.trim()} className="text-accent-strong disabled:opacity-40" aria-label="Send">
            <Send className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
