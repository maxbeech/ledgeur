import { useNavigate } from "react-router-dom";
import { CalendarClock, Video, CircleDot, AlertCircle } from "lucide-react";
import { formatClock } from "@parleynotes/ui";
import { Button, Card, EmptyState, Spinner } from "./ui.tsx";
import { useTodayEvents } from "../lib/useCalendar.ts";
import { useMeetingPrompts } from "../lib/meetingPrompt.ts";
import { hasBackend } from "../lib/config.ts";

/** Today's meetings from the connected calendar, with one-click record + the
 *  native auto-prompt watcher. Honest states: signed-out, error, empty. */
export function TodaySchedule() {
  const nav = useNavigate();
  const { events, error, signedIn } = useTodayEvents();
  useMeetingPrompts(events);

  if (!signedIn) {
    return (
      <Card className="p-2">
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" />}
          title={hasBackend ? "Connect your calendar" : "Connect your calendar"}
          body="Sign in with Google or Microsoft to see today's meetings and get a one-click prompt to record when each one starts."
          action={<Button variant="outline" onClick={() => nav("/integrations")}>Connect calendar</Button>}
        />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-red-700">
        <AlertCircle className="h-4 w-4" /> {error}
      </Card>
    );
  }

  if (events === null) {
    return <Card className="flex items-center justify-center gap-2 p-6 text-sm text-muted"><Spinner /> Loading your calendar…</Card>;
  }

  if (events.length === 0) {
    return (
      <Card className="p-2">
        <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No meetings today" body="Enjoy the focus time. New meetings will appear here automatically." />
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-hairline">
      {events.map((e) => (
        <div key={e.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="tabular-nums text-sm font-medium text-ink-text">{formatClock(e.startsAt)}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm text-ink-text">{e.title}</span>
                {e.isOnline && <Video className="h-3.5 w-3.5 shrink-0 text-accent-strong" />}
              </div>
            </div>
          </div>
          <Button onClick={() => nav(`/record?title=${encodeURIComponent(e.title)}`)}>
            <CircleDot className="h-4 w-4" /> Record
          </Button>
        </div>
      ))}
    </Card>
  );
}
