// The live meeting room: transcript being typeset on the left; on the right a
// rail with the brain (chat), your notes, and proactive suggestions. Recording
// state lives at app level, so leaving this screen does not stop the take.
import { useState } from "react";
import { Square, MessageCircleQuestion, PenLine, Lightbulb } from "lucide-react";
import { cn, formatElapsed } from "@parleynotes/ui";
import { Button, Card, ErrorNote, Spinner } from "../ui.tsx";
import { LevelMeter } from "./LevelMeter.tsx";
import { LiveTranscript } from "./LiveTranscript.tsx";
import { MeetingChat } from "./MeetingChat.tsx";
import { NotesPanel } from "./NotesPanel.tsx";
import { SuggestPanel } from "./SuggestPanel.tsx";
import { useRecorderCtx } from "../../lib/recorderContext.tsx";

const TABS = [
  { id: "chat", label: "Copilot", icon: MessageCircleQuestion },
  { id: "notes", label: "Notes", icon: PenLine },
  { id: "suggest", label: "Suggest", icon: Lightbulb },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function LiveMeeting({ onStop }: { onStop: () => void }) {
  const { state, title, setNotes } = useRecorderCtx();
  const [tab, setTab] = useState<TabId>("chat");
  const transcriptText = () => state.segments.map((s) => s.text).join(" ");
  const loading = state.status === "loading-model";
  const processing = state.status === "processing";

  return (
    <div className="grid h-full grid-rows-[auto_1fr] gap-4 px-5 pb-4 sm:px-8 lg:grid-cols-[1fr_370px] lg:grid-rows-1 lg:gap-6">
      <div className="flex min-h-0 flex-col">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="pn-halo flex h-3 w-3 shrink-0 rounded-full bg-danger" />
            <h1 className="pn-display min-w-0 truncate text-[22px] text-ink-text">{title || "Live meeting"}</h1>
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
            <Card className="min-h-0 flex-1 overflow-y-auto p-5">
              <LiveTranscript segments={state.segments} live />
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
        <div className="flex border-b border-hairline" role="tablist" aria-label="Meeting tools">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-[12.5px] font-medium transition-colors",
                tab === id ? "border-glow text-ink-text" : "border-transparent text-faint hover:text-muted",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {tab === "chat" && <MeetingChat getContext={() => [{ source: "Live transcript", text: transcriptText() }]} />}
          {tab === "notes" && <NotesPanel value={state.notes} onChange={setNotes} />}
          {tab === "suggest" && <SuggestPanel getTranscript={transcriptText} />}
        </div>
      </Card>
    </div>
  );
}
