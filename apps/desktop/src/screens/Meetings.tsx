import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CircleDot, CalendarClock, ArrowRight } from "lucide-react";
import { relativeTime } from "@parleynotes/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, Chip, EmptyState, Spinner } from "../components/ui.tsx";
import { useLocalMeetings } from "../lib/useLocalMeetings.ts";

export function Meetings() {
  const nav = useNavigate();
  const { meetings, error } = useLocalMeetings();
  const [query, setQuery] = useState("");
  const now = new Date();

  const filtered = (meetings ?? []).filter((m) =>
    !query || m.title.toLowerCase().includes(query.toLowerCase()) ||
    m.segments.some((s) => s.text.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <Page>
      <PageHeader title="Meetings" subtitle="Every recording, transcript and set of notes — searchable."
        action={<Button onClick={() => nav("/record")}><CircleDot className="h-4 w-4" /> Record</Button>} />

      <div className="mb-5 flex items-center gap-2 rounded-xl border border-hairline bg-surface px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-accent/40">
        <Search className="h-4 w-4 text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search meetings and transcripts…" className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
      </div>

      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {meetings === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Loading…</div>
      )}

      {meetings !== null && filtered.length === 0 && (
        <Card className="p-2">
          <EmptyState icon={<CalendarClock className="h-5 w-5" />}
            title={query ? "No matches" : "No meetings yet"}
            body={query ? "Try a different search term." : "Record your first meeting to build your searchable company brain."}
            action={!query ? <Button onClick={() => nav("/record")}><CircleDot className="h-4 w-4" /> Record a meeting</Button> : undefined} />
        </Card>
      )}

      {filtered.length > 0 && (
        <Card className="divide-y divide-hairline">
          {filtered.map((m) => (
            <button key={m.id} onClick={() => nav(`/meetings/${m.id}`)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-surface-muted/60">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-medium text-ink-text">{m.title}</span>
                  {!m.synced && <Chip tone="warn">Local</Chip>}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {relativeTime(m.createdAt, now)} · {m.wordCount} words · {m.actionItems.length} action items
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
