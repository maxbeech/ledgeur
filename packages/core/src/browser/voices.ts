// Where remembered voices live in a browser.
//
// Voice prints are biometric-adjacent data, so they never leave the device:
// IndexedDB on the machine that heard the voice, and nowhere else. Not synced,
// not uploaded, not in the paid tier. That is a deliberate product decision as
// much as a privacy one — a voice print is the one piece of a meeting that
// identifies a person even when the transcript is deleted.
//
// The matching and updating rules are in ../diarize/voiceprints.ts and are
// unit-tested there; this file is only storage.

import { rememberVoice, forgetVoice } from "../diarize/voiceprints.ts";
import { openDatabase, runTransaction } from "./idb.ts";
import type { VoiceProfile } from "../diarize/types.ts";

const DB_NAME = "ledgeur-voices";
const DB_VERSION = 1;
const STORE = "profiles";

const db = () => openDatabase(DB_NAME, DB_VERSION, [{ name: STORE, keyPath: "id" }]);

const tx = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  db().then((connection) => runTransaction(connection, STORE, mode, run));

/**
 * Every remembered voice.
 *
 * A browser that refuses IndexedDB (private mode, storage disabled) yields an
 * empty list rather than throwing: the meeting still diarizes, speakers are
 * just called "Speaker 1" instead of "Priya". Losing the nice-to-have must
 * never lose the recording.
 */
export async function listVoiceProfiles(): Promise<VoiceProfile[]> {
  try {
    const rows = await tx<VoiceProfile[]>("readonly", (s) => s.getAll() as IDBRequest<VoiceProfile[]>);
    return rows.filter((r) => Array.isArray(r.embedding) && r.embedding.length > 0);
  } catch {
    return [];
  }
}

/**
 * Name a voice — the moment that turns diarization into recognition.
 *
 * Returns the full profile list so a caller can re-run identification against
 * it immediately. Throws when storage is unavailable, because a rename that
 * silently does not persist is worse than one that says so.
 */
export async function saveVoiceProfile(input: {
  name: string;
  embedding: readonly number[];
  profileId?: string | null;
}): Promise<VoiceProfile[]> {
  const existing = await listVoiceProfiles();
  const next = rememberVoice(existing, input);
  const changed = next.filter((p) => {
    const before = existing.find((e) => e.id === p.id);
    return !before || before.updatedAt !== p.updatedAt || before.name !== p.name;
  });
  for (const profile of changed) {
    await tx("readwrite", (s) => s.put(profile) as IDBRequest<IDBValidKey>);
  }
  return next;
}

/** Forget a voice. The transcripts that used the name keep it — this only stops
 *  future recordings being matched to it. */
export async function deleteVoiceProfile(id: string): Promise<VoiceProfile[]> {
  const existing = await listVoiceProfiles();
  await tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
  return forgetVoice(existing, id);
}

/** Wipe every remembered voice — offered in settings, because "delete my
 *  biometric data" has to be one button and not a support ticket. */
export async function clearVoiceProfiles(): Promise<void> {
  await tx("readwrite", (s) => s.clear() as IDBRequest<undefined>);
}
