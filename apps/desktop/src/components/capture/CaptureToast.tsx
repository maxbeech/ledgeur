// What happened to the thought you just kept.
//
// The capture box closes the instant Enter is pressed, which leaves a question
// it would be rude not to answer: where did that go? This answers it without
// ever being in the way — it appears after the box has gone, updates itself
// from "Kept" to "Task · Acme" as the sort finishes, and takes itself away.
//
// The correction lives here rather than in a settings screen because this is
// the one moment somebody knows the answer. Ten minutes later they will not
// remember what the thought was, let alone whether "Acme" was right.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Inbox, Loader2, SquareCheck, StickyNote } from "lucide-react";
import { cn } from "@ledgeur/ui";
import { captureById, setCaptureKind, useCaptures } from "../../lib/captures.ts";
import { clearAnnouncement, useCaptureDock } from "../../lib/captureDock.ts";
import { useFolders } from "../../lib/folders.ts";

/** How long the confirmation stays. Long enough to read and correct, short
 *  enough that it is gone before it becomes furniture. */
const LINGER_MS = 7_000;

export function CaptureToast() {
  const { lastId } = useCaptureDock();
  // Subscribing to the store is what makes this live: the sort finishing is a
  // change to the capture, and the line rewrites itself when it lands.
  useCaptures();
  const folders = useFolders();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!lastId) return;
    setDismissed(false);
    const timer = setTimeout(() => clearAnnouncement(), LINGER_MS);
    return () => clearTimeout(timer);
  }, [lastId]);

  if (!lastId || dismissed) return null;
  const capture = captureById(lastId);
  if (!capture) return null;

  const space = capture.spaceId ? folders.find((f) => f.id === capture.spaceId) : undefined;
  // Nothing has looked at it yet: no confidence either way, and no reason
  // recorded for why not.
  const sorting = capture.kindConfidence === 0 && capture.spaceConfidence === 0 && !capture.unsortedReason;
  const isTask = capture.kind === "task";

  return (
    <div className="ldg-fade-in pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 sm:bottom-28">
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-hairline bg-surface px-3.5 py-2.5 shadow-[var(--shadow-palette)]">
        <span className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          sorting ? "bg-surface-muted text-muted" : "bg-accent-soft text-accent-strong",
        )}>
          {sorting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-text">{capture.title}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            {sorting ? (
              "Kept — working out where it goes"
            ) : (
              <>
                {isTask ? <SquareCheck className="h-3 w-3" /> : <StickyNote className="h-3 w-3" />}
                {isTask ? "Task" : "Note"}
                {space
                  ? <>· <span className={cn("h-2 w-2 rounded-full", `bg-${space.tone}`)} />{space.name}</>
                  : <>· <Inbox className="h-3 w-3" />Inbox</>}
              </>
            )}
          </span>
        </span>

        {!sorting && (
          <span className="flex shrink-0 items-center gap-1">
            {/* One tap, and the guess it corrects is never made again for this
                thought — see setKind in @ledgeur/core. */}
            <button
              onClick={() => setCaptureKind(capture.id, isTask ? "note" : "task")}
              className="rounded-lg px-2 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-surface-muted hover:text-ink-text"
            >
              {isTask ? "Not a task" : "Make a task"}
            </button>
            <Link
              to="/inbox"
              onClick={() => { setDismissed(true); clearAnnouncement(); }}
              className="rounded-lg px-2 py-1.5 text-xs font-semibold text-brand-strong transition-colors hover:bg-surface-muted"
            >
              Open
            </Link>
          </span>
        )}
      </div>
    </div>
  );
}
