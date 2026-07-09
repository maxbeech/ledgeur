// One entry in the meeting conversation, rendered as a chat bubble. Handles all
// four voices with the app's color semantics: transcript = the room (neutral,
// with a speaker mark), you = ink (right), copilot = gold/glow (left),
// suggestion = a gold "you could say" whisper. Any bubble can be quoted.
import { Lightbulb, Quote, AlertCircle } from "lucide-react";
import { formatElapsed, confidenceTier } from "@ledgeur/ui";
import { SpeakerTag } from "../SpeakerTag.tsx";
import type { ThreadItem } from "../../lib/thread.ts";

function QuoteRef({ label, text }: { label: string; text: string }) {
  return (
    <div className="mb-1.5 border-l-2 border-glow/50 pl-2 text-[11.5px] italic leading-snug text-muted">
      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <span className="ml-1.5 line-clamp-2">{text}</span>
    </div>
  );
}

export function ThreadBubble({ item, onQuote }: { item: ThreadItem; onQuote?: (item: ThreadItem) => void }) {
  const quoteBtn = onQuote && (
    <button
      onClick={() => onQuote(item)}
      className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
      title="Quote in a reply"
      aria-label="Quote this message"
    >
      <Quote className="h-3.5 w-3.5 text-faint hover:text-glow-strong" />
    </button>
  );

  if (item.kind === "transcript") {
    const asr = confidenceTier(item.confidence);
    return (
      <div className="group grid grid-cols-[46px_1fr] gap-x-3">
        <span className="pt-1 text-right font-mono text-[10px] tabular-nums leading-5 text-faint">
          {formatElapsed(item.atMs / 1000)}
        </span>
        <div className="max-w-[92%] rounded-2xl rounded-tl-md border border-hairline bg-surface-muted/40 px-3.5 py-2">
          <div className="mb-1 flex items-center gap-2">
            <SpeakerTag label={item.speakerLabel} confidence={item.speakerConfidence} />
            {(asr === "medium" || asr === "low") && (
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint/80">
                {asr === "medium" ? "unsure" : "low confidence"}
              </span>
            )}
            <span className="ml-auto">{quoteBtn}</span>
          </div>
          <p className="text-[14.5px] leading-relaxed text-ink-text">{item.text}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "user") {
    return (
      <div className="group flex flex-col items-end gap-1">
        <div className="max-w-[90%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-[13.5px] leading-relaxed text-on-ink">
          {item.quote && <QuoteRef label={item.quote.label} text={item.quote.text} />}
          <p className="whitespace-pre-wrap">{item.text}</p>
        </div>
        {quoteBtn}
      </div>
    );
  }

  if (item.kind === "error") {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-soft/60 px-3.5 py-2 text-[13px] leading-relaxed text-danger">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="whitespace-pre-wrap">{item.text}</span>
      </div>
    );
  }

  // assistant + suggestion — the brain speaking (gold/glow)
  const isSuggestion = item.kind === "suggestion";
  return (
    <div className="group flex flex-col items-start gap-1">
      <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-glow/25 bg-glow-soft/45 px-3.5 py-2 text-[13.5px] leading-relaxed text-ink-text">
        {isSuggestion && (
          <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-glow-strong">
            <Lightbulb className="h-3.5 w-3.5" /> You could say
          </div>
        )}
        {item.quote && <QuoteRef label={item.quote.label} text={item.quote.text} />}
        <p className="whitespace-pre-wrap">{isSuggestion ? `“${item.text}”` : item.text}</p>
      </div>
      {quoteBtn}
    </div>
  );
}
