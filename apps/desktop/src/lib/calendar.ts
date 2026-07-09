// Calendar fetch for the meeting auto-prompt and Ask context. Uses the OAuth
// provider token from the Supabase session to read Google Calendar or
// Microsoft Graph directly. Returns real events or throws an explicit error
// (never fabricated data).

import type { Session } from "@supabase/supabase-js";
import { formatEventsForContext, type CalendarEvent } from "@ledgeur/core";
import type { ContextBlock } from "./chat.ts";
import { getSupabase } from "./supabase.ts";

function rangeBounds(now: Date, days: number): { min: string; max: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + days * 24 * 3600 * 1000);
  return { min: start.toISOString(), max: end.toISOString() };
}

async function fetchGoogle(token: string, now: Date, days: number): Promise<CalendarEvent[]> {
  const { min, max } = rangeBounds(now, days);
  const p = new URLSearchParams({ timeMin: min, timeMax: max, singleEvents: "true", orderBy: "startTime" });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google Calendar ${res.status} — reconnect your calendar.`);
  const data = (await res.json()) as { items?: GoogleEvent[] };
  return (data.items ?? [])
    .filter((e) => e.start?.dateTime)
    .map((e) => ({
      id: e.id, provider: "google" as const, title: e.summary ?? "(no title)",
      startsAt: e.start!.dateTime!, endsAt: e.end?.dateTime ?? e.start!.dateTime!,
      isOnline: Boolean(e.hangoutLink || e.conferenceData), meetingUrl: e.hangoutLink ?? null,
    }));
}

async function fetchMicrosoft(token: string, now: Date, days: number): Promise<CalendarEvent[]> {
  const { min, max } = rangeBounds(now, days);
  const p = new URLSearchParams({ startDateTime: min, endDateTime: max, $orderby: "start/dateTime" });
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/calendarview?${p}`, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
  });
  if (!res.ok) throw new Error(`Microsoft Graph ${res.status} — reconnect your calendar.`);
  const data = (await res.json()) as { value?: MsEvent[] };
  return (data.value ?? []).map((e) => ({
    id: e.id, provider: "microsoft" as const, title: e.subject ?? "(no title)",
    startsAt: `${e.start.dateTime}Z`.replace(/Z+$/, "Z"), endsAt: `${e.end.dateTime}Z`.replace(/Z+$/, "Z"),
    isOnline: Boolean(e.isOnlineMeeting), meetingUrl: e.onlineMeeting?.joinUrl ?? null,
  }));
}

/** Events in the next `days` days for the signed-in user, from their connected calendar. */
export async function fetchUpcomingEvents(session: Session, now: Date, days = 1): Promise<CalendarEvent[]> {
  const token = session.provider_token;
  if (!token) throw new Error("Calendar access expired — reconnect your calendar in Integrations.");
  const provider = session.user.app_metadata?.provider;
  if (provider === "google") return fetchGoogle(token, now, days);
  if (provider === "azure") return fetchMicrosoft(token, now, days);
  throw new Error(`Calendar for provider "${provider ?? "unknown"}" is not supported yet.`);
}

/** Today's events for the signed-in user, from their connected calendar. */
export async function fetchTodayEvents(session: Session, now: Date): Promise<CalendarEvent[]> {
  return fetchUpcomingEvents(session, now, 1);
}

/** Calendar context for the Ask copilot: the next week's events, so questions
 *  like "what's my next meeting" have real grounding. Never throws — a
 *  missing/expired connection just means no calendar context, not a broken Ask. */
export async function calendarContext(): Promise<ContextBlock[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return [];
    const events = await fetchUpcomingEvents(session, new Date(), 7);
    if (!events.length) return [];
    return [{ source: "Calendar", text: formatEventsForContext(events) }];
  } catch {
    return [];
  }
}

interface GoogleEvent { id: string; summary?: string; hangoutLink?: string; conferenceData?: unknown; start?: { dateTime?: string }; end?: { dateTime?: string }; }
interface MsEvent { id: string; subject?: string; isOnlineMeeting?: boolean; onlineMeeting?: { joinUrl?: string }; start: { dateTime: string }; end: { dateTime: string }; }
