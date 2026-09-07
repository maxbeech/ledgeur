// Bridge to the native on-device AI (Rust). Available only in the Tauri shell
// built with `--features native-ai`; returns null/throws explicitly otherwise so
// the recorder can fall back to the webview (transformers.js) transcriber.

import { isTauri } from "./runtime.ts";

export interface NativeSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number;
  speaker_label: string;
  speaker_confidence: number | null;
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

/** Full pass over the whole meeting: transcription + diarization + voice ID. */
export async function nativeTranscribeDiarize(samples: Float32Array): Promise<NativeSegment[]> {
  return invokeWithAudio<NativeSegment[]>("transcribe_diarize", samples);
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
