// Watches today's events and fires a native, one-click "Record?" notification
// just before each meeting starts. Uses the Tauri notification plugin on the
// native shell; no-ops (safely) in the browser preview.

import { useEffect, useRef } from "react";
import type { CalendarEvent } from "@parleynotes/core";
import { eventsNeedingPrompt } from "@parleynotes/core";
import { isTauri } from "./runtime.ts";

const LEAD_MS = 60_000; // prompt ~1 minute before a meeting starts
const TICK_MS = 30_000;

async function notify(event: CalendarEvent) {
  if (!isTauri()) return;
  const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) return;
  sendNotification({
    title: `Starting now: ${event.title}`,
    body: "Tap to record this meeting in ParleyNotes.",
  });
}

/** Fire notifications for meetings about to start. Each event prompts once. */
export function useMeetingPrompts(events: CalendarEvent[] | null) {
  const prompted = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!events || events.length === 0) return;
    const tick = () => {
      const due = eventsNeedingPrompt(events, new Date(), LEAD_MS, prompted.current);
      for (const e of due) {
        prompted.current.add(e.id);
        void notify(e);
      }
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [events]);
}
