// The live meeting room. One conversation on the left — the transcript, the
// copilot's answers, your questions and its proactive suggestions, all as chat
// bubbles you can quote. Replies are sent from the app's ever-present bottom
// input (which targets this meeting while recording). The right rail is your
// notes. Recording state lives at app level, so leaving this screen does not
// stop the take.
//
// ── No loading screen ───────────────────────────────────────────────────────
// This used to replace the whole room with a "Loading the on-device model…"
// card, and only show the meeting once a pipeline was live. That was the wrong
// shape twice over: it made the app look like it hadn't started recording when
// it had, and it put a full-screen wait in front of the one action that has to
// feel immediate. Recording now begins the moment the microphone opens; the
// model's state is a quiet line under the header, and the audio banked while it
// comes up is transcribed as soon as it does.
import { useMemo } from "react";
import { Square, PenLine, Loader2, TriangleAlert } from "lucide-react";
import { formatElapsed } from "@ledgeur/ui";
import { Button, Card, ErrorNote, Spinner } from "../ui.tsx";
import { LevelMeter } from "./LevelMeter.tsx";
import { NotesPanel } from "./NotesPanel.tsx";
import { ThreadView } from "../chat/ThreadView.tsx";
import { mergeThread } from "../../lib/thread.ts";
import { useRecorderCtx } from "../../lib/useRecorderCtx.ts";
import { useChatDock } from "../../lib/useChatDock.ts";

export function LiveMeeting({ onStop }: { onStop: () => void }) {
  const { state, title, setNotes, messages, chatBusy } = useRecorderCtx();
  const { onQuote } = useChatDock();
  const processing = state.status === "processing";
  const items = useMemo(() => mergeThread(state.segments, messages), [state.segments, messages]);

  return (
    <div className="grid h-full grid-rows-[auto_1fr] gap-4 px-5 pb-4 sm:px-8 lg:grid-cols-[1fr_340px] lg:grid-rows-1 lg:gap-6">
      <div className="flex min-h-0 flex-col">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="ldg-halo flex h-3 w-3 shrink-0 rounded-full bg-danger" />
            <h1 className="ldg-display min-w-0 truncate text-[22px] text-ink-text">{title || "Live meeting"}</h1>
            <span className="rounded-full bg-surface-muted px-2.5 py-0.5 font-mono text-[11.5px] tabular-nums text-muted">
              {formatElapsed(state.elapsed)}
            </span>
          </div>
          {state.status === "recording" && (
            <Button variant="danger" onClick={onStop}>
              <Square className="h-4 w-4" fill="currentColor" /> Stop &amp; save
            </Button>
          )}
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
            <Spinner /> Finishing the record — separating speakers and writing notes…
          </div>
        )}
        {state.error && <ErrorNote className="mt-3">{state.error}</ErrorNote>}
      </div>

      <Card className="flex min-h-[320px] flex-col overflow-hidden lg:min-h-0">
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5 text-[12.5px] font-medium text-ink-text">
          <PenLine className="h-3.5 w-3.5 text-muted" /> Notes
        </div>
        <div className="min-h-0 flex-1">
          <NotesPanel value={state.notes} onChange={setNotes} />
        </div>
      </Card>
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
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[12px] leading-relaxed text-ink-text">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
        <span>
          The speech model could not start, so this meeting is being recorded but not transcribed live.
          The audio is still being captured — stop and save, then re-import if you need the text.
        </span>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-hairline bg-surface-muted/50 px-3 py-2 text-[12px] text-muted">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-strong" />
        <span>
          Recording. The speech model is still loading{progress > 0 ? ` — ${Math.round(progress)}%` : ""} — nothing is
          being missed, the transcript catches up as soon as it's ready.
        </span>
      </div>
    );
  }

  // Ready. The only thing worth saying now is if transcription has genuinely
  // fallen behind, which is better admitted than left to look like a hang.
  if (backlogSeconds > 0) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-hairline bg-surface-muted/50 px-3 py-2 text-[12px] text-muted">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-strong" />
        <span>
          Transcribing {backlogSeconds}s behind on this machine{device ? ` (${device})` : ""} — it catches up during
          quiet moments, and everything is captured either way.
        </span>
      </div>
    );
  }

  return null;
}
