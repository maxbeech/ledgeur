// Unified task list. Cloud action_items (cross-device, RLS-scoped, with real DB
// status) merged with action items from local meetings that haven't synced yet
// (done-state kept in localStorage until they do). Real data or explicit errors.

import { useCallback, useEffect, useState } from "react";
import { listActionItemsWithMeeting, setActionItemStatus } from "@ledgeur/core";
import { listMeetings as listLocal } from "./meetingsStore.ts";
import { getSupabase } from "./supabase.ts";

export interface TaskItem {
  key: string;
  text: string;
  meetingId: string | null;
  meetingTitle: string;
  done: boolean;
  source: "cloud" | "local";
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
          return { key, text, meetingId: m.id, meetingTitle: m.title, done: done.has(key), source: "local" as const };
        }));

      setTasks([...cloud, ...local]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTasks((t) => t ?? []);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggle = useCallback(async (task: TaskItem) => {
    const next = !task.done;
    // Optimistic flip; revert on cloud failure.
    setTasks((ts) => (ts ?? []).map((t) => (t.key === task.key ? { ...t, done: next } : t)));
    if (task.source === "cloud") {
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

  return { tasks, error, refresh, toggle };
}
