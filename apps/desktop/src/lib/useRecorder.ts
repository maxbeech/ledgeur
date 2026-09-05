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
  defaultSpeakerLabel, UtteranceSegmenter, type AsrChunk,
} from "@ledgeur/core";
import { AudioCapture, DiarizerController, listVoiceProfiles, type AnalysedSlice } from "@ledgeur/core/browser";
import { aiStatus, nativeTranscribeChunk, nativeTranscribeDiarize, type NativeSegment } from "./nativeAI.ts";
import { saveMeeting, type LocalMeeting, type LocalSegment, type LocalSpeaker, type ChatMessage } from "./meetingsStore.ts";
import { generateMeetingNotes } from "./notes.ts";
import { getSettings } from "./settings.ts";
import { setAudioLevel } from "./audioLevel.ts";
import { ensureTranscriber, ensureDiarizer, getEngineStatus } from "./asrEngine.ts";
import { isSystemAudioTapAvailable, SystemAudioTap } from "./systemAudioTap.ts";
import { createLogger } from "./logger.ts";

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
const toLocal = (s: NativeSegment, offsetMs: number): LocalSegment => ({
  id: uid(), speakerLabel: s.speaker_label, startMs: offsetMs + s.start_ms, endMs: offsetMs + s.end_ms,
  text: s.text, confidence: s.confidence, speakerConfidence: s.speaker_confidence,
});

export function useRecorder(getThreadMessages?: () => ChatMessage[]) {
  const [state, setState] = useState<RecorderState>({
    status: "idle", elapsed: 0, modelProgress: 0, modelPhase: "loading", device: "",
    segments: [], error: "", meetingId: null, notes: "", backlogSeconds: 0,
  });
  const capture = useRef<AudioCapture | null>(null);
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
  const capExceeded = useRef(false); // true once we stop retaining full audio (>cap)
  const statusRef = useRef<RecorderStatus>("idle");
  /** True while a model pass is in flight, so only one ever runs at a time. */
  const transcribing = useRef(false);
  /** When the failed pipeline was last retried — see ENGINE_RETRY_MS. */
  const lastEngineRetry = useRef(0);
  const elapsedShown = useRef(-1);
  const backlogShown = useRef(0);
  /** Diagnostics for "audio was captured but nothing was transcribed": counts so
   *  a silent failure of the speech model is distinguishable from an actually
   *  quiet room, both in the logs and, past a few in a row, as a visible note
   *  rather than a transcript that's just empty at the end. */
  const silentDrains = useRef(0);
  const emptyResultStreak = useRef(0);
  const emptyResultWarned = useRef(false);

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
      if (tapRaw.length) audio = mixFloat32(audio, resample(tapRaw, tap.sampleRate, WHISPER_SAMPLE_RATE));
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
    if (rms(audio) < SILENCE_RMS) { silentDrains.current++; return; }

    try {
      if (native.current) {
        const segs = await nativeTranscribeChunk(audio);
        if (segs.length) {
          segments.current = [...segments.current, ...segs.map((s) => toLocal(s, startMs))];
          patch({ segments: segments.current });
        }
        if (fullLen.current < MAX_DIARIZE_SAMPLES) { fullAudio.current.push(audio); fullLen.current += audio.length; }
        else { capExceeded.current = true; }
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
          id: uid(), speakerLabel: defaultSpeakerLabel(0), startMs, endMs,
          text: text.trim(), confidence: null, speakerConfidence: null,
        }];
        patch({ segments: segments.current });
        emptyResultStreak.current = 0;
      } else {
        // Audible audio (it passed the silence gate) that the model transcribed
        // as nothing. Once in a while that's just noise or a breath; several in
        // a row with real audio and zero words back is how "recorded fine,
        // transcript came out empty" happens silently — surface it instead of
        // only finding out at the end.
        emptyResultStreak.current++;
        log.warn("non-silent audio produced no transcript", { streak: emptyResultStreak.current });
        if (emptyResultStreak.current >= 3 && !emptyResultWarned.current) {
          emptyResultWarned.current = true;
          patch({ error: "Audio is being picked up, but the speech model isn't returning any text. The recording is continuing — if the transcript is still empty at the end, try again or restart the app." });
        }
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
        if (statusRef.current !== "recording" && statusRef.current !== "processing") break;
      }
    } finally {
      transcribing.current = false;
    }
  }, [transcribeOne]);

  const start = useCallback(async (opts: { mic: boolean; system: boolean; lang?: string; template?: string }) => {
    log.info("start requested", opts);
    try {
      segments.current = []; fullAudio.current = []; fullLen.current = 0; capExceeded.current = false;
      asrChunks.current = []; slices.current = []; analysing.current = []; speakers.current = [];
      silentDrains.current = 0; emptyResultStreak.current = 0; emptyResultWarned.current = false;
      transcribing.current = false; lastEngineRetry.current = 0;
      elapsedShown.current = -1; backlogShown.current = 0;
      lang.current = opts.lang ?? getSettings().transcriptionLang;
      template.current = opts.template ?? getSettings().noteTemplate;
      notesRef.current = "";
      startedAt.current = new Date().toISOString();
      segmenter.current = new UtteranceSegmenter();
      patch({
        status: "recording", error: "", segments: [], elapsed: 0, meetingId: null, notes: "",
        backlogSeconds: 0, modelPhase: "loading", modelProgress: 0, device: "",
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

      if (useNativeSystemAudio) {
        const tap = new SystemAudioTap();
        try {
          await tap.start();
          systemTap.current = tap;
        } catch (e) {
          // AudioCapture was deliberately told to skip getDisplayMedia above, so
          // there's no fallback left to try here — surface it rather than
          // silently recording without the other side of the call.
          log.error("native system-audio tap failed to start", e);
          patch({ error: e instanceof Error ? e.message : String(e) });
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
    patch({ status: "processing" });

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
    if (native.current && fullLen.current > 0 && !capExceeded.current) {
      try {
        const finalSegs = await nativeTranscribeDiarize(concatFloat32(fullAudio.current));
        if (finalSegs.length) { segments.current = finalSegs.map((s) => toLocal(s, 0)); patch({ segments: segments.current }); }
      } catch (e) {
        log.error("diarization pass failed, keeping live transcript", e);
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

    const transcript = segments.current.map((s) => s.text).join(" ");
    if (!transcript.trim()) {
      // An empty transcript is either an actually-silent recording or a
      // silently-failed one — these counts are the only way to tell which after
      // the fact, since neither one throws.
      log.warn("meeting ended with an empty transcript", {
        silentDrains: silentDrains.current, emptyResultStreak: emptyResultStreak.current, native: native.current,
      });
    }
    const manualNotes = notesRef.current.trim();
    // Notes are written by the on-device model from the transcript AND whatever
    // the user typed during the meeting, falling back to the local heuristic
    // extractor when no model is available.
    const notes = await generateMeetingNotes(transcript, manualNotes, template.current);
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
      wordCount: notes.wordCount, synced: false,
    };
    await saveMeeting(meeting);
    // The pipeline is process-wide and deliberately NOT disposed here: disposing
    // it is what made every recording after the first pay a full model reload.
    diarizer.current = null;
    fullAudio.current = []; fullLen.current = 0;
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
    segments.current = []; fullAudio.current = []; fullLen.current = 0; notesRef.current = "";
    asrChunks.current = []; slices.current = []; analysing.current = [];
    statusRef.current = "idle";
    setAudioLevel(0);
    setState({
      status: "idle", elapsed: 0, modelProgress: 0, modelPhase: "loading", device: "",
      segments: [], error: "", meetingId: null, notes: "", backlogSeconds: 0,
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
