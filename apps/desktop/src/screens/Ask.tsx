// Ask — question the whole record. Context: org hive mind (semantic search when
// signed in + model up) plus the user's local meetings. Explicit failure states;
// the brain answers in gold, never invents.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles, Send, AlertCircle, User } from "lucide-react";
import { Kicker } from "../components/ui.tsx";
import { askWithContext, type ContextBlock } from "../lib/chat.ts";
import { CONFIG } from "../lib/config.ts";
import { listMeetings } from "../lib/meetingsStore.ts";
import { getSupabase } from "../lib/supabase.ts";
import { semanticContext } from "../lib/embeddings.ts";

interface Msg { role: "user" | "assistant" | "error"; text: string }

/** Grounding context from the org hive mind + the user's real local meetings. */
async function gatherContext(question: string): Promise<ContextBlock[]> {
  let semantic: ContextBlock[] = [];
  try {
    const sb = getSupabase();
    if (sb) {
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        const { data: org } = await sb.from("orgs").select("id").limit(1).maybeSingle();
        if (org) semantic = await semanticContext(org.id, question);
      }
    }
  } catch { /* embedding endpoint / backend unavailable — local context still works */ }

  const meetings = await listMeetings();
  const local = meetings.slice(0, 12).map((m) => ({
    source: `Meeting: ${m.title} (${new Date(m.createdAt).toLocaleDateString()})`,
    text: [m.summary.join(" "), m.actionItems.length ? `Action items: ${m.actionItems.join("; ")}` : ""].filter(Boolean).join("\n"),
  }));
  return [...semantic, ...local];
}

const STARTERS = [
  "What did we decide about pricing?",
  "What are my open action items?",
  "Summarise last week's meetings",
  "What's blocking the launch?",
];

export function Ask() {
  const [params] = useSearchParams();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const context = await gatherContext(q);
      const answer = await askWithContext({ baseUrl: CONFIG.localLlmUrl, question: q, context });
      setMessages((m) => [...m, { role: "assistant", text: answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const q = params.get("q");
    if (q && !started.current) { started.current = true; void ask(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-5 sm:px-6">
        <header className="pn-rise mb-6 pt-2">
          <Kicker className="mb-2">Consult the record</Kicker>
          <h1 className="pn-display text-[30px] leading-tight text-ink-text">Ask your brain</h1>
          <p className="mt-1.5 text-sm text-muted">Answers are grounded in your meetings and connected tools — never invented.</p>
          <div className="mt-5 h-px bg-hairline" />
        </header>

        {messages.length === 0 && (
          <div className="pn-stagger grid gap-2 sm:grid-cols-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => void ask(s)}
                className="rounded-xl border border-hairline bg-surface px-4 py-3 text-left text-sm text-ink-text shadow-[var(--shadow-card)] transition-all duration-150 hover:-translate-y-0.5 hover:border-glow/40 hover:shadow-[var(--shadow-float)]"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="pn-prose space-y-6 py-5">
          {messages.map((m, i) => (
            <div key={i} className="pn-rise flex gap-3">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${m.role === "user" ? "bg-ink text-on-ink" : m.role === "error" ? "bg-danger-soft text-danger" : "bg-glow-soft text-glow-strong"}`}>
                {m.role === "user" ? <User className="h-4 w-4" /> : m.role === "error" ? <AlertCircle className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-faint">
                  {m.role === "user" ? "You" : m.role === "error" ? "Couldn't answer" : "The record replies"}
                </div>
                <p className={`whitespace-pre-wrap text-[15px] leading-relaxed ${m.role === "error" ? "text-danger" : "text-ink-text"}`}>{m.text}</p>
              </div>
            </div>
          ))}
          {busy && (
            <div className="space-y-1.5 pl-11">
              <div className="pn-shimmer h-px w-32" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-glow-strong">Searching the record…</span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-hairline bg-surface/70 px-5 py-4 pb-[max(env(safe-area-inset-bottom),16px)] backdrop-blur sm:px-6 md:pb-4 mb-14 md:mb-0">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-glow/30 bg-surface px-4 py-3 shadow-[var(--shadow-card)] focus-within:ring-2 focus-within:ring-glow/30">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={1}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); setInput(""); } }}
            placeholder="Ask anything across your company brain…"
            className="max-h-32 flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-faint"
            aria-label="Question" name="ask-question"
          />
          <button onClick={() => { void ask(input); setInput(""); }} disabled={busy || !input.trim()} className="text-glow-strong disabled:opacity-40" aria-label="Send">
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
