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

/** Live transcription of a 16 kHz mono chunk (whisper.cpp). */
export async function nativeTranscribeChunk(samples: Float32Array): Promise<NativeSegment[]> {
  return invoke<NativeSegment[]>("transcribe_chunk", { samples: Array.from(samples), sampleRate: 16000 });
}

/** Full pass over the whole meeting: transcription + diarization + voice ID. */
export async function nativeTranscribeDiarize(samples: Float32Array): Promise<NativeSegment[]> {
  return invoke<NativeSegment[]>("transcribe_diarize", { samples: Array.from(samples), sampleRate: 16000 });
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
