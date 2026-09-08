// A list of kept thoughts, with the three corrections worth one tap.
//
// Every guess this shows is labelled as one, and every label is a control: the
// space chip opens the space picker, the kind chip flips it, and both stop
// being guesses the moment somebody touches them. A guess presented as a fact
// is what makes people stop trusting automatic filing altogether — and the
// correction is also the only training signal this design has, since a
// corrected capture is never re-sorted (see applyRouting in @ledgeur/core).

import { useState } from "react";
import { Check, Inbox, Mic, SquareCheck, StickyNote, Trash2 } from "lucide-react";
import { cn, relativeTime } from "@ledgeur/ui";
import { type CaptureRecord } from "@ledgeur/core";
import { Badge, Card, IconButton } from "../ui.tsx";
import { deleteCapture, setCaptureDone, setCaptureKind, setCaptureSpace } from "../../lib/captures.ts";
import { useFolders } from "../../lib/folders.ts";

export function CaptureList({ captures, showSpace = true }: {
  captures: readonly CaptureRecord[];
  /** Off inside a space, where every row would carry the same chip. */
  showSpace?: boolean;
}) {
  const folders = useFolders();
  const [picking, setPicking] = useState<string | null>(null);
  const now = new Date();

  return (
    <Card className="divide-y divide-hairline">
      {captures.map((c) => {
        const space = c.spaceId ? folders.find((f) => f.id === c.spaceId) : undefined;
        const isTask = c.kind === "task";
        const guessedSpace = c.spaceSource === "inferred" && Boolean(space);
        const guessedKind = c.kindSource === "inferred" && c.kindConfidence > 0;

        return (
          <div key={c.id} className="group px-4 py-3">
            <div className="flex items-start gap-3">
              {isTask ? (
                <button
                  onClick={() => setCaptureDone(c.id, !c.done)}
                  aria-label={c.done ? "Mark as not done" : "Mark as done"}
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    c.done ? "border-accent-strong bg-accent-strong text-on-ink" : "border-hairline-strong bg-surface hover:border-brand",
                  )}
                >
                  {c.done && <Check className="h-3 w-3" strokeWidth={3} />}
                </button>
              ) : (
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-faint">
                  <StickyNote className="h-4 w-4" />
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className={cn("ldg-prose text-base leading-relaxed text-ink-text", c.done && "text-faint line-through")}>
                  {c.title}
                </div>
                {/* The tidied title is the model's; the original is the person's.
                    Shown when they differ so nothing is quietly rewritten. */}
                {c.title !== c.text && (
                  <div className="mt-0.5 truncate text-xs text-faint">{c.text}</div>
                )}

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-faint">
                  <button
                    onClick={() => setCaptureKind(c.id, isTask ? "note" : "task")}
                    title={guessedKind ? "Ledgeur guessed this — tap to change it" : "Change"}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition-colors",
                      "bg-surface-muted text-muted hover:bg-surface-sunken hover:text-ink-text",
                      guessedKind && "border border-dashed border-hairline-strong",
                    )}
                  >
                    {isTask ? <SquareCheck className="h-3 w-3" /> : <StickyNote className="h-3 w-3" />}
                    {isTask ? "Task" : "Note"}
                  </button>

                  {showSpace && (
                    <button
                      onClick={() => setPicking(picking === c.id ? null : c.id)}
                      title={guessedSpace ? `Guessed from “${c.spaceEvidence}” — tap to change it` : "File this somewhere"}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition-colors",
                        "bg-surface-muted text-muted hover:bg-surface-sunken hover:text-ink-text",
                        guessedSpace && "border border-dashed border-hairline-strong",
                      )}
                    >
                      {space
                        ? <><span className={cn("h-2 w-2 rounded-full", `bg-${space.tone}`)} />{space.name}</>
                        : <><Inbox className="h-3 w-3" />Inbox</>}
                    </button>
                  )}

                  {c.entry === "spoken" && (
                    <span className="inline-flex items-center gap-1" title="Spoken — this text is a transcript">
                      <Mic className="h-3 w-3" />
                    </span>
                  )}
                  <span>{relativeTime(c.createdAt, now)}</span>
                  {c.unsortedReason && <Badge tone="warn">Not sorted</Badge>}
                </div>

                {/* Why it was filed there. Only for a guess: a space somebody
                    chose needs no justification. */}
                {guessedSpace && c.spaceEvidence && (
                  <div className="mt-1 text-xs italic text-faint">Filed here from “{c.spaceEvidence}”</div>
                )}
                {c.unsortedReason && (
                  <div className="mt-1 text-xs text-faint">Kept, but nothing could sort it: {c.unsortedReason}</div>
                )}

                {picking === c.id && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <SpaceOption active={!c.spaceId} onClick={() => { setCaptureSpace(c.id, null); setPicking(null); }}>
                      <Inbox className="h-3 w-3" /> Inbox
                    </SpaceOption>
                    {folders.map((f) => (
                      <SpaceOption key={f.id} active={c.spaceId === f.id} onClick={() => { setCaptureSpace(c.id, f.id); setPicking(null); }}>
                        <span className={cn("h-2 w-2 rounded-full", `bg-${f.tone}`)} />
                        {f.name}
                      </SpaceOption>
                    ))}
                    {folders.length === 0 && (
                      <span className="text-xs text-faint">No spaces yet — make one in the Library.</span>
                    )}
                  </div>
                )}
              </div>

              <IconButton
                label="Delete this thought"
                size="sm"
                onClick={() => deleteCapture(c.id)}
                className="shrink-0 text-faint opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function SpaceOption({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "bg-ink text-on-ink" : "bg-surface-muted text-muted hover:bg-surface-sunken hover:text-ink-text",
      )}
    >
      {children}
    </button>
  );
}
