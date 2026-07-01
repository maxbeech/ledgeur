// Calendar fetch for the meeting auto-prompt. Uses the OAuth provider token from
// the Supabase session to read Google Calendar or Microsoft Graph directly.
// Returns real events or throws an explicit error (never fabricated data).

import type { Session } from "@supabase/supabase-js";
import type { CalendarEvent } from "@parleynotes/core";

function dayBounds(now: Date): { min: string; max: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { min: start.toISOString(), max: end.toISOString() };
}

async function fetchGoogle(token: string, now: Date): Promise<CalendarEvent[]> {
  const { min, max } = dayBounds(now);
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

async function fetchMicrosoft(token: string, now: Date): Promise<CalendarEvent[]> {
  const { min, max } = dayBounds(now);
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

/** Today's events for the signed-in user, from their connected calendar. */
export async function fetchTodayEvents(session: Session, now: Date): Promise<CalendarEvent[]> {
  const token = session.provider_token;
  if (!token) throw new Error("Calendar access expired — reconnect your calendar in Integrations.");
  const provider = session.user.app_metadata?.provider;
  if (provider === "google") return fetchGoogle(token, now);
  if (provider === "azure") return fetchMicrosoft(token, now);
  throw new Error(`Calendar for provider "${provider ?? "unknown"}" is not supported yet.`);
}

interface GoogleEvent { id: string; summary?: string; hangoutLink?: string; conferenceData?: unknown; start?: { dateTime?: string }; end?: { dateTime?: string }; }
interface MsEvent { id: string; subject?: string; isOnlineMeeting?: boolean; onlineMeeting?: { joinUrl?: string }; start: { dateTime: string }; end: { dateTime: string }; }
