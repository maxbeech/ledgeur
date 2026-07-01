import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckSquare, CircleDot } from "lucide-react";
import { cn } from "@parleynotes/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, EmptyState, Spinner } from "../components/ui.tsx";
import { listOpenActionItems } from "../lib/meetingsStore.ts";

const DONE_KEY = "parleynotes.tasks.done";
const loadDone = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]")); } catch { return new Set(); }
};

export function Tasks() {
  const nav = useNavigate();
  const [items, setItems] = useState<{ meetingId: string; title: string; text: string }[] | null>(null);
  const [done, setDone] = useState<Set<string>>(loadDone);

  useEffect(() => { listOpenActionItems().then(setItems); }, []);
  useEffect(() => { localStorage.setItem(DONE_KEY, JSON.stringify([...done])); }, [done]);

  const key = (i: { meetingId: string; text: string }) => `${i.meetingId}::${i.text}`;
  const grouped = useMemo(() => {
    const map = new Map<string, { title: string; tasks: typeof items }>();
    for (const it of items ?? []) {
      const g = map.get(it.meetingId) ?? { title: it.title, tasks: [] as typeof items };
      g.tasks!.push(it);
      map.set(it.meetingId, g);
    }
    return [...map.entries()];
  }, [items]);

  const openCount = (items ?? []).filter((i) => !done.has(key(i))).length;

  if (items === null) return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted"><Spinner /> Loading…</div>;

  return (
    <Page>
      <PageHeader title="Tasks" subtitle={`${openCount} open action item${openCount === 1 ? "" : "s"} from your meetings`} />
      {items.length === 0 ? (
        <Card className="p-2">
          <EmptyState icon={<CheckSquare className="h-5 w-5" />} title="No action items yet"
            body="Action items are extracted automatically when you record a meeting."
            action={<Button onClick={() => nav("/record")}><CircleDot className="h-4 w-4" /> Record a meeting</Button>} />
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map(([meetingId, group]) => (
            <div key={meetingId}>
              <button onClick={() => nav(`/meetings/${meetingId}`)} className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted hover:text-ink-text">{group.title}</button>
              <Card className="divide-y divide-hairline">
                {group.tasks!.map((t) => {
                  const k = key(t);
                  const isDone = done.has(k);
                  return (
                    <label key={k} className="flex cursor-pointer items-start gap-3 px-5 py-3.5 hover:bg-surface-muted/50">
                      <input type="checkbox" checked={isDone}
                        onChange={() => setDone((d) => { const n = new Set(d); n.has(k) ? n.delete(k) : n.add(k); return n; })}
                        className="mt-0.5 h-4 w-4 accent-[var(--color-accent-strong)]" />
                      <span className={cn("text-sm text-ink-text", isDone && "text-muted line-through")}>{t.text}</span>
                    </label>
                  );
                })}
              </Card>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
