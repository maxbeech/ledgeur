// Saying a thought out loud instead of typing it.
//
// The same speech pipeline the recorder uses, asked a much smaller question:
// one person, one microphone, a few seconds, one string back. No diarization
// (there is one voice), no live streaming (the answer is wanted once, at the
// end), no meeting clock (there is no meeting).
//
// ── Why this is not "a very short recording" ────────────────────────────────
// A meeting recording is a stateful thing with a library entry, speakers,
// notes and a sync story. Routing dictation through that would mean a two-word
// thought created a meeting — in the library, in search, in the count on the
// home screen. What is wanted is a string.
//
// ── Engine choice is not decided again here ─────────────────────────────────
// Native first, webview second, exactly as the recorder chooses (see
// useRecorder's transcribeOne). Two places deciding that differently is how a
// phone ends up transcribing dictation on a slower path than its own meetings.

import { AudioCapture, friendlyCaptureError } from "@ledgeur/core/browser";
import { WHISPER_SAMPLE_RATE, resample, rms } from "@ledgeur/core";
import { ensureTranscriber } from "./asrEngine.ts";
import { aiStatus, nativeTranscribeChunk } from "./nativeAI.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("dictation");

/**
 * The longest a single spoken thought may run.
 *
 * Two minutes is far more than anybody dictates into a capture box, and the cap
 * exists for the case where it is not a thought at all: a phone in a pocket
 * with the button stuck on. Without it that becomes an unbounded buffer and,
 * eventually, a transcription job measured in minutes for audio nobody meant to
 * record. Hitting the cap stops and keeps what was said, rather than throwing
 * it away — the first two minutes are still the thought.
 */
export const MAX_DICTATION_SECONDS = 120;

/** Below this the microphone heard nothing worth sending to a model. */
const SILENCE_RMS = 0.0015;

export interface DictationHandle {
  /** Stop listening and transcribe. Resolves with what was said, which may be
   *  an empty string when nothing audible was captured. */
  stop(): Promise<string>;
  /** Stop listening and throw the audio away. */
  cancel(): Promise<void>;
}

export interface DictationOptions {
  /** 0..1 loudness, for whatever the UI shows while somebody is talking. A
   *  capture box with no feedback is one people speak into twice. */
  onLevel?: (level: number) => void;
  /** Fires if the cap above is reached, so the UI can stop looking like it is
   *  still listening. */
  onAutoStop?: () => void;
  lang?: string;
}

/**
 * Open the microphone and start collecting.
 *
 * Throws — with a sentence a person can act on — when the microphone cannot be
 * opened at all, because that is the one failure the caller has to show before
 * anybody starts talking into nothing.
 */
export async function startDictation(options: DictationOptions = {}): Promise<DictationHandle> {
  const capture = new AudioCapture();
  if (options.onLevel) capture.onLevel = options.onLevel;

  try {
    await capture.start({ mic: true, system: false });
  } catch (e) {
    await capture.stop().catch(() => {});
    throw new Error(friendlyCaptureError(e, "mic"));
  }

  let settled = false;
  let autoStopped = false;
  const cap = setTimeout(() => {
    autoStopped = true;
    options.onAutoStop?.();
  }, MAX_DICTATION_SECONDS * 1_000);

  /** Everything heard so far, at the capture device's rate. */
  const collect = (): Float32Array => capture.drainNew();

  const finish = async (): Promise<Float32Array> => {
    clearTimeout(cap);
    const raw = collect();
    const rate = capture.sampleRate;
    await capture.stop();
    if (!raw.length || !rate) return new Float32Array(0);
    return rate === WHISPER_SAMPLE_RATE ? raw : resample(raw, rate, WHISPER_SAMPLE_RATE);
  };

  return {
    async stop(): Promise<string> {
      if (settled) return "";
      settled = true;
      const audio = await finish();
      if (audio.length === 0) return "";
      // A pocket recording and a person who changed their mind look identical
      // to a speech model, which will happily invent a sentence out of room
      // tone. Silence is answered with silence.
      if (rms(audio) < SILENCE_RMS) {
        log.info("dictation heard nothing", { seconds: Math.round(audio.length / WHISPER_SAMPLE_RATE) });
        return "";
      }
      const text = await transcribe(audio, options.lang ?? "en");
      log.info("dictation transcribed", {
        seconds: Math.round(audio.length / WHISPER_SAMPLE_RATE),
        words: text.split(/\s+/).filter(Boolean).length,
        autoStopped,
      });
      return text;
    },
    async cancel(): Promise<void> {
      if (settled) return;
      settled = true;
      clearTimeout(cap);
      await capture.stop().catch(() => {});
    },
  };
}

/** Native engine when this build has one and its weights are on disk; the
 *  webview pipeline otherwise. The same order the recorder uses. */
async function transcribe(audio: Float32Array, lang: string): Promise<string> {
  const native = await aiStatus();
  if (native?.compiled && native.models_ready) {
    const segments = await nativeTranscribeChunk(audio);
    return segments.map((s) => s.text.trim()).filter(Boolean).join(" ").trim();
  }
  const transcriber = await ensureTranscriber(lang);
  return (await transcriber.transcribeText(audio, lang)).trim();
}
