// Local-first meeting cache (IndexedDB). Holds the user's real recordings on the
// device so the app works fully offline; the sync layer (Supabase, cloud-primary)
// mirrors these upstream once auth + backend are configured. No dummy data —
// entries exist only after a real recording/import.

export interface LocalSegment {
  id: string;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
  /** Likelihood the speaker attribution is right (native voice-ID only). */
  speakerConfidence?: number | null;
}

/** A quoted bubble the user is replying to (transcript line or earlier message). */
export interface ChatQuote {
  text: string;
  label: string;
}

/** A non-transcript entry in the live meeting thread: a copilot answer, a user
 *  question, or a proactive coaching suggestion. Merged with transcript segments
 *  (by `atMs`) to form one continuous conversation. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "suggestion" | "error";
  text: string;
  /** Milliseconds since the meeting started — orders it against transcript. */
  atMs: number;
  quote?: ChatQuote;
}

export interface LocalMeeting {
  id: string;
  title: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  status: "recording" | "processing" | "complete" | "failed";
  lang: string;
  segments: LocalSegment[];
  summary: string[];
  decisions: string[];
  questions: string[];
  actionItems: string[];
  /** Notes the user typed during the meeting (kept verbatim in the export). */
  manualNotes?: string;
  /** Copilot/user/suggestion thread — persisted only when the user opts in
   *  (Settings → "Save copilot chat with the meeting"). */
  messages?: ChatMessage[];
  noteMarkdown: string;
  wordCount: number;
  synced: boolean;
}

const DB_NAME = "ledgeur";
const STORE = "meetings";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
        t.oncomplete = () => db.close();
      }),
  );
}

export async function saveMeeting(m: LocalMeeting): Promise<void> {
  await tx("readwrite", (s) => s.put(m));
}

export async function getMeeting(id: string): Promise<LocalMeeting | undefined> {
  return tx<LocalMeeting | undefined>("readonly", (s) => s.get(id) as IDBRequest<LocalMeeting | undefined>);
}

export async function listMeetings(): Promise<LocalMeeting[]> {
  const all = await tx<LocalMeeting[]>("readonly", (s) => s.getAll() as IDBRequest<LocalMeeting[]>);
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function deleteMeeting(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

/** All open action items across meetings — powers the Tasks screen locally. */
export async function listOpenActionItems(): Promise<{ meetingId: string; title: string; text: string }[]> {
  const meetings = await listMeetings();
  const out: { meetingId: string; title: string; text: string }[] = [];
  for (const m of meetings) {
    for (const t of m.actionItems) out.push({ meetingId: m.id, title: m.title, text: t });
  }
  return out;
}
