import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CircleDot, Square, Mic, MonitorSpeaker, Info, AlertCircle, CheckCircle2 } from "lucide-react";
import { formatElapsed } from "@parleynotes/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, Chip, Spinner } from "../components/ui.tsx";
import { LevelMeter } from "../components/recorder/LevelMeter.tsx";
import { LiveTranscript } from "../components/recorder/LiveTranscript.tsx";
import { MeetingChat } from "../components/recorder/MeetingChat.tsx";
import { useRecorder } from "../lib/useRecorder.ts";
import { finalizeMeeting } from "../lib/afterMeeting.ts";

export function Record() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [title, setTitle] = useState(params.get("title") ?? "");
  const [mic, setMic] = useState(true);
  const [system, setSystem] = useState(true);
  const [lang, setLang] = useState("en");
  const { state, start, stop, reset } = useRecorder(lang);
  const recording = state.status === "recording" || state.status === "processing";

  const transcriptText = () => state.segments.map((s) => s.text).join(" ");

  if (recording || state.status === "loading-model") {
    return (
      <div className="grid h-full grid-cols-[1fr_360px]">
        <div className="flex min-h-0 flex-col px-8 pt-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="pn-pulse flex h-3 w-3 rounded-full bg-danger" />
              <span className="text-lg font-semibold tracking-tight text-ink-text">
                {title || "Live meeting"}
              </span>
              <Chip tone="neutral"><span className="tabular-nums">{formatElapsed(state.elapsed)}</span></Chip>
            </div>
            {state.status === "recording" && (
              <Button variant="danger" onClick={() => void stop(title).then((id) => { if (id) { void finalizeMeeting(id); nav(`/meetings/${id}`); } })}>
                <Square className="h-4 w-4" fill="currentColor" /> Stop & save
              </Button>
            )}
          </div>

          {state.status === "loading-model" ? (
            <Card className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <Spinner className="h-6 w-6 text-accent-strong" />
              <div>
                <div className="text-sm font-medium text-ink-text">Loading the on-device model…</div>
                <div className="mt-1 text-xs text-muted">{state.device ? `Running on ${state.device.toUpperCase()}` : "Preparing"} · {Math.round(state.modelProgress)}%</div>
              </div>
            </Card>
          ) : (
            <>
              <div className="mb-3"><LevelMeter level={state.level} /></div>
              <Card className="min-h-0 flex-1 overflow-y-auto p-5">
                <LiveTranscript segments={state.segments} live />
              </Card>
            </>
          )}
          {state.error && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" /> {state.error}
            </div>
          )}
        </div>
        <div className="border-l border-hairline bg-surface/60">
          <MeetingChat getContext={() => [{ source: "Live transcript", text: transcriptText() }]} />
        </div>
      </div>
    );
  }

  if (state.status === "complete") {
    return (
      <Page>
        <PageHeader title="Meeting saved" />
        <Card className="flex flex-col items-center gap-4 p-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-accent-strong" />
          <div>
            <div className="text-base font-semibold text-ink-text">Notes are ready</div>
            <div className="mt-1 text-sm text-muted">Summary, decisions and action items were generated on-device.</div>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => state.meetingId && nav(`/meetings/${state.meetingId}`)}>Open meeting</Button>
            <Button variant="outline" onClick={reset}>New recording</Button>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Record a meeting" subtitle="Everything is transcribed on your device. No bot joins the call." />
      <Card className="p-6">
        <label className="mb-1.5 block text-sm font-medium text-ink-text">Meeting title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Weekly product sync"
          className="mb-6 w-full rounded-xl border border-hairline bg-surface px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />

        <div className="mb-6 grid grid-cols-2 gap-3">
          <SourceToggle icon={<Mic className="h-4 w-4" />} label="Microphone" hint="Your voice" on={mic} onChange={setMic} />
          <SourceToggle icon={<MonitorSpeaker className="h-4 w-4" />} label="System audio" hint="Everyone else on the call" on={system} onChange={setSystem} />
        </div>

        <div className="mb-6">
          <label className="mb-1.5 block text-sm font-medium text-ink-text">Language</label>
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-xl border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40">
            <option value="en">English · fast</option>
            <option value="en-hq">English · accurate</option>
            <option value="multi">Multilingual</option>
          </select>
        </div>

        <div className="mb-6 flex items-start gap-2 rounded-xl bg-accent-soft/60 px-3.5 py-3 text-xs text-accent-strong">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          Speaker diarization (who-said-what with confidence) runs in the native build's on-device engine. In the browser preview, transcript is captured without per-speaker labels.
        </div>

        <Button onClick={() => void start({ mic, system })} disabled={!mic && !system} className="w-full py-3">
          <CircleDot className="h-4 w-4" /> Start recording
        </Button>
      </Card>
    </Page>
  );
}

function SourceToggle({ icon, label, hint, on, onChange }: { icon: React.ReactNode; label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${on ? "border-accent bg-accent-soft/50" : "border-hairline bg-surface hover:bg-surface-muted"}`}
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${on ? "bg-accent text-white" : "bg-surface-muted text-muted"}`}>{icon}</span>
      <span>
        <span className="block text-sm font-medium text-ink-text">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}
