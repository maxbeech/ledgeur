// Pure scheduling logic for the meeting auto-prompt. Decides which calendar
// events should trigger a "Record?" notification. Deterministic — unit-tested.
// (I/O — fetching calendar + firing native notifications — lives in the app.)

import type { CalendarEvent } from "../domain/entities.ts";

/** Events happening today (local), sorted by start. */
export function eventsToday(events: CalendarEvent[], now: Date): CalendarEvent[] {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const start = new Date(y, m, d).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return events
    .filter((e) => { const t = new Date(e.startsAt).getTime(); return t >= start && t < end; })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

/** The next event starting at/after `now`. */
export function nextUpcoming(events: CalendarEvent[], now: Date): CalendarEvent | null {
  const future = events
    .filter((e) => new Date(e.startsAt).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return future[0] ?? null;
}

/** Events within `leadMs` of starting (and not already ended) that we haven't
 *  prompted for yet — these should raise a one-click "Record?" notification. */
export function eventsNeedingPrompt(
  events: CalendarEvent[],
  now: Date,
  leadMs: number,
  alreadyPrompted: ReadonlySet<string>,
): CalendarEvent[] {
  const t = now.getTime();
  return events.filter((e) => {
    if (alreadyPrompted.has(e.id)) return false;
    const start = new Date(e.startsAt).getTime();
    const end = new Date(e.endsAt).getTime();
    return start - t <= leadMs && end > t; // within the lead window and not over
  });
}

/**
 * The one event that should start recording by itself, or null.
 *
 * Auto-start is the difference between a recorder you have to remember and one
 * that is simply always on for the meetings that matter, so the rules are
 * deliberately conservative — a recording nobody asked for is a much worse
 * failure than a meeting you had to start by hand:
 *
 *   online only     an event with a join link is a call. A "Lunch" block or a
 *                   focus-time hold is not, and recording your kitchen because
 *                   the calendar said something is exactly the behaviour that
 *                   makes people uninstall a recorder.
 *   just started    within `graceMs` of the start time, so waking the laptop
 *                   an hour into the day does not retroactively start a
 *                   recording for a meeting that is nearly over.
 *   not ended       obvious, and cheap to get wrong across a timezone bug.
 *   once each       `alreadyStarted` is the caller's memory, so declining and
 *                   stopping a take does not restart it seconds later.
 *
 * One event, not a list: two recordings at once is never right, and picking the
 * earliest is the only defensible tie-break.
 */
export function eventToAutoStart(
  events: CalendarEvent[],
  now: Date,
  graceMs: number,
  alreadyStarted: ReadonlySet<string>,
): CalendarEvent | null {
  const t = now.getTime();
  const due = events
    .filter((e) => {
      if (alreadyStarted.has(e.id)) return false;
      if (!e.isOnline) return false;
      const start = new Date(e.startsAt).getTime();
      const end = new Date(e.endsAt).getTime();
      return start <= t && t - start <= graceMs && end > t;
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return due[0] ?? null;
}

/** Human-readable event list for the Ask copilot's context block. */
export function formatEventsForContext(events: CalendarEvent[]): string {
  return events
    .map((e) => `${e.title} — ${new Date(e.startsAt).toLocaleString()}${e.isOnline ? " (online)" : ""}`)
    .join("\n");
}
