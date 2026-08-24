"use client";

// Starting, watching and finishing a recording.

import { useState } from "react";
import { formatOffset } from "@ledgeur/core";
import { Badge, Button, Card, ErrorNote, Kicker } from "@ledgeur/ui/components";
import type { RecorderState } from "@/lib/useWebRecorder";
import { Transcript } from "./Transcript";
import { LANG_OPTIONS } from "@ledgeur/asr";

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
            <Kicker>New meeting</Kicker>
            <h2 className="ldg-display mt-2 text-[22px] text-ink-text">Record something.</h2>
            <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-muted">
              To capture everyone, share the meeting tab <em>with its audio</em>. To capture just
              yourself — an interview, a voice note, a talk — the microphone alone is enough.
            </p>

            <fieldset className="mt-5">
              <legend className="text-[13px] font-medium text-ink-text">Language</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {LANG_OPTIONS.map(({ value, label, hint }) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                      lang === value ? "border-accent bg-accent-soft" : "border-hairline hover:border-hairline-strong"
                    }`}
                  >
                    <input
                      type="radio" name="lang" value={value} checked={lang === value}
                      onChange={() => setLang(value)} className="sr-only"
                    />
                    <span className="block text-[13.5px] font-medium text-ink-text">{label}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted">{hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" onClick={() => onStart({ mic: true, system: true, lang })}>
                Record a meeting
              </Button>
              <Button size="lg" tone="secondary" onClick={() => onStart({ mic: true, system: false, lang })}>
                Microphone only
              </Button>
              <Button size="lg" tone="ghost" onClick={onPickFile}>
                Import a recording
              </Button>
            </div>
            <p className="mt-3 text-[12.5px] text-faint">
              The first recording downloads the speech model once (about 40 MB) and caches it. After
              that it works offline.{" "}
              <button
                type="button"
                onClick={() => onSample(lang)}
                className="font-medium text-accent-strong underline underline-offset-2"
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
              <span className="ldg-pulse inline-block h-2 w-2 rounded-full bg-accent" aria-hidden />
              <span className="text-[14.5px] text-ink-text">{state.step || "Starting up…"}</span>
            </div>
            <p className="mt-3 max-w-md text-[12.5px] leading-relaxed text-faint">
              Your browser is asking whether Ledgeur may use your microphone, and which window to
              listen to. Nothing is recorded until you say yes.
            </p>
          </div>
        )}

        {state.phase === "recording" && (
          <div>
            <div className="flex flex-wrap items-center gap-4">
              <span className="ldg-halo inline-block h-2.5 w-2.5 rounded-full bg-danger" aria-hidden />
              <span className="ldg-display text-[26px] tabular-nums text-ink-text">
                {formatOffset(state.elapsed * 1000)}
              </span>
              <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                <div
                  className="ldg-eq-bar h-full bg-accent"
                  style={{ width: `${Math.min(100, Math.round(state.level * 400))}%` }}
                />
              </div>
              {state.device && <Badge tone="neutral">{state.device}</Badge>}
            </div>
            {/* The model downloads while the meeting is already being captured,
                so this is progress on the transcript rather than a gate in front
                of the recording. */}
            {state.modelProgress > 0 && state.modelProgress < 100 && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-[12.5px] text-muted">
                  <span>Downloading the speech model — one time only</span>
                  <span className="font-mono tabular-nums">{state.modelProgress}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full bg-accent transition-[width] duration-300"
                    style={{ width: `${Math.max(4, state.modelProgress)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[12px] text-faint">
                  You are already being recorded — the transcript catches up as soon as this
                  finishes.
                </p>
              </div>
            )}

            <Button size="lg" tone="secondary" onClick={onStop} className="mt-5 w-full sm:w-auto">
              Stop and write it up
            </Button>
            <p className="mt-3 text-[12.5px] text-faint">
              Recording, transcribing and separating voices — all on this device. Nothing is being
              uploaded.
            </p>
          </div>
        )}

        {state.phase === "finishing" && (
          <div className="py-4">
            <div className="flex items-center gap-3">
              <span className="ldg-pulse inline-block h-2 w-2 rounded-full bg-glow" aria-hidden />
              <span className="text-[14.5px] text-ink-text">{state.step || "Finishing up…"}</span>
            </div>
            <p className="mt-3 text-[12.5px] text-faint">
              Working out who spoke takes a moment on a long meeting. The transcript is already safe.
            </p>
          </div>
        )}

        {state.phase === "done" && state.meetingId && (
          <div className="mt-5 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 text-[14px] text-accent-strong">
            Saved to your library. Open it to name the speakers — once you have, Ledgeur recognises
            them in every meeting after this one.
          </div>
        )}

        {state.error && (
          <ErrorNote className="mt-5">
            {state.error}
            {state.phase !== "recording" && (
              <div className="mt-2">
                <Button size="sm" tone="secondary" onClick={onReset}>Try again</Button>
              </div>
            )}
          </ErrorNote>
        )}

        {state.warning && !state.error && (
          <p className="mt-5 rounded-xl border border-warn/25 bg-warn-soft px-4 py-3 text-[13.5px] text-warn">
            {state.warning}
          </p>
        )}
      </Card>

      {(state.phase === "recording" || state.phase === "finishing" || state.segments.length > 0) && (
        <Card raised className="p-6">
          <div className="flex items-center justify-between">
            <Kicker>Live transcript</Kicker>
            {state.phase === "recording" && <span className="text-[12px] text-faint">Speakers are named when you stop</span>}
          </div>
          <Transcript
            meeting={{ segments: state.segments, speakers: [] }}
            editable={false}
            className="mt-3"
          />
        </Card>
      )}
    </div>
  );
}
