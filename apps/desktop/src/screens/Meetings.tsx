// The Library — every recording, transcript and set of notes, searchable and
// filed into spaces. Cloud + unsynced-local merged (useMeetings); explicit
// loading/empty/error.
//
// Spaces are one level deep on purpose (see folders.ts): the rail filters, and
// search covers everything nesting would have been for.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CircleDot, Library as LibraryIcon, ArrowUpRight, Plus, FolderOpen, Trash2, Inbox } from "lucide-react";
import { relativeTime, cn } from "@ledgeur/ui";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, Chip, EmptyState, ErrorNote, Spinner } from "../components/ui.tsx";
import { useMeetings } from "../lib/useMeetings.ts";
import { useFolders, useFolderCounts, createFolder, deleteFolder, type Folder } from "../lib/folders.ts";

/** "All" and "Unfiled" are not folders — they are views over the same set. */
type Scope = { kind: "all" } | { kind: "unfiled" } | { kind: "folder"; id: string };

export function Meetings() {
  const nav = useNavigate();
  const { cards, error, refresh } = useMeetings();
  const folders = useFolders();
  const counts = useFolderCounts();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [folderError, setFolderError] = useState("");
  const now = new Date();

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
      setFolderError("");
      setScope({ kind: "folder", id: folder.id });
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeFolder(folder: Folder) {
    const moved = await deleteFolder(folder.id);
    setScope({ kind: "all" });
    setFolderError(moved > 0
      ? `“${folder.name}” was removed. ${moved} meeting${moved === 1 ? "" : "s"} moved back to Unfiled — nothing was deleted.`
      : "");
    await refresh();
  }

  return (
    <Page>
      <PageHeader
        kicker="The library"
        title="Meetings"
        subtitle="Every recording, transcript and set of notes — searchable, and filed how you work."
        action={<Button variant="accent" onClick={() => nav("/record")}><CircleDot className="h-4 w-4" /> Record</Button>}
      />

      <div className="ldg-stagger">
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-hairline bg-surface px-3.5 py-2.5 transition-shadow focus-within:shadow-[var(--shadow-card)] focus-within:ring-2 focus-within:ring-accent/30">
          <Search className="h-4 w-4 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            name="library-search" placeholder="Search meetings and transcripts…"
            className="ldg-prose min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            aria-label="Search meetings"
          />
        </div>

        {/* Spaces. Shown as a row of filters rather than a tree — see folders.ts */}
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <ScopeChip active={scope.kind === "all"} onClick={() => setScope({ kind: "all" })} icon={<LibraryIcon className="h-3.5 w-3.5" />}>
            All{cards ? ` · ${cards.length}` : ""}
          </ScopeChip>
          {folders.map((f) => (
            <span key={f.id} className="group relative inline-flex">
              <ScopeChip
                active={scope.kind === "folder" && scope.id === f.id}
                onClick={() => setScope({ kind: "folder", id: f.id })}
                icon={<FolderOpen className="h-3.5 w-3.5" />}
              >
                {f.name} · {counts.byFolder[f.id] ?? 0}
              </ScopeChip>
              <button
                onClick={() => void removeFolder(f)}
                aria-label={`Delete the space ${f.name}`}
                title="Delete this space — the meetings in it are kept"
                className="ml-0.5 rounded-md px-1 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
          {(folders.length > 0 || counts.unfiled > 0) && (
            <ScopeChip active={scope.kind === "unfiled"} onClick={() => setScope({ kind: "unfiled" })} icon={<Inbox className="h-3.5 w-3.5" />}>
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
                placeholder="Customers, Hiring, Board…"
                aria-label="Name of the new space"
                className="w-48 rounded-full border border-hairline bg-surface px-3 py-1 text-xs outline-none focus:ring-2 focus:ring-accent/40"
              />
              <Button size="sm" type="submit">Add</Button>
            </form>
          ) : (
            <button
              onClick={() => { setAdding(true); setFolderError(""); }}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-hairline-strong px-3 py-1 text-[11.5px] text-muted transition-colors hover:border-accent/50 hover:text-ink-text"
            >
              <Plus className="h-3 w-3" /> New space
            </button>
          )}
        </div>

        {folderError && <ErrorNote className="mb-4">{folderError}</ErrorNote>}
        {error && <ErrorNote className="mb-4">{error}</ErrorNote>}

        {cards === null && !error && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Loading…</div>
        )}

        {cards !== null && filtered.length === 0 && (
          <Card>
            <EmptyState
              icon={<LibraryIcon className="h-5 w-5" />}
              title={q ? "No matches" : scope.kind === "folder" ? "Nothing filed here yet" : "The shelves are empty"}
              body={
                q ? "Try a different search term."
                  : scope.kind === "folder" ? "Open a meeting and choose this space to file it here."
                    : "Record your first meeting to start the company's record."
              }
              action={!q && scope.kind !== "folder"
                ? <Button variant="accent" onClick={() => nav("/record")}><CircleDot className="h-4 w-4" /> Record a meeting</Button>
                : undefined}
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
                    {scope.kind === "all" && c.folderId && (
                      <Chip>{folders.find((f) => f.id === c.folderId)?.name ?? "unfiled"}</Chip>
                    )}
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

function ScopeChip({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors",
        active
          ? "border-accent/50 bg-accent-soft/60 text-ink-text"
          : "border-hairline bg-surface text-muted hover:bg-surface-muted/60 hover:text-ink-text",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
