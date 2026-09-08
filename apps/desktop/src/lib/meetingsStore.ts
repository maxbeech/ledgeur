// Local-first meeting cache (IndexedDB). Holds the user's real recordings on the
// device so the app works fully offline; the sync engine (sync.ts) mirrors
// these to and from the cloud once an account is signed in. No dummy data —
// entries exist only after a real recording, an import, or a pull.
//
// ── What "saving" means now ─────────────────────────────────────────────────
// Every edit a person makes stamps `updatedAt` with this device's clock and
// marks the meeting dirty, so the engine knows what to push and the other
// devices know which edit is later. The engine itself writes with intent
// "none": what it writes is already the cloud's truth, not a new edit.
//
// Deleting a synced meeting leaves a tombstone (the row minus its transcript,
// with `deletedAt` set) until the engine has told the cloud; without that, the
// other device would push the meeting straight back.

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
  /** For an assistant answer: the context sources it was allowed to see, in
   *  prompt order. This is the answer's provenance — shown under the bubble so
   *  "where did that come from?" is answerable without re-asking. */
  sources?: string[];
  /** Set only when something was missing: a context source that failed, timed
   *  out, or did not fit. An answer that saw everything carries nothing here. */
  missing?: string;
}

/** A distinct voice in a meeting, with the vector that identifies it.
 *
 *  The embedding is kept so a speaker can be named *later* — a week after the
 *  recording, from the library — and still teach the app that voice. Without it,
 *  "who is this?" would only be answerable while the audio was still in memory,
 *  which is the one moment nobody is thinking about it.
 *
 *  It is never synced. The engine strips it, and a test asserts no payload can
 *  carry one. */
export interface LocalSpeaker {
  /** Matches `LocalSegment.speakerLabel` at the time the meeting was saved. */
  label: string;
  /** 0..1 similarity when the label came from a match; null once a person has
   *  typed it, because it is then not a guess. */
  confidence: number | null;
  /** Mean voice vector for this speaker across the meeting. */
  embedding?: number[];
  speakingSeconds: number;
}

/** What the engine still has to send: nothing, the metadata, or everything. */
export type Dirty = "meta" | "full";

export interface LocalMeeting {
  id: string;
  title: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  status: "recording" | "processing" | "complete" | "failed";
  lang: string;
  segments: LocalSegment[];
  /** One entry per distinct voice. Absent on meetings recorded before speaker
   *  separation existed — the UI treats that as "no speakers to name". */
  speakers?: LocalSpeaker[];
  summary: string[];
  decisions: string[];
  questions: string[];
  actionItems: string[];
  /** Notes the user typed during the meeting (kept verbatim in the export). */
  manualNotes?: string;
  /** Copilot/user/suggestion thread — persisted only when the user opts in
   *  (Settings → "Save copilot chat with the meeting"). Never synced. */
  messages?: ChatMessage[];
  noteMarkdown: string;
  wordCount: number;
  /** True once the cloud has this meeting under this id. */
  synced: boolean;
  /** The space this meeting is filed in (see folders.ts). Absent = unfiled,
   *  which is the correct state for most meetings and the default. */
  folderId?: string;
  /** Which note template wrote the notes, kept so the meeting can say so and
   *  so notes can be regenerated the same way. */
  templateId?: string;
  /** Whether the on-device model wrote these notes or the heuristic extractor
   *  did. Absent on meetings recorded before this was tracked. The extractor
   *  lifts sentences straight out of the transcript, which reads as a model
   *  doing a bad job rather than as no model having run — so the meeting says
   *  which it was. */
  notesGenerator?: "model" | "extractive";
  /** When this device last edited it — the stamp the cloud compares. */
  updatedAt?: string;
  /** A tombstone: deleted here, not yet told to the cloud. */
  deletedAt?: string;
  /** When the engine last agreed with the cloud about this meeting. */
  syncedAt?: string;
  /** Edits the cloud has not seen yet. Absent = in step. */
  dirty?: Dirty;
  /** Who recorded it, once known. A meeting someone else shared is read-only
   *  here — edits would be refused by the database anyway. */
  ownerId?: string;
  orgId?: string;
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

/* ---------------------------------------------------------------- change bus */
// Screens subscribe so a pull, a rename or a delete shows up without a reload.
const listeners = new Set<() => void>();
function notify(): void {
  for (const l of listeners) l();
}
export function subscribeMeetings(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** What a save means for sync: a person's edit ("meta" for title, notes,
 *  filing; "full" when the transcript or speakers changed) or the engine
 *  writing what the cloud already has ("none"). */
export type SaveIntent = Dirty | "none";

const rank: Record<Dirty, number> = { meta: 1, full: 2 };

export async function saveMeeting(m: LocalMeeting, intent: SaveIntent = "meta"): Promise<void> {
  let next = m;
  if (intent !== "none") {
    const dirty: Dirty = m.dirty && rank[m.dirty] > rank[intent] ? m.dirty : intent;
    next = { ...m, updatedAt: new Date().toISOString(), dirty };
  }
  await tx("readwrite", (s) => s.put(next));
  notify();
}

export async function getMeeting(id: string): Promise<LocalMeeting | undefined> {
  const m = await tx<LocalMeeting | undefined>("readonly", (s) => s.get(id) as IDBRequest<LocalMeeting | undefined>);
  return m && !m.deletedAt ? m : undefined;
}

/** Every meeting on this device that has not been deleted, newest first. */
export async function listMeetings(): Promise<LocalMeeting[]> {
  const all = await listMeetingRecords();
  return all.filter((m) => !m.deletedAt);
}

/** Everything in the store, tombstones included — the engine's view. */
export async function listMeetingRecords(): Promise<LocalMeeting[]> {
  const all = await tx<LocalMeeting[]>("readonly", (s) => s.getAll() as IDBRequest<LocalMeeting[]>);
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Delete a meeting here.
 *
 * A meeting the cloud knows about becomes a tombstone until the engine has
 * passed the deletion on; one it never knew about simply goes.
 */
export async function deleteMeeting(id: string): Promise<void> {
  const m = await tx<LocalMeeting | undefined>("readonly", (s) => s.get(id) as IDBRequest<LocalMeeting | undefined>);
  if (!m) return;
  if (m.synced) {
    const now = new Date().toISOString();
    const tombstone: LocalMeeting = {
      ...m, segments: [], speakers: undefined, messages: undefined, noteMarkdown: "",
      deletedAt: now, updatedAt: now, dirty: "meta",
    };
    await tx("readwrite", (s) => s.put(tombstone));
  } else {
    await tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
  }
  notify();
}

/** Remove a record outright — the engine, once the cloud has agreed. */
export async function purgeMeeting(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
  notify();
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
