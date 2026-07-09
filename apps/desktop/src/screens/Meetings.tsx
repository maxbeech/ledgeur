// The Library — every recording, transcript and set of notes, searchable.
// Cloud + unsynced-local merged (useMeetings); explicit loading/empty/error.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CircleDot, Library as LibraryIcon, ArrowUpRight } from "lucide-react";
import { relativeTime } from "@ledgeur/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, Chip, EmptyState, ErrorNote, Spinner } from "../components/ui.tsx";
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
      <PageHeader
        kicker="The library"
        title="Meetings"
        subtitle="Every recording, transcript and set of notes — searchable."
        action={<Button variant="accent" onClick={() => nav("/record")}><CircleDot className="h-4 w-4" /> Record</Button>}
      />

      <div className="ldg-stagger">
        <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-hairline bg-surface px-3.5 py-2.5 transition-shadow focus-within:shadow-[var(--shadow-card)] focus-within:ring-2 focus-within:ring-accent/30">
          <Search className="h-4 w-4 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            name="library-search" placeholder="Search meetings and transcripts…"
            className="ldg-prose min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            aria-label="Search meetings"
          />
        </div>

        {error && <ErrorNote className="mb-4">{error}</ErrorNote>}

        {cards === null && !error && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Loading…</div>
        )}

        {cards !== null && filtered.length === 0 && (
          <Card>
            <EmptyState
              icon={<LibraryIcon className="h-5 w-5" />}
              title={q ? "No matches" : "The shelves are empty"}
              body={q ? "Try a different search term." : "Record your first meeting to start the company's record."}
              action={!q ? <Button variant="accent" onClick={() => nav("/record")}><CircleDot className="h-4 w-4" /> Record a meeting</Button> : undefined}
            />
          </Card>
        )}

        {filtered.length > 0 && (
          <Card className="divide-y divide-hairline">
            {filtered.map((c) => (
              <button
                key={`${c.source}-${c.id}`}
                onClick={() => nav(`/meetings/${c.id}`)}
                className="group flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-muted/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium text-ink-text">{c.title}</span>
                    {c.source === "local" && <Chip tone="warn">local · not synced</Chip>}
                  </div>
                  <div className="mt-1 truncate font-mono text-[10.5px] text-faint">
                    {relativeTime(c.createdAt, now)} · {c.wordCount} words · {c.actionItemCount} action items
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-faint transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink-text" />
              </button>
            ))}
          </Card>
        )}
      </div>
    </Page>
  );
}
