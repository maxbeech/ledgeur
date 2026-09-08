// The live recording engine as a React hook. Drives capture → utterance
// segmentation → on-device transcription → live transcript segments, then
// generates notes on stop and persists the meeting locally. Mounted once at app
// level (see recorderContext.tsx) so a recording survives navigating between
// screens.
//
// Two transcription backends: the native engine (whisper.cpp + sherpa-onnx
// diarization, when the app is built with `--features native-ai` and models are
// downloaded) or the webview engine (transformers.js, via the process-wide
// pipeline in asrEngine.ts).
//
// ── Shape of the loop ───────────────────────────────────────────────────────
// Capture and transcription are two independent loops, not one:
//
//   pump()       every PUMP_MS, cheap: move PCM out of AudioCapture (and the
//                native tap) into the segmenter, and update the clock.
//   transcribe   a self-rescheduling loop that takes whole utterances from the
//                segmenter and runs the model over them, one at a time.
//
// They were one loop before, on a 5-second `setInterval` that fired whether or
// not the previous pass had finished — so a slow chunk started a backlog that
// only ever grew, and the transcript fell further behind for the rest of the
// meeting. Splitting them means capture can never be starved by a slow model,
// and the model is never asked to run two passes at once.
//
// Recording also does not wait for the model. Capture starts and the meeting UI
// appears immediately; audio banks up in the segmenter and is transcribed as
// soon as a pipeline is live. Nothing is lost, and "Start recording" is instant
// even on the very first launch, when the model genuinely is still downloading.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  resample, WHISPER_SAMPLE_RATE, rms, concatFloat32, mixFloat32, notesToMarkdown,
  defaultSpeakerLabel, UtteranceSegmenter, attributeSpeakers, speakersFromTurns,
  turnsToMeetingClock, type AsrChunk, type AudioSpan,
} from "@ledgeur/core";
import { AudioCapture, DiarizerController, listVoiceProfiles, type AnalysedSlice } from "@ledgeur/core/browser";
import {
  aiStatus, nativeTranscribeChunk, nativeDiarizeMeeting, onDiarizeProgress, resetLiveSpeakers,
  type NativeSegment,
} from "./nativeAI.ts";
import { saveMeeting, type LocalMeeting, type LocalSegment, type LocalSpeaker, type ChatMessage } from "./meetingsStore.ts";
import { autoLabelSpeakers } from "./speakerNames.ts";
import { generateMeetingNotes } from "./notes.ts";
import { getSettings } from "./settings.ts";
import { setAudioLevel } from "./audioLevel.ts";
import { ensureTranscriber, ensureDiarizer, getEngineStatus } from "./asrEngine.ts";
import { isSystemAudioTapAvailable, SystemAudioTap } from "./systemAudioTap.ts";
import { createLogger } from "./logger.ts";
import {
  EMPTY_TRANSCRIPT_WARNING, emptyTranscriptInitial, onEmptySlice, onTranscribedSlice,
} from "./emptyTranscript.ts";

const log = createLogger("recorder");

export type RecorderStatus = "idle" | "recording" | "processing" | "complete" | "error";

/** Where the speech pipeline is, shown inline rather than as a blocking screen. */
export type ModelPhase = "loading" | "ready" | "failed";

export interface RecorderState {
  status: RecorderStatus; elapsed: number; modelProgress: number;
  modelPhase: ModelPhase;
  device: string; segments: LocalSegment[]; error: string; meetingId: string | null;
  /** Notes the user types during the meeting — merged into the final summary. */
  notes: string;
  /** Seconds of captured audio not yet transcribed. Surfaced once it's large
   *  enough to be worth admitting to. */
  backlogSeconds: number;
  /**
   * Identifies the current take. Changes on every `start()`.
   *
   * Anything that has to be cleared when a new recording begins keys off this
   * rather than inferring it. The meeting copilot used to infer it from "we are
   * recording AND the model is still loading" — true only on a cold start, so
   * once the model began staying warm between recordings a second meeting
   * opened with the first one's conversation still in it.
   */
  takeId: string;
  /**
   * Whether the other people in the room/call are actually being recorded.
   *
   * "I turned on system audio, is it doing anything?" was unanswerable from the
   * UI: the toggle only expressed an intent, and both ways of honouring it (the
   * native Core Audio tap, and getDisplayMedia) can fail after the recording has
   * already started, at which point the meeting quietly continued mic-only.
   *
   *   off     — not requested
   *   tap     — native system-audio tap running (no screen-share prompt)
   *   shared  — captured via the screen-share picker instead
   *   failed  — requested, and neither route worked; only this device's mic
   */
  systemAudio: "off" | "tap" | "shared" | "failed";
  /**
   * True once non-silent system audio has actually arrived. The distinction
   * from `systemAudio` matters: the tap starts happily on a call where nobody
   * else has joined yet, or where output is muted, and reports success while
   * delivering nothing but zeroes.
   */
  systemAudioHeard: boolean;
  /**
   * What the post-meeting pass is doing, and how far in — mirrored from the
   * native engine. Writing up a long meeting is minutes of work; with no signal
   * at all it is indistinguishable from the app having hung, which is exactly
   * how it was reported.
   */
  processingPhase: string;
  /** 0–100 within `processingPhase`. */
  processingProgress: number;
}

/** How often captured PCM is moved into the segmenter. Cheap — no model runs. */
const PUMP_MS = 250;
const SILENCE_RMS = 0.006;
const MAX_DIARIZE_SAMPLES = 45 * 60 * WHISPER_SAMPLE_RATE; // cap full-audio retention (~45 min)
/** Backlog past which the transcript is visibly behind and we say so. */
const BACKLOG_WARN_SECONDS = 45;
/** How long stop() waits for outstanding speaker analysis before giving up on
 *  it — see the comment at the call site. */
const DIARIZE_WAIT_TIMEOUT_MS = 15_000;
/** Ceiling on the final catch-up pass, so Stop is bounded even mid-backlog. */
const FINAL_TRANSCRIBE_BUDGET_MS = 20_000;
/**
 * How long to wait before retrying a speech pipeline that failed to start.
 *
 * The engine deliberately does not cache a failure — the cause is usually
 * fixable and the next recording should get a clean attempt. That is right at
 * the granularity of a recording and wrong at the granularity of this loop,
 * which would otherwise re-walk the whole load plan several times a second for
 * the rest of the meeting.
 */
const ENGINE_RETRY_MS = 30_000;
/**
 * Cap on undrained audio. Reached only when the model cannot keep up for
 * minutes on end; past it the oldest audio is dropped (loudly) rather than
 * growing the heap until the app dies mid-meeting — ~5 minutes at 16 kHz mono
 * is about 19 MB.
 */
const MAX_BACKLOG_SECONDS = 300;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
// An empty label means "nobody has worked out who this is", and the transcript
// renders it without a speaker chip. The engine returns null for exactly that
// case rather than guessing — see `speaker_label` in nativeAI.ts.
const toLocal = (s: NativeSegment, offsetMs: number): LocalSegment => ({
  id: uid(), speakerLabel: s.speaker_label ?? "", startMs: offsetMs + s.start_ms, endMs: offsetMs + s.end_ms,
  text: s.text, confidence: s.confidence, speakerConfidence: s.speaker_confidence,
});

export function useRecorder(getThreadMessages?: () => ChatMessage[]) {
  const [state, setState] = useState<RecorderState>({
    status: "idle", elapsed: 0, modelProgress: 0, modelPhase: "loading", device: "",
    segments: [], error: "", meetingId: null, notes: "", backlogSeconds: 0, takeId: "",
    systemAudio: "off", systemAudioHeard: false, processingPhase: "", processingProgress: 0,
  });
  const capture = useRef<AudioCapture | null>(null);
  /** Latched once real (non-silent) system audio has been seen — see pump(). */
  const systemAudioHeard = useRef(false);
  /** Set only when the native Core Audio tap is supplying "system" audio
   *  instead of getDisplayMedia — see start(). */
  const systemTap = useRef<SystemAudioTap | null>(null);
  /** Borrowed from asrEngine — never disposed here. */
  const diarizer = useRef<DiarizerController | null>(null);
  /** Cuts the capture into whole utterances; see @ledgeur/core segmenter.ts. */
  const segmenter = useRef<UtteranceSegmenter | null>(null);
  /** Timed transcript pieces, accumulated across drains for the webview path. */
  const asrChunks = useRef<AsrChunk[]>([]);
  /** The voices found in this meeting, with the vectors that identify them, so
   *  one can be named later from the library. */
  const speakers = useRef<LocalSpeaker[]>([]);
  /** One entry per analysed slice: turns and voice vectors, never audio. */
  const slices = useRef<AnalysedSlice[]>([]);
  const pumpTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const segments = useRef<LocalSegment[]>([]);
  const startedAt = useRef<string>("");
  const native = useRef(false);
  const lang = useRef(getSettings().transcriptionLang);
  /** Note template for this meeting, captured at start so changing the
   *  preference mid-meeting cannot re-frame notes already being written. */
  const template = useRef(getSettings().noteTemplate);
  const notesRef = useRef("");
  const threadRef = useRef<(() => ChatMessage[]) | undefined>(getThreadMessages);
  threadRef.current = getThreadMessages;
  const fullAudio = useRef<Float32Array[]>([]);
  const fullLen = useRef(0);
  /**
   * Where each retained utterance sits in `fullAudio` and where it sits in the
   * meeting — the two are not the same clock.
   *
   * Utterances the silence gate rejects are never appended, so `fullAudio` is
   * the meeting with its quiet parts cut out. The speaker pass reads that
   * buffer and reports turns against it; the transcript is on the meeting
   * clock. Without this mapping the two are out by the length of every silence
   * so far, and the pass would attribute each line to whoever was talking some
   * minutes later. See `turnsToMeetingClock` in @ledgeur/core.
   */
  const audioSpans = useRef<AudioSpan[]>([]);
  const capExceeded = useRef(false); // true once we stop retaining full audio (>cap)
  const statusRef = useRef<RecorderStatus>("idle");
  /** True while a model pass is in flight, so only one ever runs at a time. */
  const transcribing = useRef(false);
  /**
   * Set the moment stop() begins, to take the live drain loop off the audio.
   *
   * Clearing the pump interval was not enough. `pumpTranscription` is a loop
   * that keeps taking utterances until the segmenter is empty, and its only
   * exit condition was the status leaving "recording" *or* "processing" — which
   * stop() immediately sets to "processing". So a pass already in flight when
   * Stop was pressed carried on chewing through the entire backlog, in
   * parallel with stop()'s own budgeted drain and then with the speaker pass,
   * competing for the same cores. On a machine already minutes behind, that is
   * a large amount of work arriving at exactly the moment the user is waiting.
   */
  const stopping = useRef(false);
  /** When the failed pipeline was last retried — see ENGINE_RETRY_MS. */
  const lastEngineRetry = useRef(0);
  const elapsedShown = useRef(-1);
  const backlogShown = useRef(0);
  /** Diagnostics for "audio was captured but nothing was transcribed": counts so
   *  a silent failure of the speech model is distinguishable from an actually
   *  quiet room, both in the logs and, past a few in a row, as a visible note
   *  rather than a transcript that's just empty at the end. */
  const silentDrains = useRef(0);
  const emptyTranscript = useRef(emptyTranscriptInitial());
  /** Loudest utterance seen all meeting, so an empty transcript can be told
   *  apart from a genuinely-quiet capture (mic/permission/device problem)
   *  rather than staying a total mystery — see the warning logged in stop(). */
  const peakRms = useRef(0);

  const patch = (p: Partial<RecorderState>) => setState((s) => {
    const next = { ...s, ...p };
    statusRef.current = next.status;
    return next;
  });

  const setNotes = useCallback((text: string) => {
    notesRef.current = text;
    patch({ notes: text });
  }, []);

  /** Speaker analyses still running, awaited on stop so a meeting's last turns
   *  are clustered with the rest rather than landing after the decision. */
  const analysing = useRef<Promise<unknown>[]>([]);

  /**
   * Move captured PCM into the segmenter. Deliberately does no model work: it
   * runs on a fixed interval and must never be able to fall behind.
   */
  const pump = useCallback(() => {
    const cap = capture.current;
    const seg = segmenter.current;
    if (!cap || !seg) return;

    const raw = cap.drainNew();
    // AudioCapture's clock (see clockOnly in capture.ts) keeps ticking even with
    // nothing connected to it, so `raw` alone can legitimately be empty when the
    // native system-audio tap is the only source — mix in whatever it has before
    // deciding there's nothing to push.
    let audio = raw.length ? resample(raw, cap.sampleRate, WHISPER_SAMPLE_RATE) : new Float32Array(0);
    const tap = systemTap.current;
    if (tap) {
      const tapRaw = tap.drainNew();
      if (tapRaw.length) {
        // Latch the first time the tap delivers something that isn't silence.
        // It reports success on a call nobody else has joined, or with output
        // muted, while handing over nothing but zeroes — so "the tap started"
        // is not the same claim as "the other people are being recorded", and
        // only the second one is worth showing anyone.
        if (!systemAudioHeard.current && rms(tapRaw) >= SILENCE_RMS) {
          systemAudioHeard.current = true;
          patch({ systemAudioHeard: true });
        }
        audio = mixFloat32(audio, resample(tapRaw, tap.sampleRate, WHISPER_SAMPLE_RATE));
      }
    }
    if (audio.length) seg.push(audio);

    // Re-render at most once a second for the clock, and only when the backlog
    // crosses the threshold where it's worth mentioning.
    const elapsed = Math.floor(cap.totalSeconds());
    const backlog = seg.pendingSeconds;
    const showBacklog = backlog >= BACKLOG_WARN_SECONDS ? Math.round(backlog) : 0;
    if (elapsed !== elapsedShown.current || showBacklog !== backlogShown.current) {
      elapsedShown.current = elapsed;
      backlogShown.current = showBacklog;
      patch({ elapsed, backlogSeconds: showBacklog });
    }
  }, []);

  /** Run the model over one utterance and fold the result into the transcript. */
  const transcribeOne = useCallback(async (audio: Float32Array, startSample: number, endSample: number) => {
    const startMs = Math.round((startSample / WHISPER_SAMPLE_RATE) * 1000);
    const endMs = Math.round((endSample / WHISPER_SAMPLE_RATE) * 1000);
    const level = rms(audio);
    if (level > peakRms.current) peakRms.current = level;
    if (level < SILENCE_RMS) { silentDrains.current++; return; }

    try {
      if (native.current) {
        const segs = await nativeTranscribeChunk(audio);
        if (segs.length) {
          segments.current = [...segments.current, ...segs.map((s) => toLocal(s, startMs))];
          patch({ segments: segments.current });
        }
        if (fullLen.current < MAX_DIARIZE_SAMPLES) {
          // Recorded before the append, so `atMs` is this utterance's offset in
          // the retained buffer rather than the next one's.
          audioSpans.current.push({
            atMs: Math.round((fullLen.current / WHISPER_SAMPLE_RATE) * 1000),
            durationMs: Math.round((audio.length / WHISPER_SAMPLE_RATE) * 1000),
            meetingMs: startMs,
          });
          fullAudio.current.push(audio);
          fullLen.current += audio.length;
        } else { capExceeded.current = true; }
        return;
      }

      const transcriber = await ensureTranscriber(lang.current);
      // The buffer is transferred to whichever worker gets it first, so the
      // diarizer gets its own copy. Both run against the same slice, on the
      // same clock.
      const forSpeakers = audio.slice();
      const offsetSeconds = startSample / WHISPER_SAMPLE_RATE;

      const { text, chunks } = await transcriber.transcribe(audio, lang.current, offsetSeconds);
      if (chunks.length) asrChunks.current = [...asrChunks.current, ...chunks];
      else if (text.trim()) {
        // A model that returned no timings still returned words. Place them
        // across the slice rather than losing them.
        asrChunks.current = [...asrChunks.current, { text: text.trim(), start: offsetSeconds, end: endMs / 1000 }];
      }
      if (text.trim()) {
        segments.current = [...segments.current, {
          // Unattributed, not "Speaker 1". Nothing has looked at who is talking
          // yet on this path — the speaker models run when the meeting ends —
          // and labelling every line with the same name made a room full of
          // people read as one person. The line gets its real speaker below.
          id: uid(), speakerLabel: "", startMs, endMs,
          text: text.trim(), confidence: null, speakerConfidence: null,
        }];
        patch({ segments: segments.current });
        // Words are coming back, so retract the warning below rather than leave
        // it contradicting the live "transcribing Ns behind" line.
        const done = onTranscribedSlice(emptyTranscript.current);
        emptyTranscript.current = done.state;
        if (done.retract) patch({ error: "" });
      } else {
        // Audible audio (it passed the silence gate) that the model transcribed
        // as nothing. Once in a while that's just noise or a breath; several in
        // a row with real audio and zero words back is how "recorded fine,
        // transcript came out empty" happens silently — surface it instead of
        // only finding out at the end.
        const empty = onEmptySlice(emptyTranscript.current);
        emptyTranscript.current = empty.state;
        log.warn("non-silent audio produced no transcript", { streak: empty.state.streak });
        if (empty.show) patch({ error: EMPTY_TRANSCRIPT_WARNING });
      }

      // Speakers are worked out in the background: a slow or failing speaker
      // model must never hold up, or break, the transcript. It is started only
      // once the transcription of the same slice has returned, so the two never
      // contend for the GPU — that contention was itself a large part of why
      // the live transcript lagged.
      const dz = diarizer.current;
      if (dz) {
        const analysis = dz.analyse(forSpeakers, offsetSeconds)
          .then((slice) => { slices.current = [...slices.current, slice]; })
          .catch((e: unknown) => log.warn("speaker analysis skipped for a slice", e));
        analysing.current = [...analysing.current, analysis];
      }
    } catch (e) {
      log.error("transcription chunk failed", e);
      patch({ error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  /**
   * Take whatever whole utterances are ready and transcribe them in order.
   *
   * Guarded by `transcribing` so only one model pass is ever in flight: a second
   * concurrent pass does not go faster, it just splits the same GPU two ways and
   * makes both late.
   */
  const pumpTranscription = useCallback(async (): Promise<void> => {
    if (transcribing.current) return;
    const seg = segmenter.current;
    if (!seg) return;

    // A pipeline that failed to start would otherwise be retried on every tick,
    // re-walking the whole load plan several times a second. Back off — but keep
    // capturing, and keep retrying occasionally, because the cause is often
    // transient.
    if (!native.current && getEngineStatus().phase === "failed") {
      if (Date.now() - lastEngineRetry.current < ENGINE_RETRY_MS) return;
      lastEngineRetry.current = Date.now();
    }

    transcribing.current = true;
    try {
      for (;;) {
        // Shed the oldest audio if the backlog has become unbounded. Saying so
        // in the log matters: a gap in the transcript with no explanation is
        // indistinguishable from the model silently returning nothing.
        while (seg.pendingSeconds > MAX_BACKLOG_SECONDS) {
          const dropped = seg.take();
          if (!dropped) break;
          log.warn("dropped audio the transcriber could not keep up with", {
            seconds: Math.round(dropped.audio.length / WHISPER_SAMPLE_RATE),
            backlogSeconds: Math.round(seg.pendingSeconds),
          });
        }
        const next = seg.take();
        if (!next) break;
        await transcribeOne(next.audio, next.startSample, next.endSample);
        // stop() drains the rest itself, on a budget. Two loops pulling from
        // one segmenter is not twice the throughput, it is the same work split
        // across contending model passes.
        if (stopping.current) break;
        if (statusRef.current !== "recording" && statusRef.current !== "processing") break;
      }
    } finally {
      transcribing.current = false;
    }
  }, [transcribeOne]);

  const start = useCallback(async (opts: { mic: boolean; system: boolean; lang?: string; template?: string }) => {
    log.info("start requested", opts);
    try {
      segments.current = []; fullAudio.current = []; fullLen.current = 0; audioSpans.current = [];
      capExceeded.current = false;
      asrChunks.current = []; slices.current = []; analysing.current = []; speakers.current = [];
      silentDrains.current = 0; emptyTranscript.current = emptyTranscriptInitial(); peakRms.current = 0;
      transcribing.current = false; stopping.current = false; lastEngineRetry.current = 0;
      // Speaker numbering is per-meeting; without this a new recording opens
      // already believing it recognises the last meeting's voices.
      void resetLiveSpeakers();
      elapsedShown.current = -1; backlogShown.current = 0;
      lang.current = opts.lang ?? getSettings().transcriptionLang;
      template.current = opts.template ?? getSettings().noteTemplate;
      notesRef.current = "";
      startedAt.current = new Date().toISOString();
      segmenter.current = new UtteranceSegmenter();
      systemAudioHeard.current = false;
      patch({
        status: "recording", error: "", segments: [], elapsed: 0, meetingId: null, notes: "",
        backlogSeconds: 0, modelPhase: "loading", modelProgress: 0, device: "", takeId: uid(),
        systemAudio: opts.system ? "tap" : "off", systemAudioHeard: false,
      });

      // getDisplayMedia/getUserMedia must be requested while the click that
      // triggered `start` is still "live" — a browser's user-activation window
      // is spent by the first await, and an IPC round-trip to the native engine
      // (aiStatus, below) is more than enough to burn through it. So capture is
      // opened first, before anything else async, and everything that can wait
      // happens after. The one exception is this tap-availability check: it has
      // to be known *before* deciding whether AudioCapture should even attempt
      // getDisplayMedia, and unlike aiStatus it's a single fast local IPC call
      // (a compiled-in bool, not a real status query).
      const useNativeSystemAudio = opts.system && await isSystemAudioTapAvailable();
      const cap = new AudioCapture();
      cap.onLevel = setAudioLevel;
      await cap.start({
        mic: opts.mic,
        system: opts.system && !useNativeSystemAudio,
        clockOnly: useNativeSystemAudio && !opts.mic,
      });
      capture.current = cap;

      if (opts.system && !useNativeSystemAudio) patch({ systemAudio: "shared" });

      if (useNativeSystemAudio) {
        const tap = new SystemAudioTap();
        try {
          await tap.start();
          systemTap.current = tap;
          patch({ systemAudio: "tap" });
        } catch (e) {
          // `available()` on macOS answers yes without probing — there is no
          // cheap honest way to ask — so this is the first point at which an
          // unsupported OS version or a refused permission actually shows up,
          // and AudioCapture was already told to skip getDisplayMedia. Retry
          // through the screen-share route rather than silently recording
          // without the other side of the call, which is what used to happen.
          log.error("native system-audio tap failed to start, trying screen share", e);
          try {
            await cap.stop();
            await cap.start({ mic: opts.mic, system: true });
            patch({ systemAudio: "shared", error: "" });
            log.info("system audio fell back to the screen-share picker");
          } catch (fallbackError) {
            log.error("screen-share fallback also failed", fallbackError);
            // Whatever happens, capture has to be running: a meeting recording
            // only this device's mic still beats one recording nothing. With the
            // mic off too there is nothing left to fall back to, and saying so
            // is the only honest option — the alternative is a running clock
            // over a recording of silence.
            const micOnly = opts.mic && await cap.start({ mic: true, system: false }).then(() => true, () => false);
            patch({
              systemAudio: "failed",
              error: micOnly
                ? "Couldn't capture the other people in this meeting. Only your microphone is being recorded."
                : "Couldn't start recording: neither your microphone nor the other people's audio is available.",
            });
          }
        }
      }

      // Recording is live from here: the clock runs, audio banks up, and the UI
      // is already showing the meeting. Everything below only decides how that
      // audio gets turned into text.
      pumpTimer.current = setInterval(() => {
        pump();
        void pumpTranscription();
      }, PUMP_MS);
      log.info("capture started");

      const status = await aiStatus();
      native.current = Boolean(status?.compiled && status?.models_ready);
      if (native.current) {
        patch({ device: "whisper.cpp (native)", modelPhase: "ready", modelProgress: 100 });
        return;
      }

      // Not awaited by the caller and not blocking the recording: the shared
      // pipeline usually resolves instantly (the warmup at app launch already
      // built it — see asrEngine.ts), and on a cold first run it resolves when
      // the download does, at which point the banked audio is transcribed in
      // order. Either way the user is already recording.
      void ensureTranscriber(lang.current)
        .then(() => patch({ modelPhase: "ready", modelProgress: 100, device: getEngineStatus().device }))
        .catch((e: unknown) => patch({
          modelPhase: "failed",
          error: e instanceof Error ? e.message : String(e),
        }));
      // Progress/device are mirrored from the engine while it loads.
      void trackEngineProgress(patch);

      // Speaker models are only needed when the meeting ends, so this never
      // gates anything.
      void ensureDiarizer()
        .then((dz) => { diarizer.current = dz; })
        .catch((e: unknown) => log.warn("speaker models unavailable", e));
    } catch (e) {
      log.error("start failed", e);
      patch({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [pump, pumpTranscription]);

  const stop = useCallback(async (title: string): Promise<string | null> => {
    log.info("stop requested", { title, segments: segments.current.length });
    if (pumpTimer.current) { clearInterval(pumpTimer.current); pumpTimer.current = null; }
    // Take the live loop off the audio before doing anything else, and let a
    // pass already in flight finish rather than racing it — see `stopping`.
    stopping.current = true;
    patch({ status: "processing" });
    for (let i = 0; transcribing.current && i < 100; i++) await delay(50);

    // Take one last pass over the capture buffers, then stop the sources. The
    // tap is stopped before the final pump so nothing it delivered in the
    // closing moments is left behind with it.
    pump();
    if (systemTap.current) {
      await systemTap.current.stop();
      pump();
      systemTap.current = null;
    }
    await capture.current?.stop();
    capture.current = null;
    pump();

    // Whatever is still buffered, transcribed on a budget. Unbounded catch-up is
    // what made "Finishing the record" sit there for minutes: on a machine that
    // had fallen behind, Stop was where the entire backlog came due at once.
    // Bounded, the tail of a long backlog is missing from the transcript — but
    // the meeting saves promptly and everything already transcribed is kept.
    const seg = segmenter.current;
    if (seg) {
      const deadline = Date.now() + FINAL_TRANSCRIBE_BUDGET_MS;
      for (;;) {
        const next = seg.take() ?? seg.flush();
        if (!next) break;
        await transcribeOne(next.audio, next.startSample, next.endSample);
        if (Date.now() > deadline) {
          if (seg.pendingSeconds > 1) {
            log.warn("stopped transcribing the backlog at the time budget", {
              remainingSeconds: Math.round(seg.pendingSeconds),
            });
          }
          break;
        }
      }
    }
    segmenter.current = null;

    // The speaker analyses were deliberately not awaited during the meeting, so
    // a backlog can build up if the speaker models can't keep up with real time
    // — waiting for ALL of it here is what made "Finishing the record" hang for
    // minutes on a longer meeting. Bounded instead: whatever hasn't landed by
    // the timeout is left out of clustering (diarization is already non-fatal —
    // see diarizer.ts — an unlabelled turn beats a stuck Stop).
    const outstanding = analysing.current;
    analysing.current = [];
    await Promise.race([Promise.allSettled(outstanding), delay(DIARIZE_WAIT_TIMEOUT_MS)]);

    // Native: re-run the whole meeting for real speaker diarization + labels.
    // Only when we retained the FULL audio — if the meeting exceeded the
    // retention cap we keep the complete live transcript instead of overwriting
    // it with a diarized prefix (which would silently drop the tail).
    // The retained audio, once the native pass has joined it up. Empty on the
    // webview path, which never keeps the whole recording — there, a speaker's
    // voice print comes from the vectors the diarizer produced instead.
    let retained: Float32Array = new Float32Array(0);
    if (native.current && fullLen.current > 0 && !capExceeded.current) {
      // Report what the pass is doing while it runs. This is real work on a long
      // meeting, and it used to be entirely silent — the engine emits progress
      // now, and showing it is the difference between "still going" and "the app
      // has hung", which is how it was reported.
      //
      // The pass separates speakers and puts names to the ones this device
      // recognises; it does NOT re-transcribe. It used to, and that was the
      // single most expensive thing the app did: 228 s to re-transcribe 99 s of
      // audio on an M1 Pro, before the speaker work had even started, to arrive
      // at approximately the words the live pass had already produced from the
      // same model and the same audio. The transcript the user watched appear is
      // the transcript they keep; only the names on it change.
      patch({ processingPhase: "separating speakers", processingProgress: 0 });
      const unlisten = await onDiarizeProgress((p) =>
        patch({ processingPhase: p.phase, processingProgress: p.percent }),
      );
      try {
        // Joined once and kept: the same buffer is what the voice samples are
        // cut out of below, and a one-hour meeting is not worth concatenating
        // twice.
        retained = concatFloat32(fullAudio.current);
        const turns = await nativeDiarizeMeeting(retained);
        if (turns.length) {
          const attributed = turnsToMeetingClock(
            turns.map((t) => ({
              startMs: t.start_ms, endMs: t.end_ms, label: t.label, confidence: t.confidence,
            })),
            audioSpans.current,
          );
          segments.current = attributeSpeakers(segments.current, attributed);
          // No `embedding`: the native pass returns turns, not voice vectors.
          // An empty array would look like one and quietly poison any later
          // cosine match, so the field is left absent, which it is allowed to be.
          speakers.current = speakersFromTurns(attributed).map((sp) => ({
            label: sp.label, confidence: sp.confidence, speakingSeconds: sp.speakingSeconds,
          }));
          patch({ segments: segments.current });
        }
      } catch (e) {
        log.error("speaker pass failed, keeping the live transcript", e);
      } finally {
        unlisten();
        patch({ processingPhase: "writing the notes", processingProgress: 0 });
      }
    }

    // Webview: cluster everything the speaker models saw during the meeting, and
    // put a name on anyone this device already recognises. Nothing here is
    // allowed to fail the meeting — a transcript with "Speaker 1" on every line
    // is still a transcript, and it is already saved below either way.
    if (!native.current && slices.current.length > 0 && asrChunks.current.length > 0) {
      try {
        const profiles = await listVoiceProfiles();
        const diarized = DiarizerController.assemble(asrChunks.current, slices.current, { profiles });
        if (diarized.segments.length > 0 && diarized.speakers.length > 0) {
          const names = new Map(diarized.speakers.map((sp) => [sp.speaker, sp]));
          speakers.current = diarized.speakers.map((sp) => ({
            label: sp.label,
            confidence: sp.confidence,
            embedding: sp.embedding,
            speakingSeconds: sp.speakingSeconds,
          }));
          segments.current = diarized.segments.map((seg2) => {
            const speaker = seg2.speaker == null ? null : names.get(seg2.speaker);
            return {
              id: uid(),
              speakerLabel: speaker?.label ?? defaultSpeakerLabel(seg2.speaker ?? 0),
              startMs: seg2.startMs,
              endMs: seg2.endMs,
              text: seg2.text,
              confidence: seg2.confidence,
              speakerConfidence: speaker?.confidence ?? null,
            };
          });
          patch({ segments: segments.current });
        }
        if (diarized.warning) log.warn("speaker labels unavailable", diarized.warning);
      } catch (e) {
        log.error("speaker clustering failed, keeping the unlabelled transcript", e);
      }
    }

    // Who are these people? The on-device model reads the transcript for
    // introductions and greetings, and names the voices it can prove. Every
    // name it applies is marked as a guess, carries the line it came from, and
    // is one click to change — see speakerNames.ts. Nothing here can fail the
    // meeting: no model, a slow model or a model that ignored the contract all
    // leave the transcript exactly as it was, with numbered speakers.
    if (segments.current.length > 1) {
      patch({ processingPhase: "identifying speakers", processingProgress: 0 });
      const named = await autoLabelSpeakers({
        segments: segments.current,
        speakers: speakers.current,
        audio: retained,
        spans: audioSpans.current,
      });
      segments.current = named.segments;
      speakers.current = named.speakers;
      if (named.applied.length) patch({ segments: segments.current });
      if (named.error) log.info("speaker names were not inferred", { reason: named.error });
      patch({ processingPhase: "writing the notes", processingProgress: 0 });
    }

    const transcript = segments.current.map((s) => s.text).join(" ");
    if (!transcript.trim()) {
      // An empty transcript is either an actually-silent recording or a
      // silently-failed one — these counts are the only way to tell which after
      // the fact, since neither one throws.
      log.warn("meeting ended with an empty transcript", {
        silentDrains: silentDrains.current, emptyResultStreak: emptyTranscript.current.streak, native: native.current,
        // peakRms well under SILENCE_RMS means capture itself picked up
        // near-nothing all meeting (mic/permission/input-device problem, not
        // a transcription bug); comfortably above it means real speech was
        // captured but never turned into text (a pipeline problem instead).
        peakRms: peakRms.current, silenceThreshold: SILENCE_RMS, durationSeconds: Math.round((Date.now() - Date.parse(startedAt.current)) / 1000),
      });
    }
    const manualNotes = notesRef.current.trim();
    // Notes are written by the on-device model from the transcript AND whatever
    // the user typed during the meeting, falling back to the local heuristic
    // extractor when no model is available.
    // Passed as segments, not as the flat `transcript` string: the notes writer
    // needs the speaker labels and timestamps to attribute anything.
    const notes = await generateMeetingNotes(segments.current, manualNotes, template.current);
    // The copilot/user thread is saved with the meeting only when the user opts
    // in — by default just the spoken transcript is kept.
    const saveChat = getSettings().saveChatWithMeeting;
    const messages = saveChat ? threadRef.current?.() ?? [] : [];
    const id = uid();
    const now = new Date().toISOString();
    const meeting: LocalMeeting = {
      id, title: title || "Untitled meeting", createdAt: now, startedAt: startedAt.current, endedAt: now,
      status: "complete", lang: lang.current, segments: segments.current,
      speakers: speakers.current.length ? speakers.current : undefined,
      summary: notes.summary, decisions: notes.decisions, questions: notes.questions, actionItems: notes.actionItems,
      manualNotes,
      messages: messages.length ? messages : undefined,
      noteMarkdown: notesToMarkdown(title || "Untitled meeting", now.slice(0, 10), notes, transcript, manualNotes),
      wordCount: notes.wordCount, notesGenerator: notes.generator, synced: false, updatedAt: now,
      templateId: template.current,
    };
    await saveMeeting(meeting, "none");
    // The pipeline is process-wide and deliberately NOT disposed here: disposing
    // it is what made every recording after the first pay a full model reload.
    diarizer.current = null;
    fullAudio.current = []; fullLen.current = 0; audioSpans.current = [];
    asrChunks.current = []; slices.current = []; analysing.current = []; speakers.current = [];
    setAudioLevel(0);
    patch({ status: "complete", meetingId: id });
    log.info("recording saved", { meetingId: id, segments: meeting.segments.length, wordCount: notes.wordCount });
    return id;
  }, [pump, transcribeOne]);

  const reset = useCallback(() => {
    if (pumpTimer.current) { clearInterval(pumpTimer.current); pumpTimer.current = null; }
    void capture.current?.stop();
    void systemTap.current?.stop();
    capture.current = null; systemTap.current = null; diarizer.current = null; segmenter.current = null;
    segments.current = []; fullAudio.current = []; fullLen.current = 0; audioSpans.current = [];
    notesRef.current = "";
    asrChunks.current = []; slices.current = []; analysing.current = [];
    statusRef.current = "idle";
    transcribing.current = false; stopping.current = false;
    setAudioLevel(0);
    systemAudioHeard.current = false;
    setState({
      status: "idle", elapsed: 0, modelProgress: 0, modelPhase: "loading", device: "",
      segments: [], error: "", meetingId: null, notes: "", backlogSeconds: 0, takeId: "",
      systemAudio: "off", systemAudioHeard: false, processingPhase: "", processingProgress: 0,
    });
  }, []);

  // Provider-level teardown (app close): stop capture and timers so nothing
  // leaks. The speech pipeline is intentionally left alive — it belongs to the
  // process, not to this hook. During normal navigation the provider stays
  // mounted; if this fires while still "recording", something remounted
  // RecorderProvider unexpectedly (e.g. a Fast Refresh full-reload) and the
  // recording is being cut short — log loudly so that's diagnosable instead of
  // a silent reset.
  useEffect(() => () => {
    if (pumpTimer.current) clearInterval(pumpTimer.current);
    if (statusRef.current === "recording") log.warn("recorder unmounted mid-recording — capture stopped");
    void capture.current?.stop();
    void systemTap.current?.stop();
  }, []);

  return { state, start, stop, reset, setNotes };
}

/**
 * Mirror the shared engine's load progress onto the recorder's state while a
 * pipeline is coming up, so the meeting header can show it inline.
 *
 * Polled rather than subscribed because it only matters during the seconds
 * around a cold start, and it must stop on its own once the load settles.
 */
function trackEngineProgress(patch: (p: Partial<RecorderState>) => void): void {
  const tick = () => {
    const engine = getEngineStatus();
    patch({ modelProgress: engine.progress, device: engine.device });
    if (engine.phase === "loading") setTimeout(tick, 400);
  };
  tick();
}
