// Today's meetings from the connected calendar, with one-click record + the
// native auto-prompt watcher. Honest states: signed-out, error, loading, empty.
import { useNavigate } from "react-router-dom";
import { CalendarClock, Video, CircleDot } from "lucide-react";
import { formatClock } from "@parleynotes/ui";
import { Button, Card, EmptyState, ErrorNote, Spinner } from "./ui.tsx";
import { useTodayEvents } from "../lib/useCalendar.ts";
import { useMeetingPrompts } from "../lib/meetingPrompt.ts";

export function TodaySchedule() {
  const nav = useNavigate();
  const { events, error, signedIn } = useTodayEvents();
  useMeetingPrompts(events);

  if (!signedIn) {
    return (
      <Card>
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" />}
          title="Connect your calendar"
          body="Sign in with Google or Microsoft to see today's meetings and get a one-click prompt to record when each one starts."
          action={<Button variant="outline" onClick={() => nav("/integrations")}>Connect calendar</Button>}
        />
      </Card>
    );
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;

  if (events === null) {
    return <Card className="flex items-center justify-center gap-2 p-6 text-sm text-muted"><Spinner /> Loading your calendar…</Card>;
  }

  if (events.length === 0) {
    return (
      <Card>
        <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No meetings today" body="Enjoy the focus time. New meetings will appear here automatically." />
      </Card>
    );
  }

  const now = Date.now();
  return (
    <Card className="divide-y divide-hairline">
      {events.map((e) => {
        const live = now >= new Date(e.startsAt).getTime() && now < new Date(e.endsAt).getTime();
        return (
          <div key={e.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
            <div className="flex min-w-0 items-center gap-4">
              <span className="w-16 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted">{formatClock(e.startsAt)}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-ink-text">{e.title}</span>
                  {e.isOnline && <Video className="h-3.5 w-3.5 shrink-0 text-accent-strong" />}
                </div>
                {live && (
                  <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-danger">
                    <span className="pn-pulse h-1.5 w-1.5 rounded-full bg-danger" /> Happening now
                  </span>
                )}
              </div>
            </div>
            <Button size="sm" variant={live ? "accent" : "outline"} onClick={() => nav(`/record?title=${encodeURIComponent(e.title)}`)}>
              <CircleDot className="h-3.5 w-3.5" /> Record
            </Button>
          </div>
        );
      })}
    </Card>
  );
}
