// The live recording engine as a React hook. Drives capture → periodic drain →
// on-device transcription → live transcript segments, then generates notes on
// stop and persists the meeting locally. Mounted once at app level (see
// recorderContext.tsx) so a recording survives navigating between screens.
//
// Two transcription backends: the native engine (whisper.cpp + sherpa-onnx
// diarization, when the app is built with `--features native-ai` and models are
// downloaded) or the webview engine (transformers.js). Native adds real
// per-speaker labels + confidence; the webview path labels a single speaker.

import { useCallback, useEffect, useRef, useState } from "react";
import { resample, WHISPER_SAMPLE_RATE, rms, concatFloat32, summarizeTranscript, notesToMarkdown } from "@parleynotes/core";
import { AudioCapture } from "./capture.ts";
import { TranscriberController } from "./transcriber.ts";
import { aiStatus, nativeTranscribeChunk, nativeTranscribeDiarize, type NativeSegment } from "./nativeAI.ts";
import { saveMeeting, type LocalMeeting, type LocalSegment } from "./meetingsStore.ts";

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

export function useRecorder() {
  const [state, setState] = useState<RecorderState>({
    status: "idle", elapsed: 0, level: 0, modelProgress: 0, device: "", segments: [], error: "", meetingId: null, notes: "",
  });
  const capture = useRef<AudioCapture | null>(null);
  const transcriber = useRef<TranscriberController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastOffsetMs = useRef(0);
  const segments = useRef<LocalSegment[]>([]);
  const startedAt = useRef<string>("");
  const native = useRef(false);
  const lang = useRef("en");
  const notesRef = useRef("");
  const fullAudio = useRef<Float32Array[]>([]);
  const fullLen = useRef(0);
  const capExceeded = useRef(false); // true once we stop retaining full audio (>cap)

  const patch = (p: Partial<RecorderState>) => setState((s) => ({ ...s, ...p }));

  const setNotes = useCallback((text: string) => {
    notesRef.current = text;
    patch({ notes: text });
  }, []);

  const drain = useCallback(async () => {
    const cap = capture.current;
    if (!cap) return;
    const raw = cap.drainNew();
    if (raw.length === 0) return;
    const audio = resample(raw, cap.sampleRate, WHISPER_SAMPLE_RATE);
    const endMs = Math.round(cap.totalSeconds() * 1000);
    if (rms(audio) < SILENCE_RMS) { lastOffsetMs.current = endMs; return; }
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
        const text = (await transcriber.current!.transcribe(audio, lang.current)).trim();
        if (text) {
          segments.current = [...segments.current, { id: uid(), speakerLabel: "Speaker 1", startMs: lastOffsetMs.current, endMs, text, confidence: null, speakerConfidence: null }];
          patch({ segments: segments.current });
        }
      }
    } catch (e) {
      patch({ error: e instanceof Error ? e.message : String(e) });
    }
    lastOffsetMs.current = endMs;
  }, []);

  const start = useCallback(async (opts: { mic: boolean; system: boolean; lang?: string }) => {
    try {
      segments.current = []; lastOffsetMs.current = 0; fullAudio.current = []; fullLen.current = 0; capExceeded.current = false;
      lang.current = opts.lang ?? "en";
      notesRef.current = "";
      startedAt.current = new Date().toISOString();
      patch({ status: "loading-model", error: "", segments: [], elapsed: 0, meetingId: null, notes: "" });

      const status = await aiStatus();
      native.current = Boolean(status?.compiled && status?.models_ready);
      if (native.current) {
        patch({ device: "whisper.cpp (native)" });
      } else {
        const tr = new TranscriberController({
          onDevice: (device) => patch({ device }),
          onProgress: (_f, p) => patch({ modelProgress: p }),
        });
        transcriber.current = tr;
        await tr.preloadAndWait(lang.current);
      }

      const cap = new AudioCapture();
      cap.onLevel = (rmsVal) => patch({ level: rmsVal });
      await cap.start(opts);
      capture.current = cap;
      patch({ status: "recording" });
      timer.current = setInterval(() => { patch({ elapsed: cap.totalSeconds() }); void drain(); }, DRAIN_MS);
    } catch (e) {
      patch({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [drain]);

  const stop = useCallback(async (title: string): Promise<string | null> => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    patch({ status: "processing" });
    await drain();
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
        console.error("diarization pass failed, keeping live transcript:", e);
      }
    }

    const transcript = segments.current.map((s) => s.text).join(" ");
    const manualNotes = notesRef.current.trim();
    const notes = summarizeTranscript(transcript);
    const id = uid();
    const now = new Date().toISOString();
    const meeting: LocalMeeting = {
      id, title: title || "Untitled meeting", createdAt: now, startedAt: startedAt.current, endedAt: now,
      status: "complete", lang: lang.current, segments: segments.current,
      summary: notes.summary, decisions: notes.decisions, questions: notes.questions, actionItems: notes.actionItems,
      manualNotes,
      noteMarkdown: notesToMarkdown(title || "Untitled meeting", now.slice(0, 10), notes, transcript, manualNotes),
      wordCount: notes.wordCount, synced: false,
    };
    await saveMeeting(meeting);
    transcriber.current?.dispose(); transcriber.current = null;
    fullAudio.current = []; fullLen.current = 0;
    patch({ status: "complete", meetingId: id });
    return id;
  }, [drain]);

  const reset = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    capture.current?.stop(); transcriber.current?.dispose();
    capture.current = null; transcriber.current = null;
    segments.current = []; fullAudio.current = []; fullLen.current = 0; notesRef.current = "";
    setState({ status: "idle", elapsed: 0, level: 0, modelProgress: 0, device: "", segments: [], error: "", meetingId: null, notes: "" });
  }, []);

  // Provider-level teardown (app close): stop capture, timers and the worker so
  // nothing leaks. During normal navigation the provider stays mounted.
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    void capture.current?.stop();
    transcriber.current?.dispose();
  }, []);

  return { state, start, stop, reset, setNotes };
}
