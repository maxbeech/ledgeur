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

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { listMeetings, saveMeeting } from "./meetingsStore.ts";

export interface Folder {
  id: string;
  name: string;
  /** A token name from the theme, so spaces read as part of the app rather
   *  than as arbitrary colour. */
  tone: FolderTone;
  createdAt: string;
}

export const FOLDER_TONES = ["accent", "glow", "muted", "danger"] as const;
export type FolderTone = (typeof FOLDER_TONES)[number];

const KEY = "ledgeur.folders";
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.round(Math.random() * 1e6)}`);

function load(): Folder[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f): f is Folder =>
      Boolean(f) && typeof f === "object"
      && typeof (f as Folder).id === "string" && typeof (f as Folder).name === "string");
  } catch {
    return [];
  }
}

let current: Folder[] = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable — keep the in-memory value */
  }
  for (const l of listeners) l();
}

export function getFolders(): Folder[] {
  return current;
}

export function createFolder(name: string, tone: FolderTone = "accent"): Folder {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the space a name.");
  if (current.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`You already have a space called “${trimmed}”.`);
  }
  const folder: Folder = { id: uid(), name: trimmed, tone, createdAt: new Date().toISOString() };
  current = [...current, folder];
  persist();
  return folder;
}

export function renameFolder(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the space a name.");
  current = current.map((f) => (f.id === id ? { ...f, name: trimmed } : f));
  persist();
}

/**
 * Delete a space. The meetings in it are kept and moved back to unfiled —
 * deleting a folder must never be a way to lose a recording, and a meeting
 * pointing at a space that no longer exists would be invisible in every filter.
 */
export async function deleteFolder(id: string): Promise<number> {
  current = current.filter((f) => f.id !== id);
  persist();
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
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useFolders(): Folder[] {
  return useSyncExternalStore(subscribe, getFolders, getFolders);
}

export const folderById = (id: string | undefined | null): Folder | undefined =>
  id ? current.find((f) => f.id === id) : undefined;

/** How many meetings are in each space, plus how many are unfiled. Recomputed
 *  whenever the folder set changes or a meeting moves. */
export function useFolderCounts(): { byFolder: Record<string, number>; unfiled: number } {
  const folders = useFolders();
  const [counts, setCounts] = useState<{ byFolder: Record<string, number>; unfiled: number }>({ byFolder: {}, unfiled: 0 });
  useEffect(() => {
    let live = true;
    void listMeetings().then((meetings) => {
      if (!live) return;
      const byFolder: Record<string, number> = {};
      let unfiled = 0;
      for (const m of meetings) {
        if (m.folderId && folders.some((f) => f.id === m.folderId)) byFolder[m.folderId] = (byFolder[m.folderId] ?? 0) + 1;
        else unfiled++;
      }
      setCounts({ byFolder, unfiled });
    });
    return () => { live = false; };
  }, [folders]);
  return counts;
}
