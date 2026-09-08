// Spaces — the folders a library needs once it stops being ten meetings.
//
// Deliberately one level deep. Nested folders look more capable and are worse:
// people spend the effort on where a meeting goes instead of on the meeting,
// and then cannot find it because it is two levels down a tree they built six
// months ago. One flat set of spaces ("Customers", "Hiring", "Board") plus
// search covers what nesting was for.
//
// A meeting's space is stored on the meeting itself (`LocalMeeting.folderId`),
// not as a membership list here, so a space can be deleted without orphaning
// anything and a meeting can never be in two places or in none.
//
// Spaces follow the account: every edit is stamped, a deleted space leaves a
// tombstone until the engine has told the cloud, and a space made on the phone
// appears on the laptop (see sync.ts).

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { listMeetings, saveMeeting, subscribeMeetings } from "./meetingsStore.ts";
import { rescueOrphanedCaptures } from "./captures.ts";

export interface Folder {
  id: string;
  name: string;
  /** One of the design system's pastel families, so spaces read as part of
   *  the app rather than as arbitrary colour. */
  tone: FolderTone;
  createdAt: string;
  updatedAt: string;
  /** A tombstone: deleted here, not yet acknowledged by the cloud. */
  deletedAt?: string;
}

export const FOLDER_TONES = ["sky", "rose", "mint", "butter", "peach", "iris"] as const;
export type FolderTone = (typeof FOLDER_TONES)[number];

/** A new space takes the next family along, so the first six are distinct. */
export function nextFolderTone(existing: readonly { tone: string }[]): FolderTone {
  return FOLDER_TONES[existing.length % FOLDER_TONES.length];
}

/** Older stores named tones after the old theme; map them onto a family. */
export function normaliseTone(tone: unknown): FolderTone {
  if (typeof tone === "string" && (FOLDER_TONES as readonly string[]).includes(tone)) return tone as FolderTone;
  return "sky";
}

const KEY = "ledgeur.folders";
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.round(Math.random() * 1e6)}`);

function load(): Folder[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f): f is Folder =>
        Boolean(f) && typeof f === "object"
        && typeof (f as Folder).id === "string" && typeof (f as Folder).name === "string")
      .map((f) => ({ ...f, tone: normaliseTone(f.tone), updatedAt: f.updatedAt ?? f.createdAt ?? "1970-01-01T00:00:00.000Z" }));
  } catch {
    return [];
  }
}

let records: Folder[] = load();
let live: Folder[] = records.filter((f) => !f.deletedAt);
const listeners = new Set<() => void>();

function commit(next: Folder[]) {
  records = next;
  live = records.filter((f) => !f.deletedAt);
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* storage unavailable — keep the in-memory value */
  }
  for (const l of listeners) l();
}

export function getFolders(): Folder[] {
  return live;
}

/** Everything, tombstones included — the engine's view. */
export function getFolderRecords(): Folder[] {
  return records;
}

/** Write what the cloud has, without stamping: it is not a new edit. */
export function applyRemoteFolders(pulled: readonly Folder[], removed: readonly string[]): void {
  const byId = new Map(records.map((f) => [f.id, f]));
  for (const f of pulled) byId.set(f.id, f);
  for (const id of removed) byId.delete(id);
  commit([...byId.values()]);
  // A space deleted on the other device takes captures down with it unless
  // they are moved back to the inbox here. A capture pointing at a space that
  // is gone shows up in no list at all.
  rescueOrphanedCaptures(live.map((f) => f.id));
}

/** A tombstone the cloud has acknowledged can go. */
export function forgetFolders(ids: readonly string[]): void {
  if (ids.length === 0) return;
  commit(records.filter((f) => !ids.includes(f.id)));
}

export function createFolder(name: string, tone: FolderTone = nextFolderTone(live)): Folder {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the space a name.");
  if (live.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`You already have a space called “${trimmed}”.`);
  }
  const now = new Date().toISOString();
  const folder: Folder = { id: uid(), name: trimmed, tone, createdAt: now, updatedAt: now };
  commit([...records, folder]);
  return folder;
}

export function renameFolder(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the space a name.");
  commit(records.map((f) => (f.id === id ? { ...f, name: trimmed, updatedAt: new Date().toISOString() } : f)));
}

/**
 * Delete a space. The meetings and captures in it are kept and moved back to
 * unfiled — deleting a folder must never be a way to lose a recording or a
 * thought, and either one pointing at a space that no longer exists would be
 * invisible in every filter.
 */
export async function deleteFolder(id: string): Promise<number> {
  const now = new Date().toISOString();
  commit(records.map((f) => (f.id === id ? { ...f, deletedAt: now, updatedAt: now } : f)));
  rescueOrphanedCaptures(live.map((f) => f.id));
  const meetings = await listMeetings();
  const affected = meetings.filter((m) => m.folderId === id);
  for (const m of affected) await saveMeeting({ ...m, folderId: undefined });
  return affected.length;
}

/** Move a meeting into a space, or out of every space with `null`. */
export async function setMeetingFolder(meetingId: string, folderId: string | null): Promise<void> {
  const meetings = await listMeetings();
  const meeting = meetings.find((m) => m.id === meetingId);
  if (!meeting) throw new Error("That meeting is not on this device.");
  await saveMeeting({ ...meeting, folderId: folderId ?? undefined });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useFolders(): Folder[] {
  return useSyncExternalStore(subscribe, getFolders, getFolders);
}

export const folderById = (id: string | undefined | null): Folder | undefined =>
  id ? live.find((f) => f.id === id) : undefined;

/** How many meetings are in each space, plus how many are unfiled. Recomputed
 *  whenever the folder set changes or a meeting moves. */
export function useFolderCounts(): { byFolder: Record<string, number>; unfiled: number } {
  const folders = useFolders();
  const [counts, setCounts] = useState<{ byFolder: Record<string, number>; unfiled: number }>({ byFolder: {}, unfiled: 0 });
  useEffect(() => {
    let alive = true;
    const compute = () => {
      void listMeetings().then((meetings) => {
        if (!alive) return;
        const byFolder: Record<string, number> = {};
        let unfiled = 0;
        for (const m of meetings) {
          if (m.folderId && folders.some((f) => f.id === m.folderId)) byFolder[m.folderId] = (byFolder[m.folderId] ?? 0) + 1;
          else unfiled++;
        }
        setCounts({ byFolder, unfiled });
      });
    };
    compute();
    const off = subscribeMeetings(compute);
    return () => { alive = false; off(); };
  }, [folders]);
  return counts;
}
