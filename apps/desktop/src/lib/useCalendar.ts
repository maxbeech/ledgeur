// Loads today's calendar events for the signed-in user. Real data from the
// connected provider, or an explicit error (e.g. token expired) — never faked.

import { useEffect, useState } from "react";
import type { CalendarEvent } from "@ledgeur/core";
import { eventsToday } from "@ledgeur/core";
import { useSession } from "./session.ts";
import { fetchTodayEvents } from "./calendar.ts";

export function useTodayEvents() {
  const { session } = useSession();
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) { setEvents(null); return; }
    let cancelled = false;
    fetchTodayEvents(session, new Date())
      .then((evs) => { if (!cancelled) setEvents(eventsToday(evs, new Date())); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [session]);

  return { events, error, signedIn: Boolean(session) };
}
