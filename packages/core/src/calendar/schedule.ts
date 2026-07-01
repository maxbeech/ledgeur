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
