// Home — the reading room. A dated greeting, the ask bar (the brain's front
// door), today's calendar with one-click record, and the latest entries in the
// record. All real data with explicit empty states.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, CircleDot, ArrowUpRight, Clock } from "lucide-react";
import { relativeTime } from "@parleynotes/ui";
import { Page } from "../components/PageHeader.tsx";
import { Button, Card, Chip, EmptyState, Kicker, SectionHeader } from "../components/ui.tsx";
import { TodaySchedule } from "../components/TodaySchedule.tsx";
import { useMeetings } from "../lib/useMeetings.ts";
import { useTasks } from "../lib/useTasks.ts";

export function Home() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const { cards } = useMeetings();
  const { tasks } = useTasks();
  const now = new Date();
  const recent = (cards ?? []).slice(0, 5);
  const openTasks = (tasks ?? []).filter((t) => !t.done).length;
  const ask = () => { if (q.trim()) nav(`/ask?q=${encodeURIComponent(q.trim())}`); };

  return (
    <Page>
      <div className="pn-stagger">
        <header className="mb-7">
          <Kicker className="mb-2">
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </Kicker>
          <h1 className="pn-display text-[34px] leading-tight text-ink-text">The record is open.</h1>
        </header>

        {/* Ask anything — the brain's front door. Gold = the brain. */}
        <div className="mb-8 flex items-center gap-3 rounded-2xl border border-glow/30 bg-surface px-5 py-4 shadow-[var(--shadow-card)] transition-shadow focus-within:shadow-[var(--shadow-float)]">
          <Sparkles className="h-5 w-5 shrink-0 text-glow-strong" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
            placeholder="Ask anything across your meetings, notes and connected tools…"
            className="pn-prose min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            aria-label="Ask your knowledge base" name="home-ask"
          />
          <Button variant="gold" size="sm" onClick={ask} disabled={!q.trim()}>Ask</Button>
        </div>

        {/* Quiet ledger row: counts + record CTA. */}
        <div className="mb-9 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile label="Meetings on record" value={cards === null ? "—" : String(cards.length)} onClick={() => nav("/meetings")} />
          <StatTile label="Open action items" value={tasks === null ? "—" : String(openTasks)} onClick={() => nav("/tasks")} />
          <button
            onClick={() => nav("/record")}
            className="group col-span-2 flex items-center justify-between rounded-2xl bg-ink p-5 text-left shadow-[var(--shadow-card)] transition-all duration-200 ease-[var(--ease-settle)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)] sm:col-span-1"
          >
            <span>
              <span className="pn-display block text-[19px] text-on-ink">Record</span>
              <span className="block text-xs text-on-ink-muted">Start a new entry</span>
            </span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-danger/90 text-white transition-transform duration-200 group-hover:scale-105">
              <CircleDot className="h-5 w-5" />
            </span>
          </button>
        </div>

        <section className="mb-9">
          <SectionHeader title="Today" />
          <TodaySchedule />
        </section>

        <section>
          <SectionHeader
            title="Recent entries"
            action={recent.length > 0 ? (
              <button onClick={() => nav("/meetings")} className="text-xs font-medium text-accent-strong hover:underline">
                Open the library
              </button>
            ) : undefined}
          />
          {recent.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Clock className="h-5 w-5" />}
                title="Nothing on record yet"
                body="Record your first meeting and it becomes searchable knowledge — summaries, decisions and action items included."
                action={<Button variant="accent" onClick={() => nav("/record")}><CircleDot className="h-4 w-4" /> Record a meeting</Button>}
              />
            </Card>
          ) : (
            <Card className="divide-y divide-hairline">
              {recent.map((m) => (
                <button
                  key={`${m.source}-${m.id}`}
                  onClick={() => nav(`/meetings/${m.id}`)}
                  className="group flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition-colors hover:bg-surface-muted/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink-text">{m.title}</span>
                      {m.source === "local" && <Chip tone="warn">local</Chip>}
                    </div>
                    <div className="mt-0.5 font-mono text-[10.5px] text-faint">
                      {relativeTime(m.createdAt, now)} · {m.wordCount} words · {m.actionItemCount} tasks
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-faint transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink-text" />
                </button>
              ))}
            </Card>
          )}
        </section>
      </div>
    </Page>
  );
}

function StatTile({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-hairline bg-surface p-5 text-left shadow-[var(--shadow-card)] transition-all duration-200 ease-[var(--ease-settle)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)]"
    >
      <span className="pn-display block text-[26px] tabular-nums text-ink-text">{value}</span>
      <span className="mt-0.5 block text-xs text-muted">{label}</span>
    </button>
  );
}
