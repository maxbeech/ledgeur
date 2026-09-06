// The live room. One conversation — the transcript, the copilot's answers, your
// questions and its proactive suggestions — and, beside it, your notes.
// Replies are sent from the app's composer, which targets this meeting while
// it is recording. Recording state lives at app level, so leaving this screen
// does not stop the take.
//
// ── No loading screen ───────────────────────────────────────────────────────
// Recording begins the moment the microphone opens; the model's state is a
// quiet line under the header, and the audio banked while it comes up is
// transcribed as soon as it does.
import { useMemo, useState } from "react";
import { Square, PenLine, TriangleAlert, X } from "lucide-react";
import { formatElapsed, cn } from "@ledgeur/ui";
import { Button, Card, ErrorNote, IconButton, Notice, Spinner } from "../ui.tsx";
import { LevelMeter } from "./LevelMeter.tsx";
import { NotesPanel } from "./NotesPanel.tsx";
import { ThreadView } from "../chat/ThreadView.tsx";
import { RecordDot } from "../RecordDot.tsx";
import { mergeThread } from "../../lib/thread.ts";
import { useRecorderCtx } from "../../lib/useRecorderCtx.ts";
import { useChatDock } from "../../lib/useChatDock.ts";
import { useDevice } from "../../lib/platform.ts";

export function LiveMeeting({ onStop }: { onStop: () => void }) {
  const { state, title, setNotes, messages, chatBusy } = useRecorderCtx();
  const { onQuote } = useChatDock();
  const { phone } = useDevice();
  const [notesOpen, setNotesOpen] = useState(false);
  const processing = state.status === "processing";
  const items = useMemo(() => mergeThread(state.segments, messages), [state.segments, messages]);

  const notes = (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5 text-sm font-semibold text-ink-text">
        <PenLine className="h-4 w-4 text-muted" /> Your notes
        {phone && <IconButton label="Close notes" size="sm" className="ml-auto" onClick={() => setNotesOpen(false)}><X className="h-4 w-4" /></IconButton>}
      </div>
      <div className="min-h-0 flex-1">
        <NotesPanel value={state.notes} onChange={setNotes} />
      </div>
    </Card>
  );

  return (
    <div className={cn("grid h-full gap-4 px-4 pb-4 pt-2 sm:px-8", !phone && "lg:grid-cols-[1fr_340px]")}>
      <div className="flex min-h-0 flex-col">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <RecordDot live className="h-3 w-3" />
            <h1 className="ldg-display min-w-0 truncate text-xl text-ink-text">{title || "Live meeting"}</h1>
            <span className="ldg-num rounded-full bg-surface-muted px-2.5 py-0.5 text-sm text-muted">{formatElapsed(state.elapsed)}</span>
          </div>
          <div className="flex items-center gap-2">
            {phone && (
              <Button tone="secondary" size="sm" onClick={() => setNotesOpen(true)}>
                <PenLine className="h-4 w-4" /> Notes
              </Button>
            )}
            {state.status === "recording" && (
              <Button tone="danger" onClick={onStop}>
                <Square className="h-3.5 w-3.5" fill="currentColor" /> Stop &amp; save
              </Button>
            )}
          </div>
        </div>

        <TranscriberStatus
          phase={state.modelPhase}
          progress={state.modelProgress}
          device={state.device}
          backlogSeconds={state.backlogSeconds}
        />

        <div className="mb-3"><LevelMeter /></div>
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ThreadView items={items} busy={chatBusy} live onQuote={onQuote} />
        </Card>
        {processing && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Spinner /> Finishing up — separating speakers and writing notes
          </div>
        )}
        {state.error && <ErrorNote className="mt-3">{state.error}</ErrorNote>}
      </div>

      {phone ? (
        notesOpen && (
          <div className="ldg-fade-in fixed inset-0 z-40 flex flex-col justify-end bg-ink-text/30" onClick={() => setNotesOpen(false)}>
            <div className="ldg-sheet-in flex h-[70vh] flex-col rounded-t-3xl bg-surface p-3 pb-[max(env(safe-area-inset-bottom),12px)]" onClick={(e) => e.stopPropagation()}>
              {notes}
            </div>
          </div>
        )
      ) : (
        <div className="flex min-h-[320px] flex-col lg:min-h-0">{notes}</div>
      )}
    </div>
  );
}

/**
 * A single quiet line about the speech pipeline — and nothing at all in the
 * normal case, where it was warmed at launch and is already live.
 */
function TranscriberStatus({ phase, progress, device, backlogSeconds }: {
  phase: "loading" | "ready" | "failed";
  progress: number;
  device: string;
  backlogSeconds: number;
}) {
  if (phase === "failed") {
    return (
      <Notice tone="danger" className="mb-3" icon={<TriangleAlert className="h-4 w-4 text-danger" />}>
        The speech model could not start, so this meeting is being recorded but not transcribed live.
        The audio is still being captured — stop and save, then re-import if you need the text.
      </Notice>
    );
  }

  if (phase === "loading") {
    return (
      <Notice className="mb-3" icon={<Spinner className="h-4 w-4 text-brand-strong" />}>
        Recording. The speech model is still loading{progress > 0 ? ` — ${Math.round(progress)}%` : ""}. Nothing is
        being missed; the transcript catches up as soon as it is ready.
      </Notice>
    );
  }

  // Ready. The only thing worth saying now is if transcription has genuinely
  // fallen behind, which is better admitted than left to look like a hang.
  if (backlogSeconds > 0) {
    return (
      <Notice className="mb-3" icon={<Spinner className="h-4 w-4 text-brand-strong" />}>
        Transcribing {backlogSeconds}s behind on this device{device ? ` (${device})` : ""}. It catches up during
        quiet moments, and everything is captured either way.
      </Notice>
    );
  }

  return null;
}
