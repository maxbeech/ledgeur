// An illustration of the app, built from the real components and the real
// design tokens rather than a screenshot.
//
// It is drawn, not captured, so it stays correct when the design system moves,
// it is readable at any width, it costs no image bytes, and it is real text for
// a screen reader. It is explicitly labelled as an illustration wherever it is
// used: the actual output of the product is whatever your own meeting says, and
// dressing up invented dialogue as a customer's real transcript would be a lie
// about the one thing this product sells.

import { House, Library, Sparkles, SquareCheck, Users } from "lucide-react";
import { Badge, Label, Logo, SpeakerChip } from "@ledgeur/ui/components";
import { cn } from "@ledgeur/ui";

const LINES: readonly { at: string; speaker: string; confidence: number | null; text: string }[] = [
  { at: "00:04", speaker: "Priya", confidence: null, text: "The only thing I want to settle today is whether we ship the pricing change before or after the conference." },
  { at: "00:12", speaker: "Speaker 2", confidence: 0.71, text: "Before. If we wait we spend the whole conference explaining a price nobody can buy yet." },
  { at: "00:21", speaker: "Priya", confidence: null, text: "Then we need the billing migration done by Thursday. Sam, can you own that?" },
  { at: "00:27", speaker: "Sam", confidence: null, text: "I can, but I want the rollback path reviewed first. I'll have something to look at tomorrow morning." },
];

const RAIL = [
  { icon: House, label: "Home" },
  { icon: Library, label: "Library", active: true },
  { icon: Sparkles, label: "Ask" },
  { icon: SquareCheck, label: "Tasks" },
  { icon: Users, label: "People" },
];

export function TranscriptPreview({ className }: { className?: string }) {
  return (
    <figure className={cn("overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-float)]", className)}>
      <div className="grid sm:grid-cols-[200px_1fr]">
        {/* The sidebar, in miniature. */}
        <div className="hidden border-r border-hairline bg-paper p-3 sm:block" aria-hidden>
          <div className="px-2 pb-3 pt-1"><Logo size="sm" /></div>
          <div className="mb-3 flex h-8 items-center gap-2 rounded-lg bg-ink px-3 text-xs font-semibold text-on-ink">
            <span className="h-2 w-2 rounded-full bg-danger-fill" /> New recording
          </div>
          {RAIL.map(({ icon: Icon, label, active }) => (
            <div key={label} className={cn("flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs font-medium", active ? "bg-surface-sunken text-ink-text" : "text-muted")}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </div>
          ))}
          <div className="mt-4 px-2.5 text-2xs font-semibold text-faint">Spaces</div>
          {[["sky", "Customers"], ["rose", "Hiring"]].map(([tone, name]) => (
            <div key={name} className="flex h-7 items-center gap-2 px-2.5 text-xs font-medium text-muted">
              <span className={`h-2 w-2 rounded-full bg-${tone}`} /> {name}
            </div>
          ))}
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
            <div className="min-w-0">
              <div className="ldg-display truncate text-lg text-ink-text">Pricing before the conference</div>
              <div className="text-xs text-faint">Today · 3 speakers</div>
            </div>
            <Badge tone="danger">
              <span className="ldg-halo inline-block h-1.5 w-1.5 rounded-full bg-danger-fill" aria-hidden />
              Recording 04:12
            </Badge>
          </div>

          <div className="space-y-4 px-5 py-4">
            {LINES.map((line) => (
              <div key={line.at} className="flex gap-3">
                <time className="ldg-num w-11 shrink-0 pt-1 text-right text-xs text-faint">{line.at}</time>
                <div className="min-w-0">
                  <SpeakerChip label={line.speaker} confidence={line.confidence} />
                  <p className="mt-1 text-md leading-relaxed text-ink-text">{line.text}</p>
                </div>
              </div>
            ))}
          </div>

          {/* What the transcript becomes. */}
          <div className="border-t border-hairline bg-paper px-5 py-4">
            <Label>Action items</Label>
            <ul className="mt-2 space-y-1.5 text-base text-ink-text">
              {["Sam — billing migration, with a reviewed rollback path, by Thursday", "Ship the pricing change before the conference"].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <figcaption className="border-t border-hairline px-5 py-2.5 text-xs text-faint">
        An illustration of the app. Your own transcript is whatever your meeting says — Ledgeur never invents a word of it.
      </figcaption>
    </figure>
  );
}
