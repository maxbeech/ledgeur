// Bridge to the native on-device AI (Rust). Available only in the Tauri shell
// built with `--features native-ai`; returns null/throws explicitly otherwise so
// the recorder can fall back to the webview (transformers.js) transcriber.

import { isTauri } from "./runtime.ts";

export interface NativeSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number;
  /**
   * Who said it, or null when the engine could not place the voice.
   *
   * Null is a real answer, not a gap to paper over: the live path only
   * attributes an utterance with at least a few seconds of speech in it (see
   * MIN_EMBED_SECONDS in src-tauri/src/ai/engine.rs), because below that the
   * speaker embedding carries no identity and any label is a coin flip. This
   * used to be a plain string that every live chunk filled in with "Speaker 1",
   * which rendered a two-person meeting as one person talking to themselves.
   */
  speaker_label: string | null;
  speaker_confidence: number | null;
}

/** One stretch of the meeting attributed to one person by the pass on Stop. */
export interface NativeSpeakerTurn {
  start_ms: number;
  end_ms: number;
  /** An enrolled person's name, or "Speaker N". */
  label: string;
  /** Set only when the label came from matching an enrolled voice. */
  confidence: number | null;
}

export interface NativeAiStatus {
  compiled: boolean;
  models_ready: boolean;
  whisper_model: boolean;
  seg_model: boolean;
  embed_model: boolean;
  models_dir: string;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function aiStatus(): Promise<NativeAiStatus | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<NativeAiStatus>("ai_status");
  } catch {
    return null;
  }
}

export async function downloadModels(): Promise<void> {
  if (!isTauri()) throw new Error("Native model download is only available in the desktop app.");
  await invoke<void>("download_models");
}

/**
 * Send audio to a native command as raw bytes rather than JSON.
 *
 * Tauri passes an ArrayBuffer view through untouched as
 * `application/octet-stream`; anything else goes through `JSON.stringify`. The
 * previous `Array.from(samples)` did the latter, so stopping a ten-minute
 * meeting built a ~10-million-element array and serialised it to a couple of
 * hundred megabytes of JSON — on the main thread, before any transcription had
 * started. The Rust side decodes with `samples_from_request` (ai/mod.rs) and
 * assumes 16 kHz mono, which is what the recorder resamples to on the way out.
 *
 * `samples` is copied when it is a view onto a larger buffer, because Tauri
 * serialises the whole underlying ArrayBuffer, not just the view's window.
 */
async function invokeWithAudio<T>(cmd: string, samples: Float32Array): Promise<T> {
  const exact =
    samples.byteOffset === 0 && samples.byteLength === samples.buffer.byteLength
      ? samples
      : new Float32Array(samples);
  // Handed over as bytes: `invoke`'s types accept ArrayBuffer/Uint8Array, and
  // the Rust side reads little-endian f32s back out of them regardless.
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, new Uint8Array(exact.buffer));
}

/** Live transcription of a 16 kHz mono chunk (whisper.cpp). */
export async function nativeTranscribeChunk(samples: Float32Array): Promise<NativeSegment[]> {
  return invokeWithAudio<NativeSegment[]>("transcribe_chunk", samples);
}

/**
 * Speaker pass over the whole meeting: diarization + enrolled-voice matching.
 *
 * Returns turns to lay over the transcript the caller already has, rather than
 * a transcript of its own. It used to re-transcribe the entire recording first
 * — measured at 228 s for 99 s of audio on an M1 Pro, on top of the speaker
 * work — to arrive at much the same words the live pass had already produced.
 */
export async function nativeDiarizeMeeting(samples: Float32Array): Promise<NativeSpeakerTurn[]> {
  return invokeWithAudio<NativeSpeakerTurn[]>("diarize_meeting", samples);
}

/** Forget the voices heard in the previous take. Called when one starts:
 *  speaker numbering only means anything within a single meeting. */
export async function resetLiveSpeakers(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke<void>("reset_live_speakers");
  } catch {
    // Never worth failing a recording over — at worst the first utterances of
    // this meeting are matched against the last meeting's voices.
  }
}

/** Progress of the post-meeting pass, mirrored from `DIARIZE_PROGRESS_EVENT`. */
export interface DiarizeProgress {
  /** 0–100 within the current phase. */
  percent: number;
  phase: string;
}

/**
 * Subscribe to post-meeting progress. Resolves to an unsubscribe function; a
 * no-op outside the desktop shell so callers need no branch of their own.
 */
export async function onDiarizeProgress(fn: (p: DiarizeProgress) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<DiarizeProgress>("ai:diarize-progress", (e) => fn(e.payload));
  } catch {
    // Progress is a nicety; never let it stop a meeting from being written up.
    return () => {};
  }
}

// ---- Voice profiles (speaker identification) -------------------------------

export interface VoiceProfileMeta {
  id: string;
  name: string;
  /** Unix seconds. */
  created_at: number;
}

export async function listVoiceProfiles(): Promise<VoiceProfileMeta[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<VoiceProfileMeta[]>("list_voice_profiles");
  } catch {
    return [];
  }
}

/** Enroll a named voice from ~5–15 s of 16 kHz speech (native engine only). */
export async function enrollVoice(name: string, samples: Float32Array): Promise<VoiceProfileMeta> {
  if (!isTauri()) throw new Error("Voice enrolment runs in the desktop/mobile app (native engine).");
  return invoke<VoiceProfileMeta>("enroll_voice", { name, samples: Array.from(samples), sampleRate: 16000 });
}

export async function deleteVoiceProfile(id: string): Promise<void> {
  if (!isTauri()) throw new Error("Voice profiles live in the desktop/mobile app.");
  await invoke<void>("delete_voice_profile", { id });
}
