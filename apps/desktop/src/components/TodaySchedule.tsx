// Today's meetings from the connected calendar, with one-tap record. Honest
// states: signed-out, error, loading, empty.
//
// The prompt/auto-start watcher deliberately does NOT live here: it hung off
// this card and so only ran while Home was on screen. It is in the Shell now
// (CalendarWatcher), which is mounted for the app's whole lifetime.
import { useNavigate } from "react-router-dom";
import { CalendarClock, Video } from "lucide-react";
import { formatClock, cn } from "@ledgeur/ui";
import { Badge, Button, Card, EmptyState, ErrorNote, Spinner } from "./ui.tsx";
import { RecordDot } from "./RecordDot.tsx";
import { useTodayEvents } from "../lib/useCalendar.ts";

export function TodaySchedule() {
  const nav = useNavigate();
  const { events, error, signedIn } = useTodayEvents();

  if (!signedIn) {
    return (
      <Card>
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" />}
          title="Connect your calendar"
          body="Sign in with Google or Microsoft to see today's meetings, and get a one-tap prompt to record when each one starts."
          action={<Button tone="secondary" onClick={() => nav("/integrations")}>Connect a calendar</Button>}
        />
      </Card>
    );
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;

  if (events === null) {
    return <Card className="flex items-center justify-center gap-2 p-6 text-sm text-muted"><Spinner /> Loading your calendar</Card>;
  }

  if (events.length === 0) {
    return (
      <Card>
        <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="Nothing on today" body="New meetings appear here as your calendar changes." />
      </Card>
    );
  }

  const now = Date.now();
  return (
    <Card className="divide-y divide-hairline">
      {events.map((e) => {
        const live = now >= new Date(e.startsAt).getTime() && now < new Date(e.endsAt).getTime();
        return (
          <div key={e.id} className={cn("flex items-center justify-between gap-3 px-4 py-3", live && "bg-danger-soft/40")}>
            <div className="flex min-w-0 items-center gap-4">
              <span className="ldg-num w-14 shrink-0 text-right text-sm text-muted">{formatClock(e.startsAt)}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-base font-medium text-ink-text">{e.title}</span>
                  {e.isOnline && <Video className="h-3.5 w-3.5 shrink-0 text-sky-strong" />}
                </div>
                {live && <Badge tone="danger" className="mt-1"><RecordDot live className="h-1.5 w-1.5" /> Happening now</Badge>}
              </div>
            </div>
            <Button size="sm" tone={live ? "primary" : "secondary"} onClick={() => nav(`/record?title=${encodeURIComponent(e.title)}`)}>
              <RecordDot /> Record
            </Button>
          </div>
        );
      })}
    </Card>
  );
}
