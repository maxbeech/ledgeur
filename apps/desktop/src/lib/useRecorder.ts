// The live recording engine as a React hook. Drives capture → periodic drain →
// on-device transcription → live transcript segments, then generates notes on
// stop and persists the meeting locally.
//
// Two transcription backends: the native engine (whisper.cpp + sherpa-onnx
// diarization, when the app is built with `--features native-ai` and models are
// downloaded) or the webview engine (transformers.js). Native adds real
// per-speaker labels + confidence; the webview path labels a single speaker.

import { useCallback, useRef, useState } from "react";
import { resample, WHISPER_SAMPLE_RATE, rms, concatFloat32, summarizeTranscript, notesToMarkdown } from "@parleynotes/core";
import { AudioCapture } from "./capture.ts";
import { TranscriberController } from "./transcriber.ts";
import { aiStatus, nativeTranscribeChunk, nativeTranscribeDiarize, type NativeSegment } from "./nativeAI.ts";
import { saveMeeting, type LocalMeeting, type LocalSegment } from "./meetingsStore.ts";

export type RecorderStatus = "idle" | "loading-model" | "recording" | "processing" | "complete" | "error";

export interface RecorderState {
  status: RecorderStatus; elapsed: number; level: number; modelProgress: number;
  device: string; segments: LocalSegment[]; error: string; meetingId: string | null;
}

const DRAIN_MS = 5000;
const SILENCE_RMS = 0.006;
const MAX_DIARIZE_SAMPLES = 45 * 60 * WHISPER_SAMPLE_RATE; // cap full-audio retention (~45 min)
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
const toLocal = (s: NativeSegment, offsetMs: number): LocalSegment => ({
  id: uid(), speakerLabel: s.speaker_label, startMs: offsetMs + s.start_ms, endMs: offsetMs + s.end_ms,
  text: s.text, confidence: s.confidence,
});

export function useRecorder(lang: string = "en") {
  const [state, setState] = useState<RecorderState>({
    status: "idle", elapsed: 0, level: 0, modelProgress: 0, device: "", segments: [], error: "", meetingId: null,
  });
  const capture = useRef<AudioCapture | null>(null);
  const transcriber = useRef<TranscriberController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastOffsetMs = useRef(0);
  const segments = useRef<LocalSegment[]>([]);
  const startedAt = useRef<string>("");
  const native = useRef(false);
  const fullAudio = useRef<Float32Array[]>([]);
  const fullLen = useRef(0);

  const patch = (p: Partial<RecorderState>) => setState((s) => ({ ...s, ...p }));

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
      } else {
        const text = (await transcriber.current!.transcribe(audio, lang)).trim();
        if (text) {
          segments.current = [...segments.current, { id: uid(), speakerLabel: "Speaker 1", startMs: lastOffsetMs.current, endMs, text, confidence: null }];
          patch({ segments: segments.current });
        }
      }
    } catch (e) {
      patch({ error: e instanceof Error ? e.message : String(e) });
    }
    lastOffsetMs.current = endMs;
  }, [lang]);

  const start = useCallback(async (opts: { mic: boolean; system: boolean }) => {
    try {
      segments.current = []; lastOffsetMs.current = 0; fullAudio.current = []; fullLen.current = 0;
      startedAt.current = new Date().toISOString();
      patch({ status: "loading-model", error: "", segments: [], elapsed: 0, meetingId: null });

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
        await tr.preloadAndWait(lang);
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
  }, [drain, lang]);

  const stop = useCallback(async (title: string): Promise<string | null> => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    patch({ status: "processing" });
    await drain();
    await capture.current?.stop();
    capture.current = null;

    // Native: re-run the whole meeting for real speaker diarization + labels.
    if (native.current && fullLen.current > 0) {
      try {
        const finalSegs = await nativeTranscribeDiarize(concatFloat32(fullAudio.current));
        if (finalSegs.length) { segments.current = finalSegs.map((s) => toLocal(s, 0)); patch({ segments: segments.current }); }
      } catch (e) {
        console.error("diarization pass failed, keeping live transcript:", e);
      }
    }

    const transcript = segments.current.map((s) => s.text).join(" ");
    const notes = summarizeTranscript(transcript);
    const id = uid();
    const now = new Date().toISOString();
    const meeting: LocalMeeting = {
      id, title: title || "Untitled meeting", createdAt: now, startedAt: startedAt.current, endedAt: now,
      status: "complete", lang, segments: segments.current,
      summary: notes.summary, decisions: notes.decisions, questions: notes.questions, actionItems: notes.actionItems,
      noteMarkdown: notesToMarkdown(title || "Untitled meeting", now.slice(0, 10), notes, transcript),
      wordCount: notes.wordCount, synced: false,
    };
    await saveMeeting(meeting);
    transcriber.current?.dispose(); transcriber.current = null;
    fullAudio.current = []; fullLen.current = 0;
    patch({ status: "complete", meetingId: id });
    return id;
  }, [drain, lang]);

  const reset = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    capture.current?.stop(); transcriber.current?.dispose();
    capture.current = null; transcriber.current = null;
    segments.current = []; fullAudio.current = []; fullLen.current = 0;
    setState({ status: "idle", elapsed: 0, level: 0, modelProgress: 0, device: "", segments: [], error: "", meetingId: null });
  }, []);

  return { state, start, stop, reset };
}
