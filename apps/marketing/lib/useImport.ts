"use client";

// Importing a recording you already have.
//
// The requirement is that a dragged-in file is treated exactly like a meeting
// recorded in the app — same transcription, same speaker separation, same
// names, same notes, same library entry. So this shares the whole pipeline with
// the live recorder and differs only in where the audio comes from: a decoded
// file rather than a microphone.
//
// It is the fastest way to show somebody what the product does, because they
// can drop in a recording they already trust and check the result against what
// they remember being said.

import { useCallback, useRef, useState } from "react";
import {
  resample, WHISPER_SAMPLE_RATE, summarizeTranscript, deriveTitle,
  type AttributedSegment, type LocalMeeting, type StoredSpeaker,
} from "@ledgeur/core";
import {
  AudioCapture, TranscriberController, DiarizerController,
  listVoiceProfiles, putMeeting,
} from "@ledgeur/core/browser";

export interface ImportState {
  busy: boolean;
  /** What is happening, in words a person can read while they wait. */
  step: string;
  /** 0–100 while the speech model downloads. */
  modelProgress: number;
  error: string;
  warning: string;
  /** The file currently being worked on. */
  name: string;
}

const IDLE: ImportState = { busy: false, step: "", modelProgress: 0, error: "", warning: "", name: "" };

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

/**
 * Formats a browser can decode through Web Audio. Video containers work too —
 * the audio track is extracted — which matters because most people's "recording
 * of the meeting" is an .mp4 from Zoom.
 */
export const IMPORT_ACCEPT = "audio/*,video/*,.m4a,.mp3,.wav,.ogg,.opus,.webm,.mp4,.mov,.aac,.flac";

/** Big enough for a long meeting, small enough that a dropped video file does
 *  not silently exhaust the tab's memory before we can say anything useful. */
export const MAX_IMPORT_BYTES = 500 * 1024 * 1024;

export function useImport(onImported?: (meeting: LocalMeeting) => void) {
  const [state, setState] = useState<ImportState>(IDLE);
  const cancelled = useRef(false);
  const done = useRef(onImported);
  done.current = onImported;

  const patch = (p: Partial<ImportState>) => setState((s) => ({ ...s, ...p }));

  const importFile = useCallback(async (file: File, lang = "en"): Promise<LocalMeeting | null> => {
    cancelled.current = false;
    setState({ ...IDLE, busy: true, name: file.name, step: "Reading the file…" });

    if (file.size > MAX_IMPORT_BYTES) {
      setState({ ...IDLE, error: `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB, which is larger than this browser tab can decode safely. Try exporting audio only, or splitting the recording.`, name: file.name });
      return null;
    }

    let transcriber: TranscriberController | null = null;
    let diarizer: DiarizerController | null = null;

    try {
      const decoded = await AudioCapture.decodeFile(file).catch(() => {
        throw new Error("That file could not be decoded. It may not be an audio or video file, or it may use a codec this browser cannot read — an .m4a, .mp3 or .wav export usually works.");
      });
      if (decoded.audio.length === 0) throw new Error("That file has no audio in it.");

      const audio = resample(decoded.audio, decoded.sampleRate, WHISPER_SAMPLE_RATE);
      const durationSec = audio.length / WHISPER_SAMPLE_RATE;

      patch({ step: "Loading the speech model…" });
      transcriber = new TranscriberController({ onProgress: (_f, p) => patch({ modelProgress: p }) });
      await transcriber.preloadAndWait(lang);
      if (cancelled.current) return null;

      patch({ step: `Transcribing ${Math.round(durationSec / 60)} minutes of audio…`, modelProgress: 100 });
      // Two copies, because each worker takes ownership of the buffer it is
      // handed. The cost is one extra Float32Array; the alternative is
      // transcribing or diarizing an empty buffer, which is worse.
      const forSpeech = audio.slice();
      const forSpeakers = audio.slice();
      const { chunks, text } = await transcriber.transcribe(forSpeech, lang, 0);
      if (cancelled.current) return null;

      const timed = chunks.length
        ? chunks
        : (text.trim() ? [{ text: text.trim(), start: 0, end: durationSec }] : []);
      if (timed.length === 0) throw new Error("No speech was found in that recording.");

      let segments: AttributedSegment[] = timed.map((c) => ({
        startMs: Math.round(c.start * 1000),
        endMs: Math.round((c.end ?? c.start) * 1000),
        text: c.text,
        speaker: null,
        confidence: null,
      }));
      let speakers: StoredSpeaker[] = [];
      let warning = "";

      patch({ step: "Working out who was speaking…" });
      diarizer = new DiarizerController();
      const profiles = await listVoiceProfiles();
      const diarized = await diarizer.diarize(forSpeakers, timed, {
        profiles,
        onProgress: (p) => patch({
          step: p.stage === "segmenting"
            ? `Finding the speakers… ${p.done}/${p.total}`
            : `Identifying voices… ${p.done}/${p.total}`,
        }),
      });
      if (cancelled.current) return null;
      if (diarized.speakers.length > 0) {
        segments = diarized.segments;
        speakers = diarized.speakers.map((s) => ({
          speaker: s.speaker, label: s.label, profileId: s.profileId,
          confidence: s.confidence, speakingSeconds: s.speakingSeconds,
          // Kept so this voice can still be named next week, from the library.
          embedding: s.embedding,
        }));
      }
      warning = diarized.warning ?? "";

      patch({ step: "Writing the notes…", warning });
      const now = new Date().toISOString();
      const meeting: LocalMeeting = {
        id: uid(),
        title: "",
        // An imported recording did not happen now. Without a real timestamp the
        // best available answer is the file's own modified date, which is
        // usually when it was exported.
        startedAt: new Date(file.lastModified || Date.now()).toISOString(),
        endedAt: now,
        durationSec,
        lang,
        source: "import",
        sourceName: file.name,
        segments,
        speakers,
        notes: summarizeTranscript(segments.map((s) => s.text).join(" ")),
        manualNotes: "",
        remoteId: null,
        updatedAt: now,
      };
      meeting.title = deriveTitle(meeting);

      await putMeeting(meeting);
      setState({ ...IDLE, warning, name: file.name });
      done.current?.(meeting);
      return meeting;
    } catch (e) {
      setState({ ...IDLE, error: (e as Error).message, name: file.name });
      return null;
    } finally {
      transcriber?.dispose();
      diarizer?.dispose();
    }
  }, []);

  /**
   * Transcribe a short public clip, so somebody can see the whole pipeline work
   * before committing a real meeting to it.
   *
   * This is genuinely the product: the same models, the same code path, real
   * output. It is not a canned transcript pretending to be one — which would
   * be a strange thing to fake on a page whose entire argument is that you can
   * verify what runs on your machine.
   */
  const importSample = useCallback(async (url: string, lang = "en"): Promise<LocalMeeting | null> => {
    setState({ ...IDLE, busy: true, name: "Sample clip", step: "Fetching the sample…" });
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`The sample could not be fetched (${response.status}).`);
      const bytes = await response.blob();
      const file = new File([bytes], "ledgeur-sample.wav", { type: bytes.type || "audio/wav" });
      return await importFile(file, lang);
    } catch (e) {
      setState({ ...IDLE, error: `${(e as Error).message} The sample lives on a public CDN, so a firewall or an offline connection will block it — your own recordings do not need it.`, name: "Sample clip" });
      return null;
    }
  }, [importFile]);

  const cancel = useCallback(() => { cancelled.current = true; setState(IDLE); }, []);
  const dismiss = useCallback(() => setState(IDLE), []);

  return { state, importFile, importSample, cancel, dismiss };
}
