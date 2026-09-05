// Watches today's events and either fires a native, one-click "Record?"
// notification just before each meeting starts, or — when the user has asked
// for it — starts the recording itself. Uses the Tauri notification plugin on
// the native shell; no-ops (safely) in the browser preview.
//
// ── Auto-start ──────────────────────────────────────────────────────────────
// The rules for what may start on its own are pure and live in @ledgeur/core
// (calendar/schedule.ts), where they are unit-tested, because getting them
// wrong means recording something nobody meant to record. In summary: only an
// event with a join link, only within a couple of minutes of its start, only
// once, and never over a take that is already running.
//
// The user is told, loudly, every time: a notification fires with the meeting's
// name, and the recording is visible in the sidebar from the first second.
// Recording that begins without a person pressing anything has to announce
// itself, or the feature is a surveillance bug rather than a convenience.

import { useEffect, useRef } from "react";
import type { CalendarEvent } from "@ledgeur/core";
import { eventsNeedingPrompt, eventToAutoStart } from "@ledgeur/core";
import { isTauri } from "./runtime.ts";
import { getSettings } from "./settings.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("meeting-prompt");

const LEAD_MS = 60_000; // prompt ~1 minute before a meeting starts
const TICK_MS = 30_000;
/** How late a meeting may be picked up for auto-start. Two minutes covers a
 *  calendar poll and a laptop waking; past that the meeting is under way and
 *  starting a recording is a surprise. */
const AUTO_START_GRACE_MS = 120_000;

async function notify(title: string, body: string) {
  if (!isTauri()) return;
  const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) return;
  sendNotification({ title, body });
}

export interface AutoStartOptions {
  /** Begin recording. Provided by the caller so this module stays free of the
   *  recorder — it decides *whether*, not *how*. */
  start: (event: CalendarEvent) => void;
  /** True when a take is already running: never interrupt one. */
  busy: boolean;
}

/** Fire notifications for meetings about to start. Each event prompts once.
 *  When auto-start is enabled, an online meeting that has just begun starts
 *  recording instead of only prompting. */
export function useMeetingPrompts(events: CalendarEvent[] | null, autoStart?: AutoStartOptions) {
  const prompted = useRef<Set<string>>(new Set());
  const started = useRef<Set<string>>(new Set());
  const autoRef = useRef(autoStart);
  autoRef.current = autoStart;

  useEffect(() => {
    if (!events || events.length === 0) return;
    const tick = () => {
      const now = new Date();
      const auto = autoRef.current;

      if (auto && !auto.busy && getSettings().autoStartFromCalendar) {
        const due = eventToAutoStart(events, now, AUTO_START_GRACE_MS, started.current);
        if (due) {
          started.current.add(due.id);
          // Also mark it prompted: having just started recording it, a "Record?"
          // notification for the same meeting would be nonsense.
          prompted.current.add(due.id);
          log.info("auto-starting a calendar meeting", { id: due.id, title: due.title });
          void notify(`Recording: ${due.title}`, "Ledgeur started this automatically. Open it to stop.");
          auto.start(due);
          return;
        }
      }

      const dueToPrompt = eventsNeedingPrompt(events, now, LEAD_MS, prompted.current);
      for (const e of dueToPrompt) {
        prompted.current.add(e.id);
        void notify(`Starting now: ${e.title}`, "Tap to record this meeting in Ledgeur.");
      }
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [events]);
}
