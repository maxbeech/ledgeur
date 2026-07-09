// The chat input. Reused as the in-meeting copilot composer and as the app's
// ever-present bottom input (MainDraw-style). Shows the bubble you're quoting,
// and — when the on-device model still needs its one-time download — a one-tap
// "get ready" prompt instead of failing silently (task #1).
import { useState } from "react";
import { Send, X, Download, Sparkles } from "lucide-react";
import { Spinner } from "../ui.tsx";
import { useCopilot } from "../../lib/useCopilot.ts";
import type { ChatQuote } from "../../lib/meetingsStore.ts";

export function ChatComposer({
  onSend,
  placeholder = "Ask the copilot…",
  quote,
  onClearQuote,
  busy,
  autoFocus,
}: {
  onSend: (text: string, quote?: ChatQuote) => void;
  placeholder?: string;
  quote?: ChatQuote | null;
  onClearQuote?: () => void;
  busy?: boolean;
  autoFocus?: boolean;
}) {
  const [input, setInput] = useState("");
  const copilot = useCopilot();

  function submit() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    onSend(q, quote ?? undefined);
    onClearQuote?.();
  }

  return (
    <div className="border-t border-hairline bg-surface/85 p-3 backdrop-blur-sm">
      {copilot.needsDownload && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-glow/25 bg-glow-soft/40 px-3 py-2 text-[12.5px] text-ink-text">
          <Sparkles className="h-4 w-4 shrink-0 text-glow-strong" />
          {copilot.downloading ? (
            <span className="flex-1">Getting the copilot ready… {Math.round(copilot.progress)}%</span>
          ) : (
            <>
              <span className="flex-1">The copilot runs privately on your device. Download it once (~1&nbsp;GB) to start.</span>
              <button
                onClick={() => void copilot.startDownload()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-glow-strong px-2.5 py-1 text-[12px] font-medium text-white hover:bg-glow"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </button>
            </>
          )}
        </div>
      )}

      {quote && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-hairline bg-surface-muted/50 px-3 py-2">
          <div className="min-w-0 flex-1 border-l-2 border-glow/50 pl-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-faint">{quote.label}</span>
            <p className="line-clamp-2 text-[12.5px] italic leading-snug text-muted">{quote.text}</p>
          </div>
          <button onClick={onClearQuote} className="text-faint hover:text-ink-text" aria-label="Clear quote">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 rounded-xl border border-hairline bg-surface px-3 py-2 focus-within:ring-2 focus-within:ring-glow/30">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={1}
          autoFocus={autoFocus}
          placeholder={placeholder}
          name="copilot-input"
          className="max-h-32 flex-1 resize-none bg-transparent text-[13.5px] outline-none placeholder:text-faint"
        />
        <button onClick={submit} disabled={busy || !input.trim()} className="text-glow-strong disabled:opacity-40" aria-label="Send">
          {busy ? <Spinner className="h-[17px] w-[17px]" /> : <Send className="h-[17px] w-[17px]" />}
        </button>
      </div>
    </div>
  );
}
