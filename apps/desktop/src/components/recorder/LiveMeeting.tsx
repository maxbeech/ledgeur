// The live meeting room. One conversation on the left — the transcript, the
// copilot's answers, your questions and its proactive suggestions, all as chat
// bubbles you can quote. Replies are sent from the app's ever-present bottom
// input (which targets this meeting while recording). The right rail is now just
// your notes. Recording state lives at app level, so leaving this screen does
// not stop the take.
import { useMemo } from "react";
import { Square, PenLine } from "lucide-react";
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
  const loading = state.status === "loading-model";
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
              <Square className="h-4 w-4" fill="currentColor" /> Stop & save
            </Button>
          )}
        </div>

        {loading ? (
          <Card className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <Spinner className="h-6 w-6 text-accent-strong" />
            <div>
              <div className="text-sm font-medium text-ink-text">Loading the on-device model…</div>
              <div className="mt-1 font-mono text-[11px] text-muted">
                {state.device ? `${state.device.toUpperCase()} · ` : ""}{Math.round(state.modelProgress)}%
              </div>
            </div>
          </Card>
        ) : (
          <>
            <div className="mb-3"><LevelMeter level={state.level} /></div>
            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ThreadView items={items} busy={chatBusy} live onQuote={onQuote} />
            </Card>
            {processing && (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted">
                <Spinner /> Finishing the record — diarizing speakers and writing notes…
              </div>
            )}
          </>
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
