// Whether the capture box is open, and what it should be doing when it opens.
//
// A module-level store rather than context, for one reason: everything that can
// open this box — a keyboard shortcut on the laptop, a tab on the phone, a
// button in the sidebar, a deep link from a home-screen widget — sits in a
// different part of the tree, and threading a callback to all of them is how
// one of them ends up not working.

import { useSyncExternalStore } from "react";

/** How the box opens. `speak` starts listening immediately: a person who tapped
 *  a microphone has already decided, and making them tap a second one is the
 *  difference between catching a thought and losing it. */
export type CaptureMode = "type" | "speak";

interface DockState {
  open: boolean;
  mode: CaptureMode;
  /** The last capture kept, so the confirmation can follow it from "kept" to
   *  "filed in Acme" as the sort finishes. Cleared when it is acknowledged. */
  lastId: string | null;
}

let state: DockState = { open: false, mode: "type", lastId: null };
const listeners = new Set<() => void>();

function set(patch: Partial<DockState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function openCapture(mode: CaptureMode = "type"): void {
  set({ open: true, mode });
}

export function closeCapture(): void {
  set({ open: false });
}

/** Announce a capture that was just kept, so the confirmation can show it. */
export function announceCapture(id: string): void {
  set({ lastId: id });
}

export function clearAnnouncement(): void {
  set({ lastId: null });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const snapshot = (): DockState => state;

export function useCaptureDock(): DockState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
