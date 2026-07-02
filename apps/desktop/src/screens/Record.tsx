// Record: pre-flight composer → live meeting (LiveMeeting) → saved confirmation.
// Recorder state lives at app level, so an in-flight recording is picked up
// again whenever the user returns to this screen.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CircleDot, Mic, MonitorSpeaker, Info, CheckCircle2 } from "lucide-react";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, ErrorNote } from "../components/ui.tsx";
import { LiveMeeting } from "../components/recorder/LiveMeeting.tsx";
import { useRecorderCtx } from "../lib/recorderContext.tsx";
import { finalizeMeeting } from "../lib/afterMeeting.ts";
import { isTauri } from "../lib/runtime.ts";

export function Record() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { state, start, stop, reset, title, setTitle } = useRecorderCtx();
  const [mic, setMic] = useState(true);
  const [system, setSystem] = useState(() => isTauri()); // browser preview: mic-only default
  const [lang, setLang] = useState("en");

  // A calendar prompt can pre-fill the title (?title=…), but never mid-take.
  const paramTitle = params.get("title");
  useEffect(() => {
    if (paramTitle && state.status === "idle") setTitle(paramTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramTitle]);

  if (state.status === "recording" || state.status === "processing" || state.status === "loading-model") {
    return (
      <LiveMeeting
        onStop={() => void stop(title).then((id) => { if (id) { void finalizeMeeting(id); nav(`/meetings/${id}`); } })}
      />
    );
  }

  if (state.status === "complete") {
    return (
      <Page>
        <Card className="pn-rise mx-auto mt-10 flex max-w-md flex-col items-center gap-4 p-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-accent-strong" />
          <div>
            <div className="pn-display text-[20px] text-ink-text">The record is written</div>
            <div className="mt-1 text-sm text-muted">Summary, decisions and action items were generated on-device{state.notes.trim() ? " — with your notes woven in" : ""}.</div>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => state.meetingId && nav(`/meetings/${state.meetingId}`)}>Open meeting</Button>
            <Button variant="outline" onClick={() => { reset(); setTitle(""); }}>New recording</Button>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        kicker="New entry"
        title="Record a meeting"
        subtitle="Transcribed on your device as it happens. No bot joins the call; nothing leaves the machine."
      />
      <div className="pn-stagger mx-auto max-w-2xl">
        <Card className="p-6 sm:p-8">
          <label htmlFor="rec-title" className="pn-kicker mb-2 block">Title</label>
          <input
            id="rec-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Weekly product sync"
            className="pn-display mb-7 w-full border-b border-hairline bg-transparent pb-2 text-[22px] text-ink-text outline-none transition-colors placeholder:text-faint/60 focus:border-ink/40"
          />

          <div className="mb-6 grid gap-3 sm:grid-cols-2">
            <SourceToggle icon={<Mic className="h-4 w-4" />} label="Microphone" hint="Your voice" on={mic} onChange={setMic} />
            <SourceToggle icon={<MonitorSpeaker className="h-4 w-4" />} label="System audio" hint="Everyone else on the call" on={system} onChange={setSystem} />
          </div>

          <div className="mb-7">
            <label htmlFor="rec-lang" className="pn-kicker mb-2 block">Language</label>
            <select
              id="rec-lang"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="rounded-xl border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
            >
              <option value="en">English · fast</option>
              <option value="en-hq">English · accurate</option>
              <option value="multi">Multilingual</option>
            </select>
          </div>

          <Button variant="accent" size="lg" onClick={() => void start({ mic, system, lang })} disabled={!mic && !system} className="w-full">
            <CircleDot className="h-4 w-4" /> Start recording
          </Button>

          {state.error && <ErrorNote className="mt-4">{state.error}</ErrorNote>}

          <div className="mt-6 flex items-start gap-2 text-[12px] leading-relaxed text-faint">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Who-said-what (with confidence) comes from the native on-device engine. In the browser preview, the transcript is captured without per-speaker labels — never guessed.
          </div>
        </Card>
      </div>
    </Page>
  );
}

function SourceToggle({ icon, label, hint, on, onChange }: { icon: React.ReactNode; label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150 ${on ? "border-accent/50 bg-accent-soft/50" : "border-hairline bg-surface hover:bg-surface-muted/60"}`}
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${on ? "bg-accent-strong text-white" : "bg-surface-muted text-muted"}`}>{icon}</span>
      <span>
        <span className="block text-sm font-medium text-ink-text">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}
