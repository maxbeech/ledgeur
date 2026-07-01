// Tiny dependency-free IndexedDB wrapper for storing meetings locally in the
// browser. This is the ONLY place meeting data is persisted — there is no
// server. Everything here runs client-side.

export interface Meeting {
  id: string;
  title: string;
  dateISO: string;
  transcript: string;
  notesMarkdown: string;
  durationSec: number;
}

const DB_NAME = "parleynotes";
const STORE = "meetings";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export async function saveMeeting(m: Meeting): Promise<void> {
  await tx("readwrite", (s) => s.put(m));
}

export async function listMeetings(): Promise<Meeting[]> {
  const all = await tx<Meeting[]>("readonly", (s) => s.getAll() as IDBRequest<Meeting[]>);
  return all.sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
}

export async function deleteMeeting(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}
