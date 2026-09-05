// The people directory — everyone Ledgeur has actually heard.
//
// Entirely derived (see lib/people.ts): there is no "add a person", because a
// directory you maintain by hand is a directory that is wrong within a month.
// Somebody appears here by having spoken in a meeting and been named once.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Search, Mic, MicOff, ArrowUpRight } from "lucide-react";
import { relativeTime, cn } from "@ledgeur/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, Chip, EmptyState, ErrorNote, Kicker, Spinner } from "../components/ui.tsx";
import { usePeople, type Person } from "../lib/people.ts";

const duration = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export function People() {
  const nav = useNavigate();
  const { directory, error } = usePeople();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const now = new Date();

  const q = query.trim().toLowerCase();
  const people = (directory?.people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));

  return (
    <Page>
      <PageHeader
        kicker="Who's in the room"
        title="People"
        subtitle="Everyone your meetings have heard, counted from real recordings. Nobody is added by hand."
      />

      <div className="ldg-stagger">
        {error && <ErrorNote className="mb-4">{error}</ErrorNote>}

        {directory === null && !error && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Reading the record…</div>
        )}

        {directory && directory.people.length > 0 && (
          <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-hairline bg-surface px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-accent/30">
            <Search className="h-4 w-4 shrink-0 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a person…"
              aria-label="Find a person"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </div>
        )}

        {directory && directory.people.length === 0 && (
          <Card>
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title="Nobody is named yet"
              body={
                directory.unnamedVoices > 0
                  ? `Ledgeur has separated ${directory.unnamedVoices} voice${directory.unnamedVoices === 1 ? "" : "s"} across your meetings but doesn't know who any of them are. Open a meeting's transcript and click a speaker to name them — every meeting after that recognises the voice on its own.`
                  : "Record a meeting with more than one person, then name the voices in its transcript. They appear here, with what they said and when."
              }
              action={<Button variant="outline" onClick={() => nav("/meetings")}>Open the library</Button>}
            />
          </Card>
        )}

        {people.length > 0 && (
          <>
            <Card className="divide-y divide-hairline">
              {people.map((p) => (
                <PersonRow
                  key={p.name}
                  person={p}
                  now={now}
                  expanded={open === p.name}
                  onToggle={() => setOpen(open === p.name ? null : p.name)}
                  onOpenMeeting={(id) => nav(`/meetings/${id}`)}
                />
              ))}
            </Card>

            {/* The count that makes the directory honest: it says what is
                missing, not just what it has. */}
            {directory && directory.unnamedVoices > 0 && (
              <p className="mt-4 text-[12px] leading-relaxed text-faint">
                {directory.unnamedVoices} more voice{directory.unnamedVoices === 1 ? "" : "s"} across
                {" "}{directory.meetingsWithSpeakers} meeting{directory.meetingsWithSpeakers === 1 ? "" : "s"} {directory.unnamedVoices === 1 ? "has" : "have"} not
                been named. Name one in a transcript and it appears here.
              </p>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

function PersonRow({ person, now, expanded, onToggle, onOpenMeeting }: {
  person: Person;
  now: Date;
  expanded: boolean;
  onToggle: () => void;
  onOpenMeeting: (id: string) => void;
}) {
  const initials = person.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div>
      <button onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3.5 px-5 py-4 text-left transition-colors hover:bg-surface-muted/50">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/70 to-glow/60 font-mono text-[11px] font-semibold text-white">
          {initials || "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium text-ink-text">{person.name}</span>
            {/* Enrolment is the difference between "we named them in a
                transcript once" and "the next meeting will know their voice". */}
            {person.enrolled
              ? <Chip tone="accent"><Mic className="h-3 w-3" /> voice known</Chip>
              : <Chip><MicOff className="h-3 w-3" /> not enrolled</Chip>}
          </span>
          <span className="mt-1 block truncate font-mono text-[10.5px] text-faint">
            {person.meetingCount} meeting{person.meetingCount === 1 ? "" : "s"} · {duration(person.speakingSeconds)} speaking · {person.wordCount} words · last {relativeTime(person.lastSeen, now)}
          </span>
        </span>
        <ArrowUpRight className={cn("h-4 w-4 shrink-0 text-faint transition-transform", expanded && "rotate-90")} />
      </button>

      {expanded && (
        <div className="border-t border-hairline bg-surface-muted/30 px-5 py-3">
          <Kicker className="mb-2">Meetings</Kicker>
          <ul className="space-y-1">
            {person.meetings.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => onOpenMeeting(m.id)}
                  className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1 text-left text-[13px] text-ink-text transition-colors hover:bg-surface"
                >
                  <span className="truncate">{m.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-faint">{relativeTime(m.createdAt, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
