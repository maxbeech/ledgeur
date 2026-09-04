// The live recording engine as a React hook. Drives capture → periodic drain →
// on-device transcription → live transcript segments, then generates notes on
// stop and persists the meeting locally. Mounted once at app level (see
// recorderContext.tsx) so a recording survives navigating between screens.
//
// Two transcription backends: the native engine (whisper.cpp + sherpa-onnx
// diarization, when the app is built with `--features native-ai` and models are
// downloaded) or the webview engine (transformers.js).
//
// Both now separate speakers. The webview path used to label every line
// "Speaker 1", which made an unbuilt native engine feel like a broken product;
// it now runs pyannote + WeSpeaker in a worker alongside Whisper, analysing
// each drained slice as it arrives and clustering once at the end. That keeps
// memory flat — nothing retains the recording — and means a name the user has
// saved is recognised on either backend.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  resample, WHISPER_SAMPLE_RATE, rms, concatFloat32, notesToMarkdown,
  defaultSpeakerLabel, type AsrChunk,
} from "@ledgeur/core";
import {
  AudioCapture, TranscriberController, DiarizerController, listVoiceProfiles,
  type AnalysedSlice,
} from "@ledgeur/core/browser";
import { aiStatus, nativeTranscribeChunk, nativeTranscribeDiarize, type NativeSegment } from "./nativeAI.ts";
import { saveMeeting, type LocalMeeting, type LocalSegment, type LocalSpeaker, type ChatMessage } from "./meetingsStore.ts";
import { generateMeetingNotes } from "./notes.ts";
import { getSettings } from "./settings.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("recorder");

export type RecorderStatus = "idle" | "loading-model" | "recording" | "processing" | "complete" | "error";

export interface RecorderState {
  status: RecorderStatus; elapsed: number; level: number; modelProgress: number;
  device: string; segments: LocalSegment[]; error: string; meetingId: string | null;
  /** Notes the user types during the meeting — merged into the final summary. */
  notes: string;
}

const DRAIN_MS = 5000;
const SILENCE_RMS = 0.006;
const MAX_DIARIZE_SAMPLES = 45 * 60 * WHISPER_SAMPLE_RATE; // cap full-audio retention (~45 min)
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
const toLocal = (s: NativeSegment, offsetMs: number): LocalSegment => ({
  id: uid(), speakerLabel: s.speaker_label, startMs: offsetMs + s.start_ms, endMs: offsetMs + s.end_ms,
  text: s.text, confidence: s.confidence, speakerConfidence: s.speaker_confidence,
});

export function useRecorder(getThreadMessages?: () => ChatMessage[]) {
  const [state, setState] = useState<RecorderState>({
    status: "idle", elapsed: 0, level: 0, modelProgress: 0, device: "", segments: [], error: "", meetingId: null, notes: "",
  });
  const capture = useRef<AudioCapture | null>(null);
  const transcriber = useRef<TranscriberController | null>(null);
  const diarizer = useRef<DiarizerController | null>(null);
  /** Timed transcript pieces, accumulated across drains for the webview path. */
  const asrChunks = useRef<AsrChunk[]>([]);
  /** The voices found in this meeting, with the vectors that identify them, so
   *  one can be named later from the library. */
  const speakers = useRef<LocalSpeaker[]>([]);
  /** One entry per analysed slice: turns and voice vectors, never audio. */
  const slices = useRef<AnalysedSlice[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastOffsetMs = useRef(0);
  const segments = useRef<LocalSegment[]>([]);
  const startedAt = useRef<string>("");
  const native = useRef(false);
  const lang = useRef("en");
  const notesRef = useRef("");
  const threadRef = useRef<(() => ChatMessage[]) | undefined>(getThreadMessages);
  threadRef.current = getThreadMessages;
  const fullAudio = useRef<Float32Array[]>([]);
  const fullLen = useRef(0);
  const capExceeded = useRef(false); // true once we stop retaining full audio (>cap)
  const statusRef = useRef<RecorderStatus>("idle");
  /** Diagnostics for "audio was captured but nothing was transcribed" (task
   *  #4): counts so a silent failure of the speech model is distinguishable
   *  from an actually-quiet room, both in the logs and, past a few in a row,
   *  as a visible note rather than a transcript that's just empty at the end. */
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

  const drain = useCallback(async () => {
    const cap = capture.current;
    if (!cap) return;
    const raw = cap.drainNew();
    if (raw.length === 0) return;
    const audio = resample(raw, cap.sampleRate, WHISPER_SAMPLE_RATE);
    const endMs = Math.round(cap.totalSeconds() * 1000);
    if (rms(audio) < SILENCE_RMS) {
      silentDrains.current++;
      lastOffsetMs.current = endMs;
      return;
    }
    try {
      if (native.current) {
        const segs = await nativeTranscribeChunk(audio);
        if (segs.length) {
          segments.current = [...segments.current, ...segs.map((s) => toLocal(s, lastOffsetMs.current))];
          patch({ segments: segments.current });
        }
        if (fullLen.current < MAX_DIARIZE_SAMPLES) { fullAudio.current.push(audio); fullLen.current += audio.length; }
        else { capExceeded.current = true; }
      } else {
        // The buffer is transferred to whichever worker gets it first, so the
        // diarizer gets its own copy. Both run against the same slice, on the
        // same clock.
        const forSpeakers = audio.slice();
        const offsetSeconds = lastOffsetMs.current / 1000;

        const { text, chunks } = await transcriber.current!.transcribe(audio, lang.current, offsetSeconds);
        if (chunks.length) asrChunks.current = [...asrChunks.current, ...chunks];
        else if (text.trim()) {
          // A model that returned no timings still returned words. Place them
          // across the slice rather than losing them.
          asrChunks.current = [...asrChunks.current, { text: text.trim(), start: offsetSeconds, end: endMs / 1000 }];
        }
        if (text.trim()) {
          segments.current = [...segments.current, {
            id: uid(), speakerLabel: defaultSpeakerLabel(0), startMs: lastOffsetMs.current, endMs,
            text: text.trim(), confidence: null, speakerConfidence: null,
          }];
          patch({ segments: segments.current });
          emptyResultStreak.current = 0;
        } else {
          // Audible audio (it passed the silence gate) that the model
          // transcribed as nothing. Once in a while that's just noise or a
          // breath; several slices in a row with real audio and zero words
          // back is how "recorded fine, transcript came out empty" happens
          // silently — surface it instead of only finding out at the end.
          emptyResultStreak.current++;
          log.warn("non-silent audio produced no transcript", { streak: emptyResultStreak.current });
          if (emptyResultStreak.current >= 3 && !emptyResultWarned.current) {
            emptyResultWarned.current = true;
            patch({ error: "Audio is being picked up, but the speech model isn't returning any text. The recording is continuing — if the transcript is still empty at the end, try again or restart the app." });
          }
        }

        // Speakers are worked out in the background: a slow or failing speaker
        // model must never hold up, or break, the transcript.
        const analysis = diarizer.current?.analyse(forSpeakers, offsetSeconds)
          .then((slice) => { slices.current = [...slices.current, slice]; })
          .catch((e: unknown) => log.warn("speaker analysis skipped for a slice", e));
        if (analysis) analysing.current = [...analysing.current, analysis];
      }
    } catch (e) {
      log.error("transcription chunk failed", e);
      patch({ error: e instanceof Error ? e.message : String(e) });
    }
    lastOffsetMs.current = endMs;
  }, []);

  const start = useCallback(async (opts: { mic: boolean; system: boolean; lang?: string }) => {
    log.info("start requested", opts);
    try {
      segments.current = []; lastOffsetMs.current = 0; fullAudio.current = []; fullLen.current = 0; capExceeded.current = false;
      asrChunks.current = []; slices.current = []; analysing.current = []; speakers.current = [];
      silentDrains.current = 0; emptyResultStreak.current = 0; emptyResultWarned.current = false;
      lang.current = opts.lang ?? "en";
      notesRef.current = "";
      startedAt.current = new Date().toISOString();
      patch({ status: "loading-model", error: "", segments: [], elapsed: 0, meetingId: null, notes: "" });

      // getDisplayMedia/getUserMedia must be requested while the click that
      // triggered `start` is still "live" — a browser's user-activation window
      // is spent by the first await, and an IPC round-trip to the native engine
      // (aiStatus, below) is more than enough to burn through it. So capture is
      // opened first, before anything else async, and everything that can wait
      // (model status, model loading) happens after.
      const cap = new AudioCapture();
      cap.onLevel = (rmsVal) => patch({ level: rmsVal });
      await cap.start(opts);
      capture.current = cap;

      const status = await aiStatus();
      native.current = Boolean(status?.compiled && status?.models_ready);
      if (native.current) {
        patch({ device: "whisper.cpp (native)" });
      } else {
        const tr = new TranscriberController({
          // `info.label` names the rung that actually started ("WebGPU", "CPU");
          // it changes if the preferred backend could not create a session.
          onDevice: (device, info) => patch({ device: info?.label ?? device }),
          onProgress: (_f, p) => patch({ modelProgress: p }),
        });
        transcriber.current = tr;
        await tr.preloadAndWait(lang.current);

        // Started but deliberately not awaited: the speaker models are a few
        // tens of megabytes, and waiting for them before the first word is
        // recorded would make the app feel broken. They warm up during the
        // meeting and are only needed at the end.
        const dz = new DiarizerController();
        diarizer.current = dz;
        void dz.preload().catch((e: unknown) => log.warn("speaker models unavailable", e));
      }

      patch({ status: "recording" });
      log.info("recording started", { native: native.current });
      timer.current = setInterval(() => { patch({ elapsed: cap.totalSeconds() }); void drain(); }, DRAIN_MS);
    } catch (e) {
      log.error("start failed", e);
      patch({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [drain]);

  const stop = useCallback(async (title: string): Promise<string | null> => {
    log.info("stop requested", { title, segments: segments.current.length });
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    patch({ status: "processing" });
    // Drain until the buffer is empty rather than once: a single pass leaves
    // whatever arrived during the last transcription, and that audio is
    // discarded with the capture — a silent "the end got cut off".
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await drain();
      if ((capture.current?.pendingSamples() ?? 0) < WHISPER_SAMPLE_RATE / 10) break;
    }
    // The speaker analyses were deliberately not awaited during the meeting.
    // Now they have to land, or the final turns are clustered without them.
    const outstanding = analysing.current;
    analysing.current = [];
    await Promise.allSettled(outstanding);
    await capture.current?.stop();
    capture.current = null;

    // Native: re-run the whole meeting for real speaker diarization + labels.
    // Only when we retained the FULL audio — if the meeting exceeded the retention
    // cap we keep the complete live transcript instead of overwriting it with a
    // diarized prefix (which would silently drop the tail).
    if (native.current && fullLen.current > 0 && !capExceeded.current) {
      try {
        const finalSegs = await nativeTranscribeDiarize(concatFloat32(fullAudio.current));
        if (finalSegs.length) { segments.current = finalSegs.map((s) => toLocal(s, 0)); patch({ segments: segments.current }); }
      } catch (e) {
        log.error("diarization pass failed, keeping live transcript", e);
      }
    }

    // Webview: cluster everything the speaker models saw during the meeting,
    // and put a name on anyone this device already recognises. Nothing here is
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
          segments.current = diarized.segments.map((seg) => {
            const speaker = seg.speaker == null ? null : names.get(seg.speaker);
            return {
              id: uid(),
              speakerLabel: speaker?.label ?? defaultSpeakerLabel(seg.speaker ?? 0),
              startMs: seg.startMs,
              endMs: seg.endMs,
              text: seg.text,
              confidence: seg.confidence,
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
      // silently-failed one — these counts are the only way to tell which
      // after the fact, since neither one throws.
      log.warn("meeting ended with an empty transcript", {
        silentDrains: silentDrains.current, emptyResultStreak: emptyResultStreak.current, native: native.current,
      });
    }
    const manualNotes = notesRef.current.trim();
    // Notes are written by the on-device model, falling back to the local
    // heuristic extractor when no model is available (task #3).
    const notes = await generateMeetingNotes(transcript);
    // The copilot/user thread is saved with the meeting only when the user opts
    // in — by default just the spoken transcript is kept (task #2).
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
    transcriber.current?.dispose(); transcriber.current = null;
    diarizer.current?.dispose(); diarizer.current = null;
    fullAudio.current = []; fullLen.current = 0;
    asrChunks.current = []; slices.current = []; analysing.current = []; speakers.current = [];
    patch({ status: "complete", meetingId: id });
    log.info("recording saved", { meetingId: id, segments: meeting.segments.length, wordCount: notes.wordCount });
    return id;
  }, [drain]);

  const reset = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    capture.current?.stop(); transcriber.current?.dispose(); diarizer.current?.dispose();
    capture.current = null; transcriber.current = null; diarizer.current = null;
    segments.current = []; fullAudio.current = []; fullLen.current = 0; notesRef.current = "";
    asrChunks.current = []; slices.current = [];
    statusRef.current = "idle";
    setState({ status: "idle", elapsed: 0, level: 0, modelProgress: 0, device: "", segments: [], error: "", meetingId: null, notes: "" });
  }, []);

  // Provider-level teardown (app close): stop capture, timers and the worker so
  // nothing leaks. During normal navigation the provider stays mounted. If this
  // fires while still "recording", something remounted RecorderProvider
  // unexpectedly (e.g. a Fast Refresh full-reload) and the recording is being
  // cut short — log loudly so that's diagnosable instead of a silent reset.
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (statusRef.current === "recording") log.warn("recorder unmounted mid-recording — capture stopped");
    void capture.current?.stop();
    transcriber.current?.dispose();
    diarizer.current?.dispose();
  }, []);

  return { state, start, stop, reset, setNotes };
}
