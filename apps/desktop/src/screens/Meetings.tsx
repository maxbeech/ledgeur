// The library — every recording, transcript and set of notes, searchable and
// filed into spaces. Cloud + unsynced-local merged (useMeetings); explicit
// loading/empty/error.
//
// Spaces are one level deep on purpose (see folders.ts): the row of chips
// filters, and search covers everything nesting would have been for.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, ArrowUpRight, Plus, Trash2, Library as LibraryIcon } from "lucide-react";
import { relativeTime, cn } from "@ledgeur/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Badge, Button, Card, EmptyState, ErrorNote, IconButton, Input, Notice, Spinner } from "../components/ui.tsx";
import { RecordDot } from "../components/RecordDot.tsx";
import { useMeetings } from "../lib/useMeetings.ts";
import { useFolders, useFolderCounts, createFolder, deleteFolder, type Folder } from "../lib/folders.ts";

/** "All" and "Unfiled" are not folders — they are views over the same set. */
type Scope = { kind: "all" } | { kind: "unfiled" } | { kind: "folder"; id: string };

export function Meetings() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { cards, error, refresh } = useMeetings();
  const folders = useFolders();
  const counts = useFolderCounts();
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(params.get("new") === "space");
  const [folderNote, setFolderNote] = useState("");
  const now = new Date();

  // The sidebar links straight to a space with ?space=<id>.
  const spaceParam = params.get("space");
  const scope: Scope = spaceParam === "unfiled"
    ? { kind: "unfiled" }
    : spaceParam && folders.some((f) => f.id === spaceParam) ? { kind: "folder", id: spaceParam } : { kind: "all" };
  const setScope = (s: Scope) => {
    const next = new URLSearchParams(params);
    if (s.kind === "all") next.delete("space"); else next.set("space", s.kind === "unfiled" ? "unfiled" : s.id);
    next.delete("new");
    setParams(next, { replace: true });
  };
  useEffect(() => { if (params.get("new") === "space") setAdding(true); }, [params]);

  const q = query.trim().toLowerCase();
  const filtered = (cards ?? []).filter((c) => {
    if (q && !c.haystack.includes(q)) return false;
    if (scope.kind === "folder") return c.folderId === scope.id;
    // A meeting pointing at a deleted space would otherwise be in no view at
    // all; folders.ts unfiles them on delete, and this is the belt to that
    // braces for anything written by an older build.
    if (scope.kind === "unfiled") return !c.folderId || !folders.some((f) => f.id === c.folderId);
    return true;
  });

  function addFolder(e: React.FormEvent) {
    e.preventDefault();
    try {
      const folder = createFolder(newName);
      setNewName("");
      setAdding(false);
      setFolderNote("");
      setScope({ kind: "folder", id: folder.id });
    } catch (err) {
      setFolderNote(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeFolder(folder: Folder) {
    const moved = await deleteFolder(folder.id);
    setScope({ kind: "all" });
    setFolderNote(moved > 0
      ? `“${folder.name}” was removed. ${moved} meeting${moved === 1 ? "" : "s"} moved back to Unfiled — nothing was deleted.`
      : "");
    await refresh();
  }

  return (
    <Page>
      <PageHeader
        title="Library"
        subtitle="Every recording, transcript and set of notes, searchable and filed how you work."
        action={<Button onClick={() => nav("/record")}><RecordDot /> Record</Button>}
      />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          name="library-search" placeholder="Search meetings and transcripts"
          className="pl-10"
          aria-label="Search meetings"
        />
      </div>

      {/* Spaces, as a row of filters rather than a tree — see folders.ts */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        <ScopeChip active={scope.kind === "all"} onClick={() => setScope({ kind: "all" })}>
          All{cards ? ` · ${cards.length}` : ""}
        </ScopeChip>
        {folders.map((f) => (
          <span key={f.id} className="group relative inline-flex items-center">
            <ScopeChip active={scope.kind === "folder" && scope.id === f.id} onClick={() => setScope({ kind: "folder", id: f.id })} tone={f.tone}>
              {f.name} · {counts.byFolder[f.id] ?? 0}
            </ScopeChip>
            <IconButton
              label={`Delete the space ${f.name} — the meetings in it are kept`}
              size="sm"
              onClick={() => void removeFolder(f)}
              className="ml-0.5 h-6 w-6 text-faint opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100"
            >
              <Trash2 className="h-3 w-3" />
            </IconButton>
          </span>
        ))}
        {(folders.length > 0 || counts.unfiled > 0) && (
          <ScopeChip active={scope.kind === "unfiled"} onClick={() => setScope({ kind: "unfiled" })}>
            Unfiled · {counts.unfiled}
          </ScopeChip>
        )}
        {adding ? (
          <form onSubmit={addFolder} className="inline-flex items-center gap-1.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setNewName(""); } }}
              placeholder="Customers, Hiring, Board"
              aria-label="Name of the new space"
              className="h-8 w-44 rounded-full border border-hairline-strong bg-surface px-3 text-sm outline-none focus:border-brand"
            />
            <Button size="sm" type="submit">Add</Button>
          </form>
        ) : (
          <button
            onClick={() => { setAdding(true); setFolderNote(""); }}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-hairline-strong px-3 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-ink-text"
          >
            <Plus className="h-3.5 w-3.5" /> New space
          </button>
        )}
      </div>

      {folderNote && <Notice className="mb-4">{folderNote}</Notice>}
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}

      {cards === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Loading</div>
      )}

      {cards !== null && filtered.length === 0 && (
        <Card>
          <EmptyState
            icon={<LibraryIcon className="h-5 w-5" />}
            title={q ? "No matches" : scope.kind === "folder" ? "Nothing filed here yet" : "Nothing recorded yet"}
            body={
              q ? "Try a different word — search covers titles and everything that was said."
                : scope.kind === "folder" ? "Open a meeting and choose this space to file it here."
                  : "Record your first meeting, or import one you already have."
            }
            action={!q && scope.kind !== "folder"
              ? <Button onClick={() => nav("/record")}><RecordDot /> Record a meeting</Button>
              : undefined}
          />
        </Card>
      )}

      {filtered.length > 0 && (
        <Card className="divide-y divide-hairline">
          {filtered.map((c) => {
            const folder = scope.kind === "all" && c.folderId ? folders.find((f) => f.id === c.folderId) : undefined;
            return (
              <button
                key={`${c.source}-${c.id}`}
                onClick={() => nav(`/meetings/${c.id}`)}
                className="group flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-surface-muted"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-md font-medium text-ink-text">{c.title}</span>
                    {c.source === "local" && <Badge tone="warn">On this device</Badge>}
                    {folder && <Badge tone={folder.tone}>{folder.name}</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-faint">
                    {relativeTime(c.createdAt, now)} · {c.wordCount} words · {c.actionItemCount} action item{c.actionItemCount === 1 ? "" : "s"}
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-ink-text" />
              </button>
            );
          })}
        </Card>
      )}
    </Page>
  );
}

function ScopeChip({ active, onClick, tone, children }: {
  active: boolean; onClick: () => void; tone?: Folder["tone"]; children: React.ReactNode;
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
