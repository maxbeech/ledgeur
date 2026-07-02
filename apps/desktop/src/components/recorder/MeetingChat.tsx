// In-meeting chat. Grounds answers in the live transcript (and the knowledge
// base once indexed). Gold = the brain speaking. Shows an explicit failure if
// the local model isn't running rather than inventing an answer.
import { useState } from "react";
import { Send, AlertCircle } from "lucide-react";
import { askWithContext, type ContextBlock } from "../../lib/chat.ts";
import { CONFIG } from "../../lib/config.ts";

interface Msg { role: "user" | "assistant" | "error"; text: string }

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
      <div className="pn-prose min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-[13px] leading-relaxed text-muted">
            Ask anything about what's being discussed. Answers are grounded in the live transcript and your knowledge base — nothing is made up.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`pn-rise ${m.role === "user" ? "text-right" : ""}`}>
            <div
              className={
                m.role === "user"
                  ? "inline-block max-w-[90%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-left text-[13px] leading-relaxed text-on-ink"
                  : m.role === "error"
                    ? "flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-soft/60 px-3.5 py-2 text-[13px] leading-relaxed text-danger"
                    : "inline-block max-w-[95%] rounded-2xl rounded-bl-md border border-glow/20 bg-glow-soft/50 px-3.5 py-2 text-[13px] leading-relaxed text-ink-text"
              }
            >
              {m.role === "error" && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span className="whitespace-pre-wrap">{m.text}</span>
            </div>
          </div>
        ))}
        {busy && (
          <div className="space-y-1.5">
            <div className="pn-shimmer h-px w-28" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-glow-strong">Consulting the record…</span>
          </div>
        )}
      </div>

      <div className="border-t border-hairline p-3">
        <div className="flex items-end gap-2 rounded-xl border border-hairline bg-surface px-3 py-2 focus-within:ring-2 focus-within:ring-glow/30">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            rows={1}
            placeholder="Ask about this meeting…" name="meeting-chat"
            className="max-h-28 flex-1 resize-none bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
          <button onClick={() => void send()} disabled={busy || !input.trim()} className="text-glow-strong disabled:opacity-40" aria-label="Send">
            <Send className="h-[17px] w-[17px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
