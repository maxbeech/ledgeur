// Voice profiles, whichever engine this build has.
//
// There are two stores, because there are two engines:
//
//   native   sherpa-onnx embeddings in voices.json, via Tauri commands
//   webview  WeSpeaker embeddings in IndexedDB, via @ledgeur/core/browser
//
// They are not interchangeable — an embedding from one model means nothing to
// the other — so this picks the store belonging to whichever engine will
// actually be doing the recognising, rather than trying to merge them. Which is
// also why a build that gains the native engine starts with no voices: the
// prints it has are in the wrong vector space, and silently matching against
// them would put wrong names on a transcript.

import {
  aiStatus, enrollVoice as enrollNative, listVoiceProfiles as listNative,
  deleteVoiceProfile as deleteNative, type VoiceProfileMeta,
} from "./nativeAI.ts";
import {
  DiarizerController, listVoiceProfiles as listBrowser,
  saveVoiceProfile, deleteVoiceProfile as deleteBrowser,
} from "@ledgeur/core/browser";
import { isTauri } from "./runtime.ts";

export type { VoiceProfileMeta };

/** Which store this build will read when it recognises a voice. */
export async function activeEngine(): Promise<"native" | "webview"> {
  if (!isTauri()) return "webview";
  const status = await aiStatus();
  return status?.compiled && status?.models_ready ? "native" : "webview";
}

export async function listProfiles(): Promise<VoiceProfileMeta[]> {
  if ((await activeEngine()) === "native") return listNative();
  return (await listBrowser()).map((p) => ({
    id: p.id,
    name: p.name,
    // The native shape carries Unix seconds; the browser stores an ISO string.
    created_at: Math.floor(new Date(p.createdAt).getTime() / 1000),
  }));
}

/**
 * Enrol a voice from a recording of one person speaking.
 *
 * `samples` must be 16 kHz mono. The webview path is *not* a fallback for a
 * missing native engine — it is the path that build will actually use, so
 * enrolling into it is correct rather than second best.
 */
export async function enrollProfile(name: string, samples: Float32Array): Promise<VoiceProfileMeta> {
  if ((await activeEngine()) === "native") return enrollNative(name, samples);

  const diarizer = new DiarizerController();
  try {
    const embedding = await diarizer.embed(samples);
    if (!embedding?.length) {
      throw new Error("The speaker models produced nothing from that recording. Try again somewhere quieter, with a few more seconds of speech.");
    }
    const saved = await saveVoiceProfile({ name, embedding });
    const profile = saved.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    if (!profile) throw new Error("The voice was not saved.");
    return { id: profile.id, name: profile.name, created_at: Math.floor(new Date(profile.createdAt).getTime() / 1000) };
  } finally {
    diarizer.dispose();
  }
}

/**
 * Remember a voice from an embedding that already exists — the path taken when
 * somebody names a speaker in a saved transcript rather than sitting down to
 * enrol.
 *
 * Only the webview store can accept this: a native profile holds a sherpa-onnx
 * embedding, and the vectors kept on a meeting come from WeSpeaker. Saving one
 * into the other would produce a profile that never matches anybody, which is
 * worse than saying so.
 */
export async function enrollProfileFromEmbedding(name: string, embedding: readonly number[]): Promise<void> {
  if ((await activeEngine()) === "native") {
    throw new Error(
      "This build recognises voices with the native engine, which needs a short recording rather than a stored print. Enrol them under Integrations, Voice profiles.",
    );
  }
  await saveVoiceProfile({ name, embedding });
}

export async function deleteProfile(id: string): Promise<void> {
  if ((await activeEngine()) === "native") return deleteNative(id);
  await deleteBrowser(id);
}
