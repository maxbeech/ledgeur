// The people directory — everyone Ledgeur has actually heard.
//
// Entirely derived (see lib/people.ts): there is no "add a person", because a
// directory you maintain by hand is a directory that is wrong within a month.
// Somebody appears here by having spoken in a meeting and been named once.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Search, Mic, MicOff, ChevronRight, Sparkles } from "lucide-react";
import { relativeTime, cn } from "@ledgeur/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Avatar, Badge, Button, Card, EmptyState, ErrorNote, Input, Label, Spinner } from "../components/ui.tsx";
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
        title="People"
        subtitle="Everyone your meetings have heard, counted from real recordings. Nobody is added by hand."
      />

      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}

      {directory === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Reading the record</div>
      )}

      {directory && directory.people.length > 0 && (
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person" aria-label="Find a person" className="pl-10" />
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
            action={<Button tone="secondary" onClick={() => nav("/meetings")}>Open the library</Button>}
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
            <p className="mt-4 text-xs leading-relaxed text-faint">
              {directory.unnamedVoices} more voice{directory.unnamedVoices === 1 ? "" : "s"} across
              {" "}{directory.meetingsWithSpeakers} meeting{directory.meetingsWithSpeakers === 1 ? "" : "s"} {directory.unnamedVoices === 1 ? "has" : "have"} not
              been named. Name one in a transcript and it appears here.
            </p>
          )}
        </>
      )}
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
  return (
    <div>
      <button onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-surface-muted">
        <Avatar name={person.name} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-md font-medium text-ink-text">{person.name}</span>
            {/* Enrolment is the difference between "we named them in a
                transcript once" and "the next meeting will know their voice". */}
            {person.enrolled
              ? <Badge tone="accent"><Mic className="h-3 w-3" /> Voice known</Badge>
              : <Badge><MicOff className="h-3 w-3" /> Not enrolled</Badge>}
            {/* A name Ledgeur worked out and nobody has checked. Saying so here
                matters more than it does on a transcript: the directory reads
                as a list of people you know. */}
            {person.guessed && (
              <Badge title="Ledgeur worked this name out from what was said. Open a meeting to confirm or change it.">
                <Sparkles className="h-3 w-3" /> Name guessed
              </Badge>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-faint">
            {person.meetingCount} meeting{person.meetingCount === 1 ? "" : "s"} · {duration(person.speakingSeconds)} speaking · {person.wordCount} words · last {relativeTime(person.lastSeen, now)}
          </span>
        </span>
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-faint transition-transform", expanded && "rotate-90")} />
      </button>

      {expanded && (
        <div className="border-t border-hairline bg-surface-muted/50 px-4 py-3">
          <Label className="mb-2">Meetings</Label>
          <ul className="space-y-0.5">
            {person.meetings.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => onOpenMeeting(m.id)}
                  className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm text-ink-text transition-colors hover:bg-surface"
                >
                  <span className="truncate">{m.title}</span>
                  <span className="shrink-0 text-xs text-faint">{relativeTime(m.createdAt, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
