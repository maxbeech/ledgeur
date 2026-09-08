// One space, with everything in it.
//
// Spaces used to be a filter on the library, which meant a "project" was only
// ever a list of recordings. Everything else a project actually accumulates —
// the thing you have to do, the thing somebody said that you wrote down, the
// decision from a call three weeks ago — lived somewhere else or nowhere.
//
// So this screen is the space: its meetings, its tasks and its notes, on one
// page. That is the whole of what "filed into a project" is worth.

import { useMemo } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowUpRight, Library as LibraryIcon, Sparkles, SquareCheck, StickyNote } from "lucide-react";
import { cn, relativeTime } from "@ledgeur/ui";
import { capturesInSpace } from "@ledgeur/core";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Badge, Button, Card, EmptyState, ErrorNote, SectionHeader, Spinner } from "../components/ui.tsx";
import { RecordDot } from "../components/RecordDot.tsx";
import { CaptureList } from "../components/capture/CaptureList.tsx";
import { useMeetings } from "../lib/useMeetings.ts";
import { useCaptures } from "../lib/captures.ts";
import { useFolders } from "../lib/folders.ts";
import { openCapture } from "../lib/captureDock.ts";

export function Space() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const folders = useFolders();
  const { cards, error } = useMeetings();
  const captures = useCaptures();

  const space = folders.find((f) => f.id === id);
  const meetings = useMemo(() => (cards ?? []).filter((c) => c.folderId === id), [cards, id]);
  const kept = useMemo(() => capturesInSpace(captures, id), [captures, id]);
  const tasks = kept.filter((c) => c.kind === "task");
  const notes = kept.filter((c) => c.kind === "note");
  const now = new Date();

  // A space deleted on another device: say so rather than showing an empty
  // page that looks like the work in it is gone. Nothing in it was lost —
  // meetings and captures are both moved back to unfiled on delete.
  if (!space) {
    return (
      <Page>
        <PageHeader title="Space not found" subtitle="It may have been deleted on another device." />
        <Card>
          <EmptyState
            icon={<LibraryIcon className="h-5 w-5" />}
            title="This space no longer exists"
            body="Nothing that was in it was deleted — meetings and thoughts move back to Unfiled when a space goes."
            action={<Button onClick={() => nav("/meetings")}>Open the library</Button>}
          />
        </Card>
      </Page>
    );
  }

  const empty = meetings.length === 0 && kept.length === 0;

  return (
    <Page>
      <PageHeader
        title={space.name}
        subtitle={`${meetings.length} meeting${meetings.length === 1 ? "" : "s"} · ${tasks.length} task${tasks.length === 1 ? "" : "s"} · ${notes.length} note${notes.length === 1 ? "" : "s"}`}
        action={
          <span className="flex items-center gap-2">
            <Button tone="secondary" onClick={() => openCapture("type")}>
              <Sparkles className="h-4 w-4" /> Keep a thought
            </Button>
            <Button onClick={() => nav("/record")}><RecordDot /> Record</Button>
          </span>
        }
      />

      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {cards === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Loading</div>
      )}

      {empty && cards !== null && (
        <Card>
          <EmptyState
            icon={<span className={cn("h-4 w-4 rounded-full", `bg-${space.tone}`)} />}
            title={`Nothing in ${space.name} yet`}
            body="Record a meeting or keep a thought — anything Ledgeur is confident belongs here is filed here automatically, and you can move anything it gets wrong."
            action={<Button onClick={() => openCapture("type")}><Sparkles className="h-4 w-4" /> Keep a thought</Button>}
          />
        </Card>
      )}

      {tasks.length > 0 && (
        <section className="mb-6">
          <SectionHeader title={`Tasks · ${tasks.filter((t) => !t.done).length} open`} />
          <CaptureList captures={tasks} showSpace={false} />
        </section>
      )}

      {notes.length > 0 && (
        <section className="mb-6">
          <SectionHeader title="Notes" />
          <CaptureList captures={notes} showSpace={false} />
        </section>
      )}

      {meetings.length > 0 && (
        <section>
          <SectionHeader
            title="Meetings"
            action={<Link to={`/meetings?space=${space.id}`} className="text-sm font-medium text-brand-strong">In the library</Link>}
          />
          <Card className="divide-y divide-hairline">
            {meetings.map((m) => (
              <button
                key={`${m.source}-${m.id}`}
                onClick={() => nav(`/meetings/${m.id}`)}
                className="group flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-surface-muted"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-md font-medium text-ink-text">{m.title}</span>
                    {m.source === "local" && <Badge tone="warn">On this device</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-faint">
                    {relativeTime(m.createdAt, now)} · {m.wordCount} words · {m.actionItemCount} action item{m.actionItemCount === 1 ? "" : "s"}
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-ink-text" />
              </button>
            ))}
          </Card>
        </section>
      )}

      {/* A space with meetings but nothing kept, and vice versa, both read as
          finished pages rather than half-built ones — so neither gets an
          apologetic empty card of its own. */}
      {!empty && kept.length === 0 && (
        <p className="mt-6 flex items-center gap-2 text-sm text-faint">
          <StickyNote className="h-4 w-4" />
          Nothing kept in {space.name} yet.
          <button onClick={() => openCapture("type")} className="font-medium text-brand-strong">Keep a thought</button>
        </p>
      )}
      {!empty && meetings.length === 0 && (
        <p className="mt-6 flex items-center gap-2 text-sm text-faint">
          <SquareCheck className="h-4 w-4" />
          No meetings filed in {space.name} yet.
        </p>
      )}
    </Page>
  );
}
