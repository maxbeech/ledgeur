// Thin wrapper around the native macOS system-audio tap (Core Audio Process
// Tap — see src-tauri/src/audio/mod.rs) — the alternative to getDisplayMedia's
// screen-share picker for hearing the other side of a call: no picker dialog,
// no video, no menu-bar recording indicator, just a one-time permission grant.
//
// Deliberately not part of @ledgeur/core: it's Tauri- and macOS-specific,
// where core/browser/capture.ts is shared with the plain website. Exposes the
// same shape as AudioCapture (drainNew()/sampleRate) so useRecorder.ts can
// drain and mix it alongside the mic exactly like a second capture source —
// see mixFloat32 in @ledgeur/core.

import { isTauri } from "./runtime.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("system-audio-tap");
const EVENT = "system-audio:chunk";

interface SystemAudioChunkPayload {
  pcmBase64: string;
  sampleRate: number;
}

async function invoke<T>(cmd: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd);
}

/** True when the native tap could plausibly work here (Tauri + macOS build
 *  with the `system-audio-tap` feature). Not a permission check — `start()`
 *  can still fail if the user hasn't granted the OS prompt yet. */
export async function isSystemAudioTapAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>("system_audio_tap_available");
  } catch {
    return false;
  }
}

function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/** Same shape as AudioCapture's drain surface, fed by native PCM chunks
 *  instead of a Web Audio graph. `sampleRate` is fixed once `start()`
 *  resolves (the tap always reports 48 kHz — see mod.rs). */
export class SystemAudioTap {
  private chunks: Float32Array[] = [];
  private unlisten: (() => void) | null = null;
  sampleRate = 48_000;

  async start(): Promise<void> {
    const { listen } = await import("@tauri-apps/api/event");
    this.unlisten = await listen<SystemAudioChunkPayload>(EVENT, (event) => {
      const ints = base64ToInt16(event.payload.pcmBase64);
      const floats = new Float32Array(ints.length);
      for (let i = 0; i < ints.length; i++) floats[i] = ints[i] / 32768;
      this.chunks.push(floats);
      this.sampleRate = event.payload.sampleRate;
    });
    try {
      await invoke<void>("start_system_audio_tap");
    } catch (e) {
      this.unlisten?.();
      this.unlisten = null;
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  /** Audio captured since the previous drain — same contract as
   *  AudioCapture.drainNew(). */
  drainNew(): Float32Array {
    if (this.chunks.length === 0) return new Float32Array(0);
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const out = new Float32Array(total);
    let offset = 0;
    for (const c of this.chunks) { out.set(c, offset); offset += c.length; }
    this.chunks = [];
    return out;
  }

  async stop(): Promise<void> {
    this.unlisten?.();
    this.unlisten = null;
    try {
      await invoke<void>("stop_system_audio_tap");
    } catch (e) {
      log.warn("stopping the system-audio tap failed", e);
    }
  }
}
