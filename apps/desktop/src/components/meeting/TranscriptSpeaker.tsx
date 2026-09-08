// The speaker chip on a single transcript line, and what happens when you
// disagree with it.
//
// There are two different mistakes a person can be looking at, and collapsing
// them into one control gets one of them wrong every time:
//
//   "that voice isn't Max"      — every line by this voice is misnamed.
//   "Max didn't say THAT line"  — the name is right; this one line was
//                                 attributed to the wrong person, which is what
//                                 happens whenever two people talk over each
//                                 other at a hand-over.
//
// So the menu offers both, and says which is which. Moving one line never
// touches the voice store: a single misattributed sentence is no evidence about
// what anybody sounds like, and folding it into a voice print would make the
// next meeting worse rather than better.

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@ledgeur/ui";
import { SpeakerChip } from "../ui.tsx";

export interface TranscriptSpeakerProps {
  label: string;
  confidence?: number | null;
  /** True when this name was worked out rather than given. */
  guessed?: boolean;
  /** Every voice in this meeting, so a line can be moved to one of them. */
  labels: readonly string[];
  /** Move just this line. */
  onReassign: (toLabel: string) => void;
  /** Rename this voice throughout the meeting. */
  onRenameAll: () => void;
  disabled?: boolean;
}

export function TranscriptSpeaker({
  label, confidence, guessed, labels, onReassign, onRenameAll, disabled,
}: TranscriptSpeakerProps) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const root = useRef<HTMLSpanElement>(null);

  // Any click elsewhere, or Escape, closes it. Without this the menu survives
  // opening a second one and two are on screen at once.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) { setOpen(false); setTyping(false); }
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setTyping(false); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  if (!label.trim()) return null;
  const others = labels.filter((l) => l !== label);

  const close = () => { setOpen(false); setTyping(false); setDraft(""); };

  return (
    <span ref={root} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled ? undefined : "Wrong person? Click to fix this line, or the whole voice"}
        className="cursor-pointer disabled:cursor-default"
      >
        <SpeakerChip label={label} confidence={confidence} guessed={guessed} />
      </button>

      {open && !disabled && (
        <div
          role="menu"
          className={cn(
            "absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-hairline-strong bg-surface p-1.5 shadow-lg",
          )}
        >
          {guessed && (
            <p className="flex items-start gap-1.5 px-2 py-1.5 text-2xs text-muted">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-brand" />
              Ledgeur worked this name out from what was said. It has not been confirmed.
            </p>
          )}

          <p className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
            Just this line
          </p>
          {others.length === 0 && !typing && (
            <p className="px-2 pb-1 text-2xs text-faint">No other voice in this meeting to move it to.</p>
          )}
          {others.map((other) => (
            <button
              key={other}
              type="button"
              role="menuitem"
              onClick={() => { onReassign(other); close(); }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
            >
              <SpeakerChip label={other} />
              <span className="text-xs text-faint">said this</span>
            </button>
          ))}

          {typing ? (
            <form
              className="flex items-center gap-1.5 px-2 py-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const name = draft.trim();
                if (name) onReassign(name);
                close();
              }}
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Who said this?"
                aria-label="Who said this line"
                className="h-8 min-w-0 flex-1 rounded-full border border-hairline-strong bg-surface px-3 text-sm outline-none focus:border-brand"
              />
            </form>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => setTyping(true)}
              className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
            >
              Someone else…
            </button>
          )}

          <div className="my-1 border-t border-hairline" />
          <button
            type="button"
            role="menuitem"
            onClick={() => { onRenameAll(); close(); }}
            className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
          >
            Rename <span className="font-semibold">{label}</span> everywhere
            <span className="block text-2xs text-faint">Changes every line by this voice, and teaches it.</span>
          </button>
        </div>
      )}
    </span>
  );
}
