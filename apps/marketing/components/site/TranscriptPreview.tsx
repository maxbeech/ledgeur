// An illustration of the transcript view, built from the real components and
// the real design tokens rather than a screenshot.
//
// It is drawn, not captured, so it stays correct when the design system moves,
// it is readable at any width, it costs no image bytes, and it is real text for
// a screen reader. It is explicitly labelled as an illustration wherever it is
// used: the actual output of the product is whatever your own meeting says, and
// dressing up invented dialogue as a customer's real transcript would be a lie
// about the one thing this product sells.

import { SpeakerChip } from "@ledgeur/ui/components";
import { cn } from "@ledgeur/ui";

const LINES: readonly { at: string; speaker: string; confidence: number | null; text: string }[] = [
  { at: "00:04", speaker: "Priya", confidence: null, text: "Right — the only thing I want to settle today is whether we ship the pricing change before or after the conference." },
  { at: "00:12", speaker: "Speaker 2", confidence: 0.71, text: "Before. If we wait we spend the whole conference explaining a price nobody can buy yet." },
  { at: "00:21", speaker: "Priya", confidence: null, text: "Then we need the billing migration done by Thursday. Sam, can you own that?" },
  { at: "00:27", speaker: "Sam", confidence: null, text: "I can, but I want the rollback path reviewed first. I'll have something to look at tomorrow morning." },
];

export function TranscriptPreview({ className }: { className?: string }) {
  return (
    <figure className={cn("overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-float)]", className)}>
      {/* Window chrome — the app's own title bar, in miniature. */}
      <div className="flex items-center gap-3 border-b border-hairline bg-ink px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        </span>
        <span className="ldg-display text-[13px] text-on-ink">Pricing before the conference</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-on-ink-muted">
          <span className="ldg-pulse inline-block h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
          Recording · 04:12
        </span>
      </div>

      <div className="divide-y divide-hairline">
        {LINES.map((line) => (
          <div key={line.at} className="flex gap-3 px-4 py-3 sm:px-5">
            <time className="mt-0.5 shrink-0 font-mono text-[11px] text-faint">{line.at}</time>
            <div className="min-w-0">
              <SpeakerChip label={line.speaker} confidence={line.confidence} />
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-text">{line.text}</p>
            </div>
          </div>
        ))}
      </div>

      {/* The notes rail, showing what the transcript becomes. */}
      <div className="border-t border-hairline bg-surface-muted px-4 py-3.5 sm:px-5">
        <div className="ldg-kicker">Action items</div>
        <ul className="mt-2 space-y-1.5 text-[13px] text-ink-text">
          <li className="flex gap-2"><span className="text-accent-strong" aria-hidden>▢</span> Sam — billing migration, with a reviewed rollback path, by Thursday</li>
          <li className="flex gap-2"><span className="text-accent-strong" aria-hidden>▢</span> Ship the pricing change before the conference</li>
        </ul>
      </div>

      <figcaption className="border-t border-hairline px-4 py-2.5 text-[11px] text-faint sm:px-5">
        An illustration of the transcript view. Your own transcript is whatever your meeting says —
        Ledgeur never invents a word of it.
      </figcaption>
    </figure>
  );
}
