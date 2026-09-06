// Record: pre-flight → the live room (LiveMeeting) → saved. Recorder state
// lives at app level, so an in-flight recording is picked up again whenever
// the person returns to this screen.
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Mic, MonitorSpeaker, CheckCircle2, Upload, Info } from "lucide-react";
import { LANG_OPTIONS, SPOKEN_LANGUAGES } from "@ledgeur/asr";
import { cn } from "@ledgeur/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, ErrorNote, Field, ProgressBar, Select } from "../components/ui.tsx";
import { LiveMeeting } from "../components/recorder/LiveMeeting.tsx";
import { RecordDot } from "../components/RecordDot.tsx";
import { useRecorderCtx } from "../lib/useRecorderCtx.ts";
import { finalizeMeeting } from "../lib/afterMeeting.ts";
import { useFileImport, IMPORT_ACCEPT } from "../lib/useFileImport.ts";
import { isSystemAudioTapAvailable } from "../lib/systemAudioTap.ts";
import { useSetting, setSetting, hasChosenSystemAudio } from "../lib/settings.ts";
import { usePickableTemplates, templateFor } from "../lib/recipes.ts";
import { useDevice } from "../lib/platform.ts";

export function Record() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const { phone } = useDevice();
  const { state, start, stop, reset, title, setTitle } = useRecorderCtx();
  const [mic, setMic] = useState(true);
  // Persisted preferences rather than component state: the model warmed at
  // app launch has to be the one the next recording asks for, or "warming up"
  // achieves nothing and the recording pays a full reload.
  const system = useSetting("captureSystemAudio");
  const lang = useSetting("transcriptionLang");
  const setSystem = (v: boolean) => setSetting("captureSystemAudio", v);
  const setLang = (v: string) => setSetting("transcriptionLang", v);
  const template = useSetting("noteTemplate");
  const setTemplate = (v: string) => setSetting("noteTemplate", v);
  // With the native Core Audio tap (macOS 14.2+) there is no picker, no video
  // and no screen-recording indicator — just a one-time OS permission — so
  // capturing the other side of the call is the sensible default. Where the
  // tap isn't available the only route is the screen-share picker, which is
  // far too heavy to turn on for someone. A phone has neither: it hears the
  // room through its microphone.
  const [systemTapAvailable, setSystemTapAvailable] = useState(false);
  useEffect(() => {
    if (phone) return;
    void isSystemAudioTapAvailable().then((available) => {
      setSystemTapAvailable(available);
      if (available && !hasChosenSystemAudio()) setSetting("captureSystemAudio", true, "default");
    });
  }, [phone]);
  const templates = usePickableTemplates();
  const importer = useFileImport();
  const fileInput = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // A calendar prompt can pre-fill the title (?title=…), but never mid-take.
  const paramTitle = params.get("title");
  useEffect(() => {
    if (paramTitle && state.status === "idle") setTitle(paramTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramTitle]);

  // Home's "Import a recording" lands here with #import.
  useEffect(() => {
    if (hash === "#import") importRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [hash]);

  if (state.status === "recording" || state.status === "processing") {
    return (
      <LiveMeeting
        onStop={() => void stop(title).then((id) => { if (id) { void finalizeMeeting(id); nav(`/meetings/${id}`); } })}
      />
    );
  }

  if (state.status === "complete") {
    return (
      <Page>
        <Card raised className="mx-auto mt-10 flex max-w-md flex-col items-center gap-4 p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <div>
            <div className="text-xl font-semibold text-ink-text">Saved</div>
            <p className="mt-1 text-sm text-muted">Summary, decisions and action items were written on this device{state.notes.trim() ? ", with your notes woven in" : ""}.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => state.meetingId && nav(`/meetings/${state.meetingId}`)}>Open the meeting</Button>
            <Button tone="secondary" onClick={() => { reset(); setTitle(""); }}>Record another</Button>
          </div>
        </Card>
      </Page>
    );
  }

  const usesSystem = !phone && system;

  return (
    <Page>
      <PageHeader
        title="Record"
        subtitle="Transcribed on this device as it happens. No bot joins the call; nothing leaves the machine."
      />
      <div className="mx-auto max-w-2xl space-y-4">
        <Card raised className="p-5 sm:p-7">
          <input
            id="rec-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What is this meeting?"
            aria-label="Meeting title"
            className="ldg-display mb-6 w-full bg-transparent text-2xl text-ink-text outline-none placeholder:text-faint"
          />

          <div className={cn("mb-5 grid gap-3", !phone && "sm:grid-cols-2")}>
            <SourceToggle icon={<Mic className="h-4 w-4" />} label="Microphone" hint={phone ? "The room, through this phone" : "Your voice"} on={mic} onChange={setMic} />
            {!phone && (
              <SourceToggle
                icon={<MonitorSpeaker className="h-4 w-4" />}
                label="System audio"
                hint={systemTapAvailable ? "Everyone else on the call" : "Needs screen-recording permission"}
                on={system}
                onChange={setSystem}
              />
            )}
          </div>
          {usesSystem && (
            <p className="-mt-3 mb-5 text-xs leading-relaxed text-faint">
              {systemTapAvailable
                ? "Captured straight from Core Audio: a one-time audio-only permission the first time, then no picker, " +
                  "no screen sharing and no recording indicator. Your screen is never read."
                : "This build falls back to Screen Recording permission and a share picker — the only way a webview " +
                  "can hear the other side of a call. Only the audio is used; nothing is saved or shown from your screen."}
            </p>
          )}

          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            {/* Grouped rather than one flat list of thirty-odd: English and
                "detect it" are what almost everyone wants. */}
            <Field label="Language" htmlFor="rec-lang" hint={langHint(lang)}>
              <Select id="rec-lang" value={lang} onChange={(e) => setLang(e.target.value)}>
                <optgroup label="English">
                  {LANG_OPTIONS.filter((o) => o.value.startsWith("en")).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Multilingual">
                  <option value="multi">Detect the language</option>
                </optgroup>
                <optgroup label="Say which language">
                  {SPOKEN_LANGUAGES.map((l) => (
                    <option key={l.code} value={`multi:${l.code}`}>
                      {l.label}{l.tier === "fair" ? " — workable" : ""}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </Field>
            {/* A sales call and a 1:1 produce very different notes from the
                same transcript, and which one you wanted cannot be recovered
                afterwards. */}
            <Field label="Notes style" htmlFor="rec-template" hint={templateFor(template).description}>
              <Select id="rec-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          </div>

          <Button size="lg" onClick={() => void start({ mic, system: usesSystem, lang, template })} disabled={!mic && !usesSystem} className="w-full">
            <RecordDot /> Start recording
          </Button>

          {state.error && <ErrorNote className="mt-4">{state.error}</ErrorNote>}

          <div className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-faint">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Who said what is worked out on this device. Name a voice once and it is recognised in every meeting after that.
          </div>
        </Card>

        {/* Importing a recording you already have. A dropped file goes through
            the same pipeline as a live meeting and lands in the same library. */}
        <div
          ref={importRef}
          onDragOver={(e) => {
            if (!Array.from(e.dataTransfer.types).includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void importer.importFile(file, lang).then((id) => { if (id) nav(`/meetings/${id}`); });
          }}
        >
          <Card className={cn("border-dashed p-5 transition-colors", dragging ? "border-brand bg-brand-soft/40" : "border-hairline-strong")}>
            <input
              ref={fileInput}
              type="file"
              accept={IMPORT_ACCEPT}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importer.importFile(file, lang).then((id) => { if (id) nav(`/meetings/${id}`); });
              }}
            />

            {importer.state.busy ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="ldg-pulse h-2 w-2 shrink-0 rounded-full bg-brand" />
                  <div className="min-w-0">
                    <div className="truncate text-base font-medium text-ink-text">{importer.state.name}</div>
                    <div className="text-xs text-muted">{importer.state.step}</div>
                  </div>
                </div>
                {importer.state.progress > 0 && importer.state.progress < 100 && (
                  <ProgressBar value={importer.state.progress} className="mt-3" />
                )}
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-ink-text">Already have a recording?</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    {phone ? "Choose a file — a voice memo, a call export, an interview." : "Drop it here — a voice memo, a Zoom export, an old interview."} It is transcribed and its
                    speakers separated exactly like a live meeting.
                  </p>
                </div>
                <Button tone="secondary" onClick={() => fileInput.current?.click()}>
                  <Upload className="h-4 w-4" /> Choose a file
                </Button>
              </div>
            )}

            {importer.state.error && (
              <ErrorNote className="mt-4" onRetry={<Button size="sm" tone="secondary" onClick={importer.dismiss}>Dismiss</Button>}>
                {importer.state.error}
              </ErrorNote>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}

/**
 * What choosing this language actually means, in a sentence.
 *
 * Naming the language is not cosmetic: left to detect, Whisper decides from the
 * first thirty seconds, and a meeting that opens in English small talk and
 * continues in another language comes back as fluent, entirely invented
 * English — with no error anywhere. Worth saying out loud at the point of
 * choosing.
 */
function langHint(lang: string): string {
  const spoken = SPOKEN_LANGUAGES.find((l) => `multi:${l.code}` === lang);
  if (spoken) {
    return spoken.tier === "strong"
      ? `The multilingual model, told to expect ${spoken.label}. More accurate than letting it guess.`
      : `The multilingual model, told to expect ${spoken.label}. Workable, but check names and numbers — this is one of the harder languages for it.`;
  }
  if (lang === "multi") {
    return "The model works out the language from the first half-minute. If you know it, pick it — a meeting that starts in one language and continues in another is the case this gets wrong.";
  }
  return LANG_OPTIONS.find((o) => o.value === lang)?.hint ?? "";
}

function SourceToggle({ icon, label, hint, on, onChange }: { icon: React.ReactNode; label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors duration-150",
        on ? "border-brand bg-brand-soft/50" : "border-hairline-strong bg-surface hover:bg-surface-muted",
      )}
    >
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg transition-colors", on ? "bg-brand text-white" : "bg-surface-muted text-muted")}>{icon}</span>
      <span>
        <span className="block text-base font-semibold text-ink-text">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}
