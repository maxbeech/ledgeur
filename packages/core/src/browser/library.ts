// The local meeting library.
//
// Ledgeur is local-first: a recording is complete and useful before any account
// exists, and signing in later adds sync rather than unlocking the product. So
// this store is the primary copy, and the Supabase tables are a mirror of it.
//
// The shapes deliberately mirror supabase/migrations (meetings, speakers,
// transcript_segments, meeting_notes) so that syncing is a field-for-field
// copy rather than a translation layer that can drift.

import { openDatabase, runTransaction } from "./idb.ts";
import type { LocalMeeting } from "../library/meeting.ts";

export type { LocalMeeting, StoredSpeaker, MeetingSource } from "../library/meeting.ts";

const DB_NAME = "ledgeur-library";
const DB_VERSION = 1;
const STORE = "meetings";

const db = () => openDatabase(DB_NAME, DB_VERSION, [
  { name: STORE, keyPath: "id", indexes: [{ name: "startedAt", keyPath: "startedAt" }] },
]);

const tx = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  db().then((connection) => runTransaction(connection, STORE, mode, run));

export async function putMeeting(meeting: LocalMeeting): Promise<void> {
  await tx("readwrite", (s) => s.put({ ...meeting, updatedAt: new Date().toISOString() }) as IDBRequest<IDBValidKey>);
}

export async function getMeeting(id: string): Promise<LocalMeeting | null> {
  try {
    return (await tx<LocalMeeting | undefined>("readonly", (s) => s.get(id) as IDBRequest<LocalMeeting | undefined>)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Newest first — the order a meeting list is always read in.
 *
 * Throws rather than returning an empty list when storage is unavailable. An
 * empty library and a broken library look identical to a user, and only one of
 * them has something they can do about it ("close your other tab", "you are in
 * private browsing"). The caller decides how to say so.
 */
export async function listMeetings(): Promise<LocalMeeting[]> {
  const rows = await tx<LocalMeeting[]>("readonly", (s) => s.getAll() as IDBRequest<LocalMeeting[]>);
  return rows.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export async function deleteMeeting(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

/** Everything, gone. Offered in settings so "delete my data" is one button. */
export async function clearLibrary(): Promise<void> {
  await tx("readwrite", (s) => s.clear() as IDBRequest<undefined>);
}
