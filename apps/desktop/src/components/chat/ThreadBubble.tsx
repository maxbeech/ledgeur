// One entry in a conversation. Four voices, told apart the way a chat is now:
// the room is a plain line with a speaker mark; you are a soft bubble on the
// right; the copilot answers in the open, next to its mark; a suggestion is
// the copilot whispering. Any entry can be quoted.
import { Lightbulb, Quote, BookOpen } from "lucide-react";
import { formatElapsed, confidenceTier, cn } from "@ledgeur/ui";
import { Badge, ErrorNote, LogoMark, SpeakerChip } from "../ui.tsx";
import type { ThreadItem } from "../../lib/thread.ts";

function QuoteRef({ label, text }: { label: string; text: string }) {
  return (
    <div className="mb-1.5 rounded-lg bg-ink-text/5 px-2.5 py-1.5 text-sm leading-snug">
      <span className="text-2xs font-semibold opacity-70">{label}</span>
      <span className="line-clamp-2 opacity-90">{text}</span>
    </div>
  );
}

function QuoteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md p-1 text-faint opacity-0 transition-opacity hover:bg-surface-muted hover:text-ink-text focus:opacity-100 group-hover:opacity-100"
      title="Quote in a reply"
      aria-label="Quote this message"
    >
      <Quote className="h-3.5 w-3.5" />
    </button>
  );
}

export function ThreadBubble({ item, onQuote }: { item: ThreadItem; onQuote?: (item: ThreadItem) => void }) {
  const quoteBtn = onQuote && <QuoteButton onClick={() => onQuote(item)} />;

  if (item.kind === "transcript") {
    const asr = confidenceTier(item.confidence);
    return (
      <div className="group flex gap-3">
        <span className="ldg-num w-11 shrink-0 pt-1 text-right text-xs text-faint">{formatElapsed(item.atMs / 1000)}</span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 empty:hidden">
            <SpeakerChip label={item.speakerLabel} confidence={item.speakerConfidence} />
            {(asr === "medium" || asr === "low") && (
              <span className="text-2xs font-medium text-faint">{asr === "medium" ? "unsure" : "low confidence"}</span>
            )}
            <span className="ml-auto">{quoteBtn}</span>
          </div>
          <p className="ldg-prose text-ink-text">{item.text}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "user") {
    return (
      <div className="group flex items-end justify-end gap-1">
        {quoteBtn}
        <div className="max-w-[85%] rounded-3xl bg-surface-muted px-4 py-2.5 text-md leading-relaxed text-ink-text">
          {item.quote && <QuoteRef label={item.quote.label} text={item.quote.text} />}
          <p className="whitespace-pre-wrap">{item.text}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "error") {
    return <ErrorNote>{item.text}</ErrorNote>;
  }

  // assistant + suggestion — the copilot speaking.
  const isSuggestion = item.kind === "suggestion";
  return (
    <div className="group flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-strong" aria-hidden>
        {isSuggestion ? <Lightbulb className="h-3.5 w-3.5" /> : <LogoMark className="h-4 w-4" />}
      </span>
      <div className={cn("min-w-0 flex-1", isSuggestion && "rounded-2xl bg-brand-soft/60 px-4 py-3")}>
        {isSuggestion && <div className="mb-1 text-2xs font-semibold text-brand-strong">You could say</div>}
        {item.quote && <QuoteRef label={item.quote.label} text={item.quote.text} />}
        <p className="ldg-prose whitespace-pre-wrap text-ink-text">{isSuggestion ? `“${item.text}”` : item.text}</p>
        {!isSuggestion && <Provenance sources={item.sources} missing={item.missing} />}
        <div className="-ml-1 mt-1">{quoteBtn}</div>
      </div>
    </div>
  );
}

/**
 * What the answer above was allowed to see.
 *
 * Shown on every copilot answer, not just suspicious ones: the difference
 * between "grounded in the room and the company's memory" and "grounded in the
 * last four minutes of speech" is the difference between an answer worth acting
 * on and one worth checking, and it is invisible from the prose.
 */
function Provenance({ sources, missing }: { sources?: string[]; missing?: string }) {
  if ((!sources || sources.length === 0) && !missing) return null;
  return (
    <div className="mt-2.5">
      {sources && sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <BookOpen className="h-3 w-3 shrink-0 text-faint" aria-hidden />
          <span className="sr-only">Grounded in:</span>
          {sources.map((s) => <Badge key={s}>{s}</Badge>)}
        </div>
      )}
      {missing && <p className="mt-1 text-xs leading-snug text-faint">{missing}</p>}
    </div>
  );
}
