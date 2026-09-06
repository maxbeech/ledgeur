"use client";

// Starting, watching and finishing a recording.

import { useState } from "react";
import { formatOffset } from "@ledgeur/core";
import { Badge, Button, Card, ErrorNote, Label, Notice, ProgressBar, Select } from "@ledgeur/ui/components";
import { cn } from "@ledgeur/ui";
import type { RecorderState } from "@/lib/useWebRecorder";
import { Transcript } from "./Transcript";
import { LANG_OPTIONS, SPOKEN_LANGUAGES } from "@ledgeur/asr";

// The options come from the load plan itself (packages/asr/asr-plan.js, served
// as /asr-plan.js), so a value this picker offers is always a rung the worker
// can actually load. Offering one it cannot silently falls back to English.

export function RecordPanel({
  state, onStart, onStop, onReset, onPickFile, onSample,
}: {
  state: RecorderState;
  onStart: (opts: { mic: boolean; system: boolean; lang: string }) => void;
  onStop: () => void;
  onReset: () => void;
  onPickFile: () => void;
  onSample: (lang: string) => void;
}) {
  const [lang, setLang] = useState("en");
  const idle = state.phase === "idle" || state.phase === "error" || state.phase === "done";

  return (
    <div className="space-y-5">
      <Card raised className="p-6">
        {idle && (
          <>
            <h2 className="ldg-display text-2xl text-ink-text">Record something.</h2>
            <p className="mt-2 max-w-lg text-base leading-relaxed text-muted">
              To capture everyone, share the meeting tab <em>with its audio</em>. To capture just
              yourself — an interview, a voice note, a talk — the microphone alone is enough.
            </p>

            {/* Three cards, not one per language. LANG_OPTIONS carries a
                value for every spoken language too (see asr-plan.js), and
                rendering all of them here would be thirty-five radio cards.
                The tier is the choice; which language is a detail of one of
                them, so it only appears once that tier is picked. */}
            <fieldset className="mt-6">
              <legend className="text-sm font-semibold text-ink-text">Language</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {LANG_OPTIONS.filter((o) => !o.value.includes(":")).map(({ value, label, hint }) => {
                  const on = value === "multi" ? lang.startsWith("multi") : lang === value;
                  return (
                    <label
                      key={value}
                      className={cn(
                        "cursor-pointer rounded-xl border p-3.5 transition-colors",
                        on ? "border-brand bg-brand-soft/50" : "border-hairline-strong hover:bg-surface-muted",
                      )}
                    >
                      <input type="radio" name="lang" value={value} checked={on} onChange={() => setLang(value)} className="sr-only" />
                      <span className="block text-base font-semibold text-ink-text">{label}</span>
                      <span className="mt-0.5 block text-sm leading-snug text-muted">{hint}</span>
                    </label>
                  );
                })}
              </div>
              {lang.startsWith("multi") && (
                <div className="mt-3">
                  <label htmlFor="spoken-lang" className="block text-sm text-muted">
                    Which language? Saying so is more accurate than letting the model work it out —
                    and it is the only way to stop a meeting that starts in English and continues in
                    another language coming back as invented English.
                  </label>
                  <Select id="spoken-lang" value={lang} onChange={(e) => setLang(e.target.value)} className="mt-2 max-w-xs">
                    <option value="multi">Let the model detect it</option>
                    {SPOKEN_LANGUAGES.map((l) => (
                      <option key={l.code} value={`multi:${l.code}`}>
                        {l.label}{l.tier === "fair" ? " — workable" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </fieldset>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" onClick={() => onStart({ mic: true, system: true, lang })} className="rounded-full">
                Record a meeting
              </Button>
              <Button size="lg" tone="secondary" onClick={() => onStart({ mic: true, system: false, lang })} className="rounded-full">
                Microphone only
              </Button>
              <Button size="lg" tone="ghost" onClick={onPickFile} className="rounded-full">
                Import a recording
              </Button>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-faint">
              The first recording downloads the speech model once (about 40 MB) and caches it. After
              that it works offline.{" "}
              <button
                type="button"
                onClick={() => onSample(lang)}
                className="font-medium text-brand-strong underline underline-offset-2"
              >
                Or try it on a sample clip first
              </button>
              {" "}— real audio, through the real models, so you can see what it produces before
              trusting it with a meeting.
            </p>
          </>
        )}

        {state.phase === "preparing" && (
          <div className="py-4">
            <div className="flex items-center gap-3">
              <span className="ldg-pulse inline-block h-2 w-2 rounded-full bg-brand" aria-hidden />
              <span className="text-md text-ink-text">{state.step || "Starting up"}</span>
            </div>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-faint">
              Your browser is asking whether Ledgeur may use your microphone, and which window to
              listen to. Nothing is recorded until you say yes.
            </p>
          </div>
        )}

        {state.phase === "recording" && (
          <div>
            <div className="flex flex-wrap items-center gap-4">
              <span className="ldg-halo inline-block h-3 w-3 rounded-full bg-danger-fill" aria-hidden />
              <span className="ldg-display ldg-num text-3xl text-ink-text">
                {formatOffset(state.elapsed * 1000)}
              </span>
              <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                <div
                  className="ldg-eq-bar h-full rounded-full bg-accent"
                  style={{ width: `${Math.min(100, Math.round(state.level * 400))}%` }}
                />
              </div>
              {state.device && <Badge>{state.device}</Badge>}
            </div>
            {/* The model downloads while the meeting is already being captured,
                so this is progress on the transcript rather than a gate in front
                of the recording. */}
            {state.modelProgress > 0 && state.modelProgress < 100 && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-sm text-muted">
                  <span>Downloading the speech model — one time only</span>
                  <span className="ldg-num">{state.modelProgress}%</span>
                </div>
                <ProgressBar value={state.modelProgress} className="mt-1.5" />
                <p className="mt-1.5 text-xs text-faint">
                  You are already being recorded — the transcript catches up as soon as this finishes.
                </p>
              </div>
            )}

            <Button size="lg" tone="danger" onClick={onStop} className="mt-5 w-full rounded-full sm:w-auto">
              Stop and write it up
            </Button>
            <p className="mt-3 text-sm text-faint">
              Recording, transcribing and separating voices — all on this device. Nothing is being uploaded.
            </p>
          </div>
        )}

        {state.phase === "finishing" && (
          <div className="py-4">
            <div className="flex items-center gap-3">
              <span className="ldg-pulse inline-block h-2 w-2 rounded-full bg-brand" aria-hidden />
              <span className="text-md text-ink-text">{state.step || "Finishing up"}</span>
            </div>
            <p className="mt-3 text-sm text-faint">
              Working out who spoke takes a moment on a long meeting. The transcript is already safe.
            </p>
          </div>
        )}

        {state.phase === "done" && state.meetingId && (
          <Notice tone="accent" className="mt-5">
            Saved to your library. Open it to name the speakers — once you have, Ledgeur recognises
            them in every meeting after this one.
          </Notice>
        )}

        {state.error && (
          <ErrorNote className="mt-5" onRetry={state.phase !== "recording" ? <Button size="sm" tone="secondary" onClick={onReset}>Try again</Button> : undefined}>
            {state.error}
          </ErrorNote>
        )}

        {state.warning && !state.error && (
          <Notice tone="warn" className="mt-5">{state.warning}</Notice>
        )}
      </Card>

      {(state.phase === "recording" || state.phase === "finishing" || state.segments.length > 0) && (
        <Card raised className="p-6">
          <div className="flex items-center justify-between">
            <Label>Live transcript</Label>
            {state.phase === "recording" && <span className="text-xs text-faint">Speakers are named when you stop</span>}
          </div>
          <Transcript
            meeting={{ segments: state.segments, speakers: [] }}
            editable={false}
            className="mt-4"
          />
        </Card>
      )}
    </div>
  );
}
