import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, CircleDot, CalendarClock, CheckSquare, ArrowRight, Clock } from "lucide-react";
import { relativeTime } from "@parleynotes/ui";
import { Page } from "../components/PageHeader.tsx";
import { Button, Card, EmptyState } from "../components/ui.tsx";
import { TodaySchedule } from "../components/TodaySchedule.tsx";
import { useMeetings } from "../lib/useMeetings.ts";

export function Brain() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const { cards } = useMeetings();
  const now = new Date();
  const recent = (cards ?? []).slice(0, 5);
  const openTasks = (cards ?? []).reduce((n, m) => n + m.actionItemCount, 0);

  return (
    <Page>
      <div className="mb-2 text-sm text-muted">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
      <h1 className="mb-6 text-[28px] font-semibold tracking-tight text-ink-text">Your company brain</h1>

      {/* Ask anything */}
      <Card className="mb-8 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4">
          <Sparkles className="h-5 w-5 text-accent-strong" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) nav(`/ask?q=${encodeURIComponent(q.trim())}`); }}
            placeholder="Ask anything across your meetings, notes and connected tools…"
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
          <Button onClick={() => q.trim() && nav(`/ask?q=${encodeURIComponent(q.trim())}`)}>Ask</Button>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={<CalendarClock className="h-5 w-5" />} label="Meetings" value={String(cards?.length ?? "—")} onClick={() => nav("/meetings")} />
        <StatCard icon={<CheckSquare className="h-5 w-5" />} label="Open tasks" value={String(openTasks)} onClick={() => nav("/tasks")} />
        <StatCard icon={<CircleDot className="h-5 w-5" />} label="Record" value="Start" accent onClick={() => nav("/record")} />
      </div>

      {/* Today's schedule (real calendar + auto-prompt) */}
      <div className="mt-8">
        <SectionRow title="Today" onSeeAll={undefined} />
        <TodaySchedule />
      </div>

      {/* Recent meetings */}
      <div className="mt-8">
        <SectionRow title="Recent meetings" onSeeAll={recent.length ? () => nav("/meetings") : undefined} />
        {recent.length === 0 ? (
          <Card className="p-2">
            <EmptyState icon={<Clock className="h-5 w-5" />} title="No meetings yet" body="Record your first meeting to start building your company brain." action={<Button onClick={() => nav("/record")}><CircleDot className="h-4 w-4" /> Record a meeting</Button>} />
          </Card>
        ) : (
          <Card className="divide-y divide-hairline">
            {recent.map((m) => (
              <button key={m.id} onClick={() => nav(`/meetings/${m.id}`)} className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-surface-muted/60">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink-text">{m.title}</div>
                  <div className="text-xs text-muted">{relativeTime(m.createdAt, now)} · {m.wordCount} words · {m.actionItemCount} tasks</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted" />
              </button>
            ))}
          </Card>
        )}
      </div>
    </Page>
  );
}

function StatCard({ icon, label, value, onClick, accent }: { icon: React.ReactNode; label: string; value: string; onClick: () => void; accent?: boolean }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-4 rounded-2xl border border-hairline p-5 text-left shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)] ${accent ? "bg-ink text-on-ink" : "bg-surface"}`}>
      <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${accent ? "bg-accent text-white" : "bg-accent-soft text-accent-strong"}`}>{icon}</span>
      <span>
        <span className={`block text-2xl font-semibold tracking-tight ${accent ? "text-on-ink" : "text-ink-text"}`}>{value}</span>
        <span className={`block text-xs ${accent ? "text-on-ink-muted" : "text-muted"}`}>{label}</span>
      </span>
    </button>
  );
}

function SectionRow({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {onSeeAll && <button onClick={onSeeAll} className="text-xs font-medium text-accent-strong hover:underline">See all</button>}
    </div>
  );
}
