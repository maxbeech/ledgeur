// Thoughts — everything kept outside a meeting.
//
// The list exists so the capture box can stay as small as it is. Nothing in the
// box asks where a thought should go, which only works if there is one obvious
// place to go and correct it afterwards, in bulk, when the answers are cheap.
//
// Sorted newest first and never re-sorted underneath somebody: a capture whose
// space changes stays where it is in the list until the screen is left, because
// a row moving out from under a tap is how the wrong thing gets deleted.

import { useMemo, useState } from "react";
import { Inbox as InboxIcon, Sparkles } from "lucide-react";
import { cn } from "@ledgeur/ui";
import { capturesInSpace, type CaptureRecord } from "@ledgeur/core";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, EmptyState } from "../components/ui.tsx";
import { CaptureList } from "../components/capture/CaptureList.tsx";
import { useCaptures } from "../lib/captures.ts";
import { useFolders } from "../lib/folders.ts";
import { openCapture } from "../lib/captureDock.ts";

type Filter =
  | { kind: "all" }
  | { kind: "tasks" }
  | { kind: "notes" }
  | { kind: "inbox" }
  | { kind: "space"; id: string };

export function Inbox() {
  const captures = useCaptures();
  const folders = useFolders();
  const [filter, setFilter] = useState<Filter>({ kind: "all" });

  const shown = useMemo<CaptureRecord[]>(() => {
    const live = [...captures].filter((c) => !c.deletedAt).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    switch (filter.kind) {
      case "tasks": return live.filter((c) => c.kind === "task");
      case "notes": return live.filter((c) => c.kind === "note");
      case "inbox": return capturesInSpace(live, null);
      case "space": return capturesInSpace(live, filter.id);
      default: return live;
    }
  }, [captures, filter]);

  const unfiled = capturesInSpace(captures, null).length;
  const openTasks = captures.filter((c) => c.kind === "task" && !c.done && !c.deletedAt).length;

  return (
    <Page>
      <PageHeader
        title="Thoughts"
        subtitle="Everything you kept without recording a meeting — sorted on the way in, and correctable in one tap."
        action={<Button onClick={() => openCapture("type")}><Sparkles className="h-4 w-4" /> Keep a thought</Button>}
      />

      {captures.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <Chip active={filter.kind === "all"} onClick={() => setFilter({ kind: "all" })}>
            All · {captures.length}
          </Chip>
          <Chip active={filter.kind === "tasks"} onClick={() => setFilter({ kind: "tasks" })}>
            Tasks · {openTasks} open
          </Chip>
          <Chip active={filter.kind === "notes"} onClick={() => setFilter({ kind: "notes" })}>
            Notes · {captures.filter((c) => c.kind === "note").length}
          </Chip>
          {unfiled > 0 && (
            <Chip active={filter.kind === "inbox"} onClick={() => setFilter({ kind: "inbox" })}>
              Unfiled · {unfiled}
            </Chip>
          )}
          {folders.map((f) => {
            const n = capturesInSpace(captures, f.id).length;
            if (n === 0) return null;
            return (
              <Chip key={f.id} active={filter.kind === "space" && filter.id === f.id} onClick={() => setFilter({ kind: "space", id: f.id })} tone={f.tone}>
                {f.name} · {n}
              </Chip>
            );
          })}
        </div>
      )}

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<InboxIcon className="h-5 w-5" />}
            title={captures.length === 0 ? "Nothing kept yet" : "Nothing here"}
            body={
              captures.length === 0
                ? "The thought you have walking out of a meeting goes here. Type it or say it — Ledgeur works out whether it is a task and which space it belongs to."
                : "Try another filter."
            }
            action={captures.length === 0
              ? <Button onClick={() => openCapture("type")}><Sparkles className="h-4 w-4" /> Keep a thought</Button>
              : undefined}
          />
        </Card>
      ) : (
        <CaptureList captures={shown} />
      )}
    </Page>
  );
}

function Chip({ active, onClick, tone, children }: {
  active: boolean; onClick: () => void; tone?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
        active ? "bg-ink text-on-ink" : "bg-surface-muted text-muted hover:bg-surface-sunken hover:text-ink-text",
      )}
    >
      {tone && <span className={cn("h-2 w-2 rounded-full", `bg-${tone}`)} />}
      {children}
    </button>
  );
}
