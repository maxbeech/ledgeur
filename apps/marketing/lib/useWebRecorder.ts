"use client";

// The web app's recording engine.
//
// One hook owns the whole pipeline: capture → drain every few seconds →
// transcribe on-device → analyse the same slice for speakers → on stop, cluster
// the voices, name the ones this device recognises, write the notes, and save.
//
// Two properties matter more than anything else here:
//
//  1. **Nothing is ever lost.** A failure in the speaker models, the notes
//     generator or the database still saves the transcript. The recording is
//     the user's; a bug in our nice-to-haves must not cost them a meeting.
//  2. **Memory stays flat.** Audio is discarded as soon as it has been
//     transcribed and analysed. An hour-long meeting holds a few seconds of
//     audio and a list of small vectors, not 230 MB of Float32.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  resample, rms, WHISPER_SAMPLE_RATE, summarizeTranscript,
  deriveTitle, type AsrChunk, type AttributedSegment, type LocalMeeting, type StoredSpeaker,
} from "@ledgeur/core";
import {
  AudioCapture, TranscriberController, DiarizerController,
  listVoiceProfiles, putMeeting, type AnalysedSlice,
} from "@ledgeur/core/browser";

/** How often captured audio is handed to the models. Long enough that Whisper
 *  has real context to work with, short enough that the transcript feels live. */
const DRAIN_MS = 6000;
/** Slices quieter than this are skipped: a model pass on silence costs the same
 *  as one on speech, and Whisper invents words when given nothing. */
const SILENCE_RMS = 0.006;

export type RecorderPhase =
  | "idle"
  | "preparing"     // downloading / warming the speech model
  | "recording"
  | "finishing"     // clustering speakers, writing notes, saving
  | "done"
  | "error";

export interface RecorderState {
  phase: RecorderPhase;
  /** Seconds elapsed. */
  elapsed: number;
  /** Input level, 0–1, for the meter. */
  level: number;
  /** Model download progress, 0–100. */
  modelProgress: number;
  /** Which backend actually started ("WebGPU", "CPU", …). */
  device: string;
  /** The transcript so far. Speakers are assigned at the end. */
  segments: AttributedSegment[];
  /** What the app is doing during `finishing`. */
  step: string;
  error: string;
  /** Non-fatal: speakers could not be worked out, transcript is fine. */
  warning: string;
  /** Set once saved. */
  meetingId: string | null;
}

const IDLE: RecorderState = {
  phase: "idle", elapsed: 0, level: 0, modelProgress: 0, device: "",
  segments: [], step: "", error: "", warning: "", meetingId: null,
};

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

export function useWebRecorder(onSaved?: (meeting: LocalMeeting) => void) {
  const [state, setState] = useState<RecorderState>(IDLE);

  const capture = useRef<AudioCapture | null>(null);
  const transcriber = useRef<TranscriberController | null>(null);
  const diarizer = useRef<DiarizerController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const chunks = useRef<AsrChunk[]>([]);
  const slices = useRef<AnalysedSlice[]>([]);
  /** Speaker analyses still running. Awaited on stop so a meeting's last turns
   *  are clustered with the rest rather than arriving after the decision. */
  const analysing = useRef<Promise<unknown>[]>([]);
  const offsetSeconds = useRef(0);
  const startedAt = useRef("");
  const langRef = useRef("en");
  const busy = useRef(false);
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;

  const patch = useCallback((p: Partial<RecorderState>) => setState((s) => ({ ...s, ...p })), []);

  const teardown = useCallback(async () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    await capture.current?.stop();
    capture.current = null;
    transcriber.current?.dispose(); transcriber.current = null;
    diarizer.current?.dispose(); diarizer.current = null;
  }, []);

  useEffect(() => () => { void teardown(); }, [teardown]);

  /** Hand one slice of captured audio to the models. */
  const drain = useCallback(async () => {
    const cap = capture.current;
    const tr = transcriber.current;
    // Capture starts before the model does, deliberately — so there is a window
    // where audio is accumulating and there is nothing to transcribe it with.
    // Leaving it in the buffer is right: the next tick picks it up, and nothing
    // is lost.
    if (!cap || !tr || busy.current) return;
    const raw = cap.drainNew();
    if (raw.length === 0) return;

    const audio = resample(raw, cap.sampleRate, WHISPER_SAMPLE_RATE);
    const endSeconds = cap.totalSeconds();
    const from = offsetSeconds.current;
    offsetSeconds.current = endSeconds;
    if (rms(audio) < SILENCE_RMS) return;

    busy.current = true;
    // Both workers transfer the buffer they are given, so the diarizer needs
    // its own copy. Same audio, same clock, two questions.
    const forSpeakers = audio.slice();
    try {
      const { chunks: fresh, text } = await tr.transcribe(audio, langRef.current, from);
      const timed: AsrChunk[] = fresh.length
        ? fresh
        // A model that gave us words but no timings still gave us words. Place
        // them across the slice rather than dropping them.
        : (text.trim() ? [{ text: text.trim(), start: from, end: endSeconds }] : []);
      if (timed.length) {
        chunks.current = [...chunks.current, ...timed];
        setState((s) => ({
          ...s,
          segments: [
            ...s.segments,
            ...timed.map((c) => ({
              startMs: Math.round(c.start * 1000),
              endMs: Math.round((c.end ?? c.start) * 1000),
              text: c.text,
              speaker: null,
              confidence: null,
            })),
          ],
        }));
      }
    } catch (e) {
      // Set once, not once every six seconds: a model that cannot start fails
      // identically on every slice, and re-rendering the same sentence forever
      // reads as the app getting worse rather than as one problem.
      const message = (e as Error).message;
      setState((s) => (s.error === message ? s : { ...s, error: message }));
    } finally {
      busy.current = false;
    }

    // Speakers are analysed in the background: a slow or broken speaker model
    // must never delay, or damage, the transcript. The promise is kept so stop()
    // can wait for it — an analysis that lands after clustering has run is an
    // analysis that was thrown away.
    const analysis = diarizer.current?.analyse(forSpeakers, from)
      .then((slice) => { slices.current = [...slices.current, slice]; })
      .catch(() => { /* one skipped slice costs a little accuracy, nothing more */ });
    if (analysis) analysing.current = [...analysing.current, analysis];
  }, [patch]);

  /**
   * Drain everything left in the capture buffer, then wait for the models.
   *
   * `drain` refuses to run while a transcription is in flight, which is correct
   * during a meeting — the audio waits for the next tick. At the end there is no
   * next tick, so a single `drain()` on stop returns immediately and the last
   * several seconds of the meeting are discarded along with the capture. That is
   * a silent, unreproducible "the end got cut off" bug, so: wait our turn, drain
   * until the buffer is genuinely empty, then let the speaker analyses finish.
   */
  const flush = useCallback(async () => {
    const deadline = Date.now() + 60_000;
    // A drain leaves at most a moment's audio behind, so a few passes is
    // plenty; the deadline is only there so a wedged worker cannot hang the
    // save forever.
    while (Date.now() < deadline) {
      if (busy.current) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      const pending = capture.current?.pendingSamples() ?? 0;
      // Below a tenth of a second there is nothing a speech model can use.
      if (pending < WHISPER_SAMPLE_RATE / 10) break;
      await drain();
    }

    // The speaker analyses were started fire-and-forget so they could never
    // delay the transcript. Now they have to land, or the last turns of the
    // meeting are clustered without them.
    const outstanding = analysing.current;
    analysing.current = [];
    await Promise.allSettled(outstanding);
  }, [drain]);

  const start = useCallback(async (opts: { mic: boolean; system: boolean; lang?: string }) => {
    setState({ ...IDLE, phase: "preparing", step: "Waiting for permission…" });
    chunks.current = []; slices.current = []; analysing.current = []; offsetSeconds.current = 0;
    langRef.current = opts.lang ?? "en";
    startedAt.current = new Date().toISOString();

    try {
      // ── Permission first, model second ──────────────────────────────────
      // This used to be the other way round, and it was wrong twice over. The
      // model is a ~40 MB download, so somebody who was going to deny the
      // microphone waited a minute to find out; and while it downloaded, the
      // screen showed a progress bar for something the user had not asked
      // about yet. Asking first fails in the second it takes to click Block,
      // with a message that says what to do.
      //
      // Capturing before the model is ready is safe: audio accumulates in the
      // capture buffer, and the first transcription waits for the pipeline.
      const cap = new AudioCapture();
      cap.onLevel = (level) => patch({ level });
      cap.onSystemAudioEnded = () => patch({
        warning: "Screen sharing stopped, so the other people in the meeting are no longer being recorded. Your microphone is still on.",
      });
      await cap.start({ mic: opts.mic, system: opts.system });
      capture.current = cap;

      // Recording from here on. The model download runs behind it.
      patch({ phase: "recording", step: "" });
      timer.current = setInterval(() => {
        patch({ elapsed: cap.totalSeconds() });
        void drain();
      }, DRAIN_MS);

      const tr = new TranscriberController({
        onDevice: (device, info) => patch({ device: info?.label ?? device }),
        onProgress: (_f, p) => patch({ modelProgress: p }),
      });
      transcriber.current = tr;

      // Not awaited: the speaker models are tens of megabytes and are not
      // needed until the meeting ends.
      const dz = new DiarizerController();
      diarizer.current = dz;
      void dz.preload().catch(() => { /* reported at the end, if it matters */ });

      try {
        await tr.preloadAndWait(langRef.current);
        patch({ modelProgress: 100 });
      } catch (e) {
        // The meeting is already being captured, so this is not fatal to the
        // recording — but it is fatal to the transcript, and saying so now is
        // better than letting somebody record an hour of nothing.
        patch({ error: (e as Error).message });
      }
    } catch (e) {
      await teardown();
      patch({ phase: "error", error: (e as Error).message, step: "" });
    }
  }, [drain, patch, teardown]);

  const stop = useCallback(async (): Promise<LocalMeeting | null> => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    patch({ phase: "finishing", step: "Transcribing the last few seconds…" });

    await flush();
    const durationSec = capture.current?.totalSeconds() ?? 0;
    await capture.current?.stop();
    capture.current = null;

    if (chunks.current.length === 0) {
      await teardown();
      patch({ phase: "error", error: "Nothing was recorded — no speech was picked up. Check that the right microphone is selected, or that you ticked “share audio” when sharing the tab." });
      return null;
    }

    // Speakers. Every failure here degrades to an unlabelled transcript.
    patch({ step: "Working out who was speaking…" });
    let segments: AttributedSegment[] = chunks.current.map((c) => ({
      startMs: Math.round(c.start * 1000),
      endMs: Math.round((c.end ?? c.start) * 1000),
      text: c.text,
      speaker: null,
      confidence: null,
    }));
    let speakers: StoredSpeaker[] = [];
    let warning = "";

    try {
      const profiles = await listVoiceProfiles();
      const diarized = DiarizerController.assemble(chunks.current, slices.current, { profiles });
      if (diarized.speakers.length > 0) {
        segments = diarized.segments;
        speakers = diarized.speakers.map((s) => ({
          speaker: s.speaker,
          label: s.label,
          profileId: s.profileId,
          confidence: s.confidence,
          speakingSeconds: s.speakingSeconds,
          // Kept so this voice can still be named next week, from the library.
          embedding: s.embedding,
        }));
      }
      warning = diarized.warning ?? "";
    } catch (e) {
      warning = (e as Error).message;
    }

    patch({ step: "Writing the notes…", segments, warning });

    const transcript = segments.map((s) => s.text).join(" ");
    const notes = summarizeTranscript(transcript);
    const now = new Date().toISOString();
    const meeting: LocalMeeting = {
      id: uid(),
      title: "",
      startedAt: startedAt.current || now,
      endedAt: now,
      durationSec,
      lang: langRef.current,
      source: "recording",
      sourceName: null,
      segments,
      speakers,
      notes,
      manualNotes: "",
      remoteId: null,
      updatedAt: now,
    };
    meeting.title = deriveTitle(meeting);

    try {
      await putMeeting(meeting);
    } catch (e) {
      // The meeting is still in memory and on screen; say so rather than
      // pretending it saved.
      patch({ phase: "error", error: `The meeting could not be saved to this browser's storage (${(e as Error).message}). Copy the transcript before you leave this page.` });
      await teardown();
      return meeting;
    }

    await teardown();
    patch({ phase: "done", meetingId: meeting.id, step: "" });
    savedRef.current?.(meeting);
    return meeting;
  }, [flush, patch, teardown]);

  const reset = useCallback(() => {
    void teardown();
    chunks.current = []; slices.current = []; analysing.current = []; offsetSeconds.current = 0;
    setState(IDLE);
  }, [teardown]);

  return { state, start, stop, reset };
}
