// Importing a recording you already have, in the app.
//
// A dropped file is treated exactly like a live meeting: same transcription,
// same speaker separation, same names, same notes, same entry in the library.
// The only difference is where the audio came from — a decoded file rather than
// a microphone — and that the meeting is filed under the file's own date rather
// than pretending it happened now.
//
// The webview pipeline is used regardless of whether the native engine is
// built, because a file is not a live stream: there is no latency to win, and
// the browser path already separates speakers.

import { useCallback, useRef, useState } from "react";
import {
  resample, WHISPER_SAMPLE_RATE, notesToMarkdown, defaultSpeakerLabel,
  type AsrChunk,
} from "@ledgeur/core";
import {
  AudioCapture, TranscriberController, DiarizerController, listVoiceProfiles,
} from "@ledgeur/core/browser";
import { saveMeeting, type LocalMeeting, type LocalSegment, type LocalSpeaker } from "./meetingsStore.ts";
import { generateMeetingNotes } from "./notes.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("import");

/** Formats a webview can decode. Video containers count — most people's
 *  "recording of the meeting" is an .mp4 out of Zoom. */
export const IMPORT_ACCEPT =
  "audio/*,video/*,.m4a,.mp3,.wav,.ogg,.opus,.webm,.mp4,.mov,.aac,.flac";

/** Large enough for a long meeting, small enough that a dropped video does not
 *  exhaust the webview's memory before anything useful can be said. */
export const MAX_IMPORT_BYTES = 500 * 1024 * 1024;

export interface ImportState {
  busy: boolean;
  step: string;
  progress: number;
  error: string;
  warning: string;
  name: string;
}

const IDLE: ImportState = { busy: false, step: "", progress: 0, error: "", warning: "", name: "" };

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

export function useFileImport() {
  const [state, setState] = useState<ImportState>(IDLE);
  const running = useRef(false);
  const patch = (p: Partial<ImportState>) => setState((s) => ({ ...s, ...p }));

  const importFile = useCallback(async (file: File, lang = "en"): Promise<string | null> => {
    if (running.current) return null;
    running.current = true;
    setState({ ...IDLE, busy: true, name: file.name, step: "Reading the file…" });

    if (file.size > MAX_IMPORT_BYTES) {
      running.current = false;
      setState({
        ...IDLE, name: file.name,
        error: `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB, which is more than can be decoded safely in one go. Export the audio on its own, or split the recording.`,
      });
      return null;
    }

    let transcriber: TranscriberController | null = null;
    let diarizer: DiarizerController | null = null;

    try {
      const decoded = await AudioCapture.decodeFile(file).catch(() => {
        throw new Error("That file could not be decoded. It may not be audio or video, or it may use a codec this system cannot read — an .m4a, .mp3 or .wav export usually works.");
      });
      if (decoded.audio.length === 0) throw new Error("That file has no audio in it.");

      const audio = resample(decoded.audio, decoded.sampleRate, WHISPER_SAMPLE_RATE);
      const durationSec = audio.length / WHISPER_SAMPLE_RATE;

      patch({ step: "Loading the speech model…" });
      transcriber = new TranscriberController({ onProgress: (_f, p) => patch({ progress: p }) });
      await transcriber.preloadAndWait(lang);

      patch({ step: `Transcribing ${Math.max(1, Math.round(durationSec / 60))} minute(s) of audio…`, progress: 100 });
      // Each worker takes ownership of the buffer it is handed, so each gets a
      // copy — otherwise one of them transcribes an empty array.
      const { chunks, text } = await transcriber.transcribe(audio.slice(), lang, 0);
      const timed: AsrChunk[] = chunks.length
        ? chunks
        : (text.trim() ? [{ text: text.trim(), start: 0, end: durationSec }] : []);
      if (timed.length === 0) throw new Error("No speech was found in that recording.");

      patch({ step: "Working out who was speaking…" });
      diarizer = new DiarizerController();
      const profiles = await listVoiceProfiles();
      const diarized = await diarizer.diarize(audio.slice(), timed, {
        profiles,
        onProgress: (p) => patch({
          step: p.stage === "segmenting"
            ? `Finding the speakers… ${p.done}/${p.total}`
            : `Identifying voices… ${p.done}/${p.total}`,
        }),
      });
      if (diarized.warning) log.warn("speaker labels unavailable", diarized.warning);

      const names = new Map(diarized.speakers.map((s) => [s.speaker, s]));
      const segments: LocalSegment[] = (diarized.segments.length ? diarized.segments : timed.map((c) => ({
        startMs: Math.round(c.start * 1000),
        endMs: Math.round((c.end ?? c.start) * 1000),
        text: c.text,
        speaker: null as number | null,
        confidence: null as number | null,
      }))).map((seg) => {
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

      patch({ step: "Writing the notes…" });
      const transcript = segments.map((s) => s.text).join(" ");
      const notes = await generateMeetingNotes(transcript);

      // An imported recording did not happen now. The file's modified date is
      // the best available answer, and is usually when it was exported.
      const startedAt = new Date(file.lastModified || Date.now()).toISOString();
      const title = file.name.replace(/\.[a-z0-9]+$/i, "") || "Imported recording";
      const id = uid();
      const meeting: LocalMeeting = {
        id,
        title,
        createdAt: new Date().toISOString(),
        startedAt,
        endedAt: new Date(new Date(startedAt).getTime() + durationSec * 1000).toISOString(),
        status: "complete",
        lang,
        segments,
        speakers: diarized.speakers.length
          ? diarized.speakers.map((sp): LocalSpeaker => ({
              label: sp.label,
              confidence: sp.confidence,
              embedding: sp.embedding,
              speakingSeconds: sp.speakingSeconds,
            }))
          : undefined,
        summary: notes.summary,
        decisions: notes.decisions,
        questions: notes.questions,
        actionItems: notes.actionItems,
        manualNotes: "",
        noteMarkdown: notesToMarkdown(title, startedAt.slice(0, 10), notes, transcript, ""),
        wordCount: notes.wordCount,
        synced: false,
      };
      await saveMeeting(meeting);
      log.info("imported", { id, segments: segments.length, speakers: diarized.speakers.length });

      setState({ ...IDLE, warning: diarized.warning ?? "", name: file.name });
      return id;
    } catch (e) {
      log.error("import failed", e);
      setState({ ...IDLE, error: e instanceof Error ? e.message : String(e), name: file.name });
      return null;
    } finally {
      running.current = false;
      transcriber?.dispose();
      diarizer?.dispose();
    }
  }, []);

  const dismiss = useCallback(() => setState(IDLE), []);
  return { state, importFile, dismiss };
}
