// Tasks — every action item the record has produced, plus whatever you added
// by hand. Cloud rows carry real DB status (cross-device); unsynced local
// items keep their done-state on-device.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SquareCheck, Check, Trash2, Plus, X } from "lucide-react";
import { cn } from "@ledgeur/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Badge, Button, Card, EmptyState, ErrorNote, IconButton, Spinner } from "../components/ui.tsx";
import { RecordDot } from "../components/RecordDot.tsx";
import { SendTaskButton } from "../components/SendTaskButton.tsx";
import { useTasks, type TaskItem } from "../lib/useTasks.ts";

type Filter = "all" | "auto" | "mine";

export function Tasks() {
  const nav = useNavigate();
  const { tasks, error, toggle, addTask, removeTask } = useTasks();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const all = tasks ?? [];
    switch (filter) {
      case "auto": return all.filter((t) => t.auto);
      case "mine": return all.filter((t) => !t.auto);
      default: return all;
    }
  }, [tasks, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, { title: string; items: TaskItem[] }>();
    for (const t of shown) {
      const key = t.meetingId ?? "unassigned";
      const g = map.get(key) ?? { title: t.meetingTitle, items: [] };
      g.items.push(t);
      map.set(key, g);
    }
    return [...map.entries()];
  }, [shown]);

  const openCount = (tasks ?? []).filter((t) => !t.done).length;
  const autoCount = (tasks ?? []).filter((t) => t.auto).length;
  const mineCount = (tasks ?? []).filter((t) => !t.auto).length;

  function setFilterAndClearSelection(next: Filter) {
    setFilter(next);
    setSelected(new Set());
  }

  function toggleSelected(key: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const allShownSelected = shown.length > 0 && shown.every((t) => selected.has(t.key));
  function toggleSelectAll() {
    setSelected(allShownSelected ? new Set() : new Set(shown.map((t) => t.key)));
  }

  const selectedTasks = shown.filter((t) => selected.has(t.key));

  async function bulkMarkDone() {
    setBusy(true);
    try {
      await Promise.all(selectedTasks.filter((t) => !t.done).map((t) => toggle(t)));
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  async function bulkDelete() {
    setBusy(true);
    try {
      await Promise.all(selectedTasks.map((t) => removeTask(t)));
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  function submitDraft(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    addTask(text);
    setDraft("");
  }

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

      {/* Adding a task by hand. Meeting action items are always the model's
          extraction — there is nowhere to insert one into a meeting's notes —
          so a hand-added task is kept as a capture, the one kind of task a
          person can actually author. It shows up here immediately, marked
          "Mine" rather than guessed. */}
      <form onSubmit={submitDraft} className="mb-4 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a task…"
          aria-label="Add a task"
          className="h-10 flex-1 rounded-lg border border-hairline-strong bg-surface px-3 text-sm outline-none focus:border-brand"
        />
        <Button type="submit" size="md" tone="secondary" disabled={!draft.trim()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>

      {(tasks ?? []).length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <Chip active={filter === "all"} onClick={() => setFilterAndClearSelection("all")}>
            All · {tasks?.length ?? 0}
          </Chip>
          <Chip active={filter === "auto"} onClick={() => setFilterAndClearSelection("auto")}>
            Auto · {autoCount}
          </Chip>
          <Chip active={filter === "mine"} onClick={() => setFilterAndClearSelection("mine")}>
            Mine · {mineCount}
          </Chip>
        </div>
      )}

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<SquareCheck className="h-5 w-5" />}
            title={(tasks ?? []).length === 0 ? "No action items yet" : "Nothing here"}
            body={(tasks ?? []).length === 0
              ? "Action items are pulled out automatically when you record a meeting, or add one yourself above."
              : "Try another filter."}
            action={(tasks ?? []).length === 0
              ? <Button onClick={() => nav("/record")}><RecordDot /> Record a meeting</Button>
              : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={allShownSelected} onChange={toggleSelectAll} className="peer sr-only" />
              <span className={cn(
                "flex h-5 w-5 items-center justify-center rounded-md border-2 transition-colors",
                allShownSelected ? "border-accent-strong bg-accent-strong text-white" : "border-hairline-strong bg-surface",
              )}>
                {allShownSelected && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              Select all
            </label>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge>{selected.size} selected</Badge>
                <Button size="sm" tone="secondary" disabled={busy} onClick={() => void bulkMarkDone()}>
                  <Check className="h-3.5 w-3.5" /> Mark done
                </Button>
                <Button size="sm" tone="danger" disabled={busy} onClick={() => void bulkDelete()}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
                <IconButton label="Clear selection" size="sm" tone="ghost" onClick={() => setSelected(new Set())}>
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            )}
          </div>

          {grouped.map(([meetingId, group]) => (
            <section key={meetingId}>
              <button
                onClick={() => meetingId !== "unassigned" && nav(`/meetings/${meetingId}`)}
                className="ldg-label mb-2 transition-colors hover:text-ink-text"
              >
                {group.title}
              </button>
              <Card className="divide-y divide-hairline">
                {group.items.map((t) => (
                  <div key={t.key} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      checked={selected.has(t.key)}
                      onChange={() => toggleSelected(t.key)}
                      aria-label={`Select "${t.text}"`}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-hairline-strong"
                    />
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
                    {!t.auto && <Badge tone="brand">Mine</Badge>}
                    {!t.done && <SendTaskButton task={t} />}
                    <IconButton label={`Delete "${t.text}"`} size="sm" tone="ghost" onClick={() => void removeTask(t)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
        active ? "bg-ink text-on-ink" : "bg-surface-muted text-muted hover:bg-surface-sunken hover:text-ink-text",
      )}
    >
      {children}
    </button>
  );
}
