// The composer: a pill with a round send button, the way a chat input reads
// now. Shows the line you are quoting, and — when the on-device model still
// needs its one-time download — a one-tap "get ready" prompt instead of
// failing silently.
import { useState } from "react";
import { ArrowUp, X, Download, Sparkles, Check } from "lucide-react";
import { cn } from "@ledgeur/ui";
import { Button, Notice, Spinner } from "../ui.tsx";
import { useCopilot } from "../../lib/useCopilot.ts";
import type { ChatQuote } from "../../lib/meetingsStore.ts";

export function ChatComposer({
  onSend,
  placeholder = "Ask the copilot",
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
  const canSend = !busy && input.trim().length > 0;

  function submit() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    onSend(q, quote ?? undefined);
    onClearQuote?.();
  }

  return (
    <div>
      {copilot.needsDownload && (
        <Notice
          tone="brand"
          className="mb-2"
          icon={<Sparkles className="h-4 w-4 text-brand-strong" />}
          action={!copilot.downloading && (
            <Button size="sm" tone="primary" onClick={() => void copilot.startDownload()}>
              <Download className="h-3.5 w-3.5" /> Download
            </Button>
          )}
        >
          {copilot.downloading
            ? <>Getting the copilot ready — {Math.round(copilot.progress)}%</>
            : copilot.error
              // A download that fails has to say so. It used to leave the prompt
              // looking untouched, which reads as the button doing nothing.
              ? <>Couldn&rsquo;t download the copilot: {copilot.error}</>
              : <>The copilot runs privately on your device. Download it once (about 1&nbsp;GB) to start.</>}
        </Notice>
      )}

      {copilot.justReady && (
        <Notice
          tone="brand"
          className="mb-2"
          icon={<Check className="h-4 w-4 text-brand-strong" />}
        >
          {copilot.modelName} is installed. The copilot answers on your device from now on.
        </Notice>
      )}

      <div className={cn(
        "rounded-3xl border border-hairline-strong bg-surface shadow-[var(--shadow-card)] transition-shadow",
        "focus-within:border-brand focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_18%,transparent)]",
      )}>
        {quote && (
          <div className="flex items-start gap-2 px-4 pt-3">
            <div className="min-w-0 flex-1 rounded-xl bg-surface-muted px-3 py-2">
              <span className="text-2xs font-semibold text-faint">{quote.label}</span>
              <p className="line-clamp-2 text-sm leading-snug text-muted">{quote.text}</p>
            </div>
            <button onClick={onClearQuote} className="mt-1 rounded-md p-1 text-faint hover:text-ink-text" aria-label="Clear quote">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 py-2 pl-5 pr-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            rows={1}
            autoFocus={autoFocus}
            placeholder={placeholder}
            name="copilot-input"
            aria-label="Message"
            className="ldg-prose max-h-40 min-h-[28px] flex-1 resize-none bg-transparent py-1.5 text-md leading-6 outline-none placeholder:text-faint"
          />
          <button
            onClick={submit}
            disabled={!canSend}
            aria-label="Send"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-[background-color,transform] active:scale-95",
              canSend ? "bg-ink text-on-ink" : "bg-surface-sunken text-faint",
            )}
          >
            {busy ? <Spinner className="h-4 w-4" /> : <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}
