// Home: a greeting, the way to start, today's calendar, and the latest
// meetings. All real data with explicit empty states.
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Clock, Upload } from "lucide-react";
import { relativeTime } from "@ledgeur/ui";
import { Page } from "../components/PageHeader.tsx";
import { Badge, Button, Card, EmptyState, SectionHeader } from "../components/ui.tsx";
import { TodaySchedule } from "../components/TodaySchedule.tsx";
import { RecordDot } from "../components/RecordDot.tsx";
import { useMeetings } from "../lib/useMeetings.ts";
import { useTasks } from "../lib/useTasks.ts";
import { useRecorderCtx } from "../lib/useRecorderCtx.ts";
import { useSession } from "../lib/session.ts";

function greeting(now: Date, name: string | null): string {
  const h = now.getHours();
  const time = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${time}, ${name}` : time;
}

export function Home() {
  const nav = useNavigate();
  const { cards } = useMeetings();
  const { tasks } = useTasks();
  const { state } = useRecorderCtx();
  const { session } = useSession();
  const now = new Date();
  const recent = (cards ?? []).slice(0, 6);
  const openTasks = (tasks ?? []).filter((t) => !t.done).length;
  const recording = state.status === "recording";
  const firstName = session?.user?.user_metadata?.full_name?.split(" ")[0] ?? null;

  return (
    <Page>
      <header className="mb-6">
        <h1 className="ldg-display text-3xl leading-tight text-ink-text">{greeting(now, firstName)}</h1>
        <p className="mt-1.5 text-base text-muted">
          {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          {cards && cards.length > 0 && <> · {cards.length} meeting{cards.length === 1 ? "" : "s"} on record</>}
          {tasks && openTasks > 0 && <> · {openTasks} open task{openTasks === 1 ? "" : "s"}</>}
        </p>
      </header>

      {/* The one thing this screen is for. */}
      <Card raised className="mb-8 flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-danger-soft">
            <RecordDot live={recording} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-lg font-semibold text-ink-text">{recording ? "A meeting is being recorded" : "Record a meeting"}</div>
            <p className="text-sm text-muted">
              {recording ? "Transcribing on this device as it happens." : "Transcribed on this device as it happens. Nothing leaves the machine."}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {!recording && (
            <Button tone="secondary" onClick={() => nav("/record#import")}>
              <Upload className="h-4 w-4" /> Import a recording
            </Button>
          )}
          <Button onClick={() => nav("/record")}>{recording ? "Open the meeting" : "Start recording"}</Button>
        </div>
      </Card>

      <section className="mb-8">
        <SectionHeader title="Today" />
        <TodaySchedule />
      </section>

      <section>
        <SectionHeader
          title="Recent meetings"
          action={recent.length > 0 ? (
            <Button size="sm" tone="ghost" onClick={() => nav("/meetings")}>Open the library</Button>
          ) : undefined}
        />
        {recent.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Clock className="h-5 w-5" />}
              title="Nothing on record yet"
              body="Record your first meeting and it becomes searchable — summary, decisions and action items included."
              action={<Button onClick={() => nav("/record")}><RecordDot /> Record a meeting</Button>}
            />
          </Card>
        ) : (
          <Card className="divide-y divide-hairline">
            {recent.map((m) => (
              <button
                key={`${m.source}-${m.id}`}
                onClick={() => nav(`/meetings/${m.id}`)}
                className="group flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-muted"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-base font-medium text-ink-text">{m.title}</span>
                    {m.source === "local" && <Badge tone="warn">On this device</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-faint">
                    {relativeTime(m.createdAt, now)} · {m.wordCount} words · {m.actionItemCount} task{m.actionItemCount === 1 ? "" : "s"}
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-ink-text" />
              </button>
            ))}
          </Card>
        )}
      </section>
    </Page>
  );
}
