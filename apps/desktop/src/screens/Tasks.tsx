// Tasks — every action item the record has produced. Cloud rows carry real DB
// status (cross-device); unsynced local items keep their done-state on-device.
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { SquareCheck, CircleDot } from "lucide-react";
import { cn } from "@parleynotes/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, Chip, EmptyState, ErrorNote, Spinner } from "../components/ui.tsx";
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
    return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted"><Spinner /> Loading…</div>;
  }

  return (
    <Page>
      <PageHeader
        kicker="Follow through"
        title="Tasks"
        subtitle={`${openCount} open action item${openCount === 1 ? "" : "s"} from your meetings`}
      />
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}

      {(tasks ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<SquareCheck className="h-5 w-5" />}
            title="No action items yet"
            body="Action items are extracted automatically when you record a meeting."
            action={<Button variant="accent" onClick={() => nav("/record")}><CircleDot className="h-4 w-4" /> Record a meeting</Button>}
          />
        </Card>
      ) : (
        <div className="pn-stagger space-y-6">
          {grouped.map(([meetingId, group]) => (
            <section key={meetingId}>
              <button
                onClick={() => meetingId !== "unassigned" && nav(`/meetings/${meetingId}`)}
                className="pn-kicker mb-2 transition-colors hover:text-ink-text"
              >
                {group.title}
              </button>
              <Card className="divide-y divide-hairline">
                {group.items.map((t) => (
                  <label key={t.key} className="flex cursor-pointer items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-muted/40">
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() => void toggle(t)}
                      className="mt-0.5 h-4 w-4 accent-[var(--color-accent-strong)]"
                    />
                    <span className={cn("pn-prose flex-1 text-sm leading-relaxed text-ink-text transition-colors", t.done && "text-faint line-through")}>
                      {t.text}
                    </span>
                    {t.source === "local" && <Chip tone="warn">local</Chip>}
                  </label>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
