// Tasks — every action item the record has produced. Cloud rows carry real DB
// status (cross-device); unsynced local items keep their done-state on-device.
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { SquareCheck, Check } from "lucide-react";
import { cn } from "@ledgeur/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Badge, Button, Card, EmptyState, ErrorNote, Spinner } from "../components/ui.tsx";
import { RecordDot } from "../components/RecordDot.tsx";
import { SendTaskButton } from "../components/SendTaskButton.tsx";
import { useTasks, type TaskItem } from "../lib/useTasks.ts";

export function Tasks() {
  const nav = useNavigate();
  const { tasks, error, toggle } = useTasks();

  const grouped = useMemo(() => {
    const map = new Map<string, { title: string; items: TaskItem[] }>();
    for (const t of tasks ?? []) {
      const key = t.meetingId ?? "unassigned";
      const g = map.get(key) ?? { title: t.meetingTitle, items: [] };
      g.items.push(t);
      map.set(key, g);
    }
    return [...map.entries()];
  }, [tasks]);

  const openCount = (tasks ?? []).filter((t) => !t.done).length;

  if (tasks === null && !error) {
    return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted"><Spinner /> Loading</div>;
  }

  return (
    <Page>
      <PageHeader
        title="Tasks"
        subtitle={`${openCount} open action item${openCount === 1 ? "" : "s"} from your meetings`}
      />
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}

      {(tasks ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<SquareCheck className="h-5 w-5" />}
            title="No action items yet"
            body="Action items are pulled out automatically when you record a meeting."
            action={<Button onClick={() => nav("/record")}><RecordDot /> Record a meeting</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([meetingId, group]) => (
            <section key={meetingId}>
              <button
                onClick={() => meetingId !== "unassigned" && nav(`/meetings/${meetingId}`)}
                className="ldg-label mb-2 transition-colors hover:text-ink-text"
              >
                {group.title}
              </button>
              <Card className="divide-y divide-hairline">
                {/* The row is a div, not a label: the send button has to sit
                    beside the checkbox, and a button inside a label toggles
                    the checkbox when you click it. So only the tickbox and the
                    text are inside the label. */}
                {group.items.map((t) => (
                  <div key={t.key} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-muted">
                    <label className="flex flex-1 cursor-pointer items-start gap-3">
                      <input type="checkbox" checked={t.done} onChange={() => void toggle(t)} className="peer sr-only" />
                      <span className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        t.done ? "border-accent-strong bg-accent-strong text-white" : "border-hairline-strong bg-surface peer-focus-visible:border-brand",
                      )}>
                        {t.done && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      <span className={cn("ldg-prose flex-1 text-base leading-relaxed text-ink-text transition-colors", t.done && "text-faint line-through")}>
                        {t.text}
                      </span>
                    </label>
                    {t.source === "local" && <Badge tone="warn">On this device</Badge>}
                    {!t.done && <SendTaskButton task={t} />}
                  </div>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
