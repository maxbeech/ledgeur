import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles, Send, AlertCircle, User } from "lucide-react";
import { PageHeader } from "../components/PageHeader.tsx";
import { Spinner } from "../components/ui.tsx";
import { askWithContext, type ContextBlock } from "../lib/chat.ts";
import { CONFIG } from "../lib/config.ts";
import { listMeetings } from "../lib/meetingsStore.ts";
import { getSupabase } from "../lib/supabase.ts";
import { semanticContext } from "../lib/embeddings.ts";

interface Msg { role: "user" | "assistant" | "error"; text: string }

/** Build grounding context from the user's real, locally-stored meetings.
 *  (Backend semantic search over the hive-mind + Notion is task #9/#11.) */
async function gatherContext(question: string): Promise<ContextBlock[]> {
  // Prefer the org hive mind (semantic search) when signed in + a model is up;
  // always include the user's own local meetings; fall back gracefully.
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
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6">
        <div className="pt-2"><PageHeader title="Ask your brain" subtitle="Answers are grounded in your meetings and connected tools — never invented." /></div>
        {messages.length === 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {["What did we decide about pricing?", "What are my open action items?", "Summarise last week's meetings", "What's blocking the launch?"].map((s) => (
              <button key={s} onClick={() => void ask(s)} className="rounded-xl border border-hairline bg-surface px-4 py-3 text-left text-sm text-ink-text hover:bg-surface-muted">
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-5 py-4">
          {messages.map((m, i) => (
            <div key={i} className="flex gap-3">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${m.role === "user" ? "bg-surface-muted text-muted" : m.role === "error" ? "bg-red-100 text-red-600" : "bg-accent-soft text-accent-strong"}`}>
                {m.role === "user" ? <User className="h-4 w-4" /> : m.role === "error" ? <AlertCircle className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <div className="mb-0.5 text-xs font-medium text-muted">{m.role === "user" ? "You" : m.role === "error" ? "Couldn't answer" : "ParleyNotes"}</div>
                <p className={`whitespace-pre-wrap text-[15px] leading-relaxed ${m.role === "error" ? "text-red-700" : "text-ink-text"}`}>{m.text}</p>
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 pl-11 text-sm text-muted"><Spinner /> Searching your brain…</div>}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-hairline bg-surface/70 px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-hairline bg-surface px-4 py-3 focus-within:ring-2 focus-within:ring-accent/40">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); setInput(""); } }}
            placeholder="Ask anything across your company brain…" className="max-h-32 flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-muted" />
          <button onClick={() => { void ask(input); setInput(""); }} disabled={busy || !input.trim()} className="text-accent-strong disabled:opacity-40" aria-label="Send"><Send className="h-5 w-5" /></button>
        </div>
      </div>
    </div>
  );
}
