// Unified task list. Three sources, one list:
//
//   cloud    action_items the backend holds (cross-device, RLS-scoped, real
//            status), extracted from meetings;
//   local    action items from meetings on this device that have not synced
//            yet (done-state in localStorage until they do);
//   capture  thoughts somebody kept that the model read as tasks (captures.ts).
//
// Captures are not copied into `action_items`. A capture's kind is a field a
// person can flip in one tap, and across two tables that tap would be a delete
// and an insert. This screen is a view over both, which is a question of what a
// list shows rather than of where a thought lives.

import { useCallback, useEffect, useState } from "react";
import { listActionItemsWithMeeting, setActionItemStatus } from "@ledgeur/core";
import { getMeeting as getLocalMeeting, listMeetings as listLocal, saveMeeting as saveLocalMeeting, subscribeMeetings } from "./meetingsStore.ts";
import { addCapture, deleteCapture, getCaptures, setCaptureDone, setCaptureKind, subscribeCaptures } from "./captures.ts";
import { getSupabase } from "./supabase.ts";

export interface TaskItem {
  key: string;
  text: string;
  meetingId: string | null;
  meetingTitle: string;
  done: boolean;
  source: "cloud" | "local" | "capture";
  /**
   * Whether this task was pulled out of a transcript by the model rather than
   * written by a person. Every meeting-derived item is: there is no path to
   * hand-add an action item to a meeting, only to a capture — see
   * `addTask` below, which is exactly that path. A capture carries its own
   * answer (`kindSource`), because it is the one kind of task a person can
   * actually author directly.
   */
  auto: boolean;
  /** Captures only: the space it is filed in, for grouping and re-filing. */
  spaceId?: string;
  /** Captures only: true while the kind is still the model's guess, so the UI
   *  can offer "not a task?" rather than presenting it as settled. */
  guessed?: boolean;
}

const DONE_KEY = "ledgeur.tasks.done";
const loadDone = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]") as string[]); } catch { return new Set(); }
};
const saveDone = (s: Set<string>) => localStorage.setItem(DONE_KEY, JSON.stringify([...s]));

export function useTasks() {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setError("");
      let cloud: TaskItem[] = [];
      let cloudOk = false;
      const sb = getSupabase();
      if (sb) {
        const { data: { session } } = await sb.auth.getSession();
        if (session) {
          try {
            const items = await listActionItemsWithMeeting(sb);
            cloud = items
              .filter((i) => i.status !== "cancelled")
              .map((i) => ({
                key: `cloud:${i.id}`, text: i.title, meetingId: i.meetingId,
                meetingTitle: i.meetingTitle, done: i.status === "done", source: "cloud" as const,
                auto: true,
              }));
            cloudOk = true;
          } catch (e) {
            // Signed in but the query failed — surface it, keep local items.
            setError(e instanceof Error ? e.message : String(e));
          }
        }
      }

      const done = loadDone();
      const localMeetings = await listLocal();
      const local: TaskItem[] = localMeetings
        .filter((m) => !cloudOk || !m.synced) // synced items live in the cloud list
        .flatMap((m) => m.actionItems.map((text) => {
          const key = `${m.id}::${text}`;
          return { key, text, meetingId: m.id, meetingTitle: m.title, done: done.has(key), source: "local" as const, auto: true };
        }));

      const captured: TaskItem[] = getCaptures()
        .filter((c) => c.kind === "task")
        .map((c) => ({
          key: `capture:${c.id}`, text: c.title || c.text, meetingId: null,
          meetingTitle: "Captured", done: Boolean(c.done), source: "capture" as const,
          spaceId: c.spaceId, guessed: c.kindSource === "inferred", auto: c.kindSource === "inferred",
        }));

      setTasks([...cloud, ...local, ...captured]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTasks((t) => t ?? []);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const offMeetings = subscribeMeetings(() => { void refresh(); });
    const offCaptures = subscribeCaptures(() => { void refresh(); });
    return () => { offMeetings(); offCaptures(); };
  }, [refresh]);

  const toggle = useCallback(async (task: TaskItem) => {
    const next = !task.done;
    // Optimistic flip; revert on cloud failure.
    setTasks((ts) => (ts ?? []).map((t) => (t.key === task.key ? { ...t, done: next } : t)));
    if (task.source === "capture") {
      // The store notifies, which refreshes this list — so the optimistic flip
      // above is only ever visible for the moment before the real value lands.
      setCaptureDone(task.key.slice("capture:".length), next);
    } else if (task.source === "cloud") {
      const sb = getSupabase();
      if (!sb) return;
      try {
        await setActionItemStatus(sb, task.key.slice("cloud:".length), next ? "done" : "open");
      } catch (e) {
        setTasks((ts) => (ts ?? []).map((t) => (t.key === task.key ? { ...t, done: task.done } : t)));
        setError(e instanceof Error ? e.message : String(e));
      }
    } else {
      const done = loadDone();
      if (next) done.add(task.key); else done.delete(task.key);
      saveDone(done);
    }
  }, []);

  /**
   * Add a task by hand.
   *
   * Meeting action items have no such path — they are always what the model
   * pulled out of a transcript, and there is nowhere to hand-insert one into a
   * meeting's notes. A capture is the one kind of task a person can actually
   * author, so that is what this creates: kind "task", `kindSource: "user"`
   * from the start, so it is never shown as a guess and never re-sorted by a
   * later classification pass (see `setKind` in @ledgeur/core).
   */
  const addTask = useCallback((text: string) => {
    const record = addCapture(text, "typed");
    setCaptureKind(record.id, "task");
    // The store's own notification refreshes this list.
  }, []);

  /**
   * Remove a task outright, not just mark it done.
   *
   * Each source keeps its own idea of "gone": a capture is deleted for real
   * (nothing else references it); a cloud action item is marked `cancelled`,
   * the status the rest of the app already treats as removed (see the `cloud`
   * filter above) rather than a hard delete, since it is a row a meeting
   * produced and other devices may still be looking at; a local, unsynced
   * action item lives only as a string inside its meeting's `actionItems`
   * array, so removing it means saving the meeting without that one entry.
   */
  const removeTask = useCallback(async (task: TaskItem) => {
    setTasks((ts) => (ts ?? []).filter((t) => t.key !== task.key));
    try {
      if (task.source === "capture") {
        deleteCapture(task.key.slice("capture:".length));
      } else if (task.source === "cloud") {
        const sb = getSupabase();
        if (!sb) return;
        await setActionItemStatus(sb, task.key.slice("cloud:".length), "cancelled");
      } else if (task.meetingId) {
        const meeting = await getLocalMeeting(task.meetingId);
        if (!meeting) return;
        const index = meeting.actionItems.indexOf(task.text);
        if (index === -1) return;
        const actionItems = meeting.actionItems.filter((_, i) => i !== index);
        await saveLocalMeeting({ ...meeting, actionItems }, "meta");
      }
    } catch (e) {
      await refresh(); // put it back — the optimistic removal above was wrong
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refresh]);

  return { tasks, error, refresh, toggle, addTask, removeTask };
}
