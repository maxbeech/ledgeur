import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CircleDot, CalendarClock, ArrowRight } from "lucide-react";
import { relativeTime } from "@parleynotes/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, Chip, EmptyState, Spinner } from "../components/ui.tsx";
import { useMeetings } from "../lib/useMeetings.ts";

export function Meetings() {
  const nav = useNavigate();
  const { cards, error } = useMeetings();
  const [query, setQuery] = useState("");
  const now = new Date();

  const q = query.trim().toLowerCase();
  const filtered = (cards ?? []).filter((c) => !q || c.haystack.includes(q));

  return (
    <Page>
      <PageHeader title="Meetings" subtitle="Every recording, transcript and set of notes — searchable."
        action={<Button onClick={() => nav("/record")}><CircleDot className="h-4 w-4" /> Record</Button>} />

      <div className="mb-5 flex items-center gap-2 rounded-xl border border-hairline bg-surface px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-accent/40">
        <Search className="h-4 w-4 text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search meetings and transcripts…" className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
      </div>

      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {cards === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Loading…</div>
      )}

      {cards !== null && filtered.length === 0 && (
        <Card className="p-2">
          <EmptyState icon={<CalendarClock className="h-5 w-5" />}
            title={q ? "No matches" : "No meetings yet"}
            body={q ? "Try a different search term." : "Record your first meeting to build your searchable company brain."}
            action={!q ? <Button onClick={() => nav("/record")}><CircleDot className="h-4 w-4" /> Record a meeting</Button> : undefined} />
        </Card>
      )}

      {filtered.length > 0 && (
        <Card className="divide-y divide-hairline">
          {filtered.map((c) => (
            <button key={`${c.source}-${c.id}`} onClick={() => nav(`/meetings/${c.id}`)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-surface-muted/60">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-medium text-ink-text">{c.title}</span>
                  {c.source === "local" && <Chip tone="warn">Local · not synced</Chip>}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {relativeTime(c.createdAt, now)} · {c.wordCount} words · {c.actionItemCount} action items
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
            </button>
          ))}
        </Card>
      )}
    </Page>
  );
}
