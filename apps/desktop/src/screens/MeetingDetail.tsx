// A single meeting: the notes and the fully attributed transcript. Opens local
// meetings instantly and falls back to the cloud copy (recorded on another
// device). Delete asks for confirmation.
//
// ── Provenance ──────────────────────────────────────────────────────────────
// Every note line carries a link back to the transcript lines it came from
// (see @ledgeur/core notes/provenance.ts). Clicking it opens the transcript at
// that moment and highlights it. A line with no link is a line nothing in the
// meeting supports well enough to point at — that is shown too, because a
// summary bullet the transcript does not back up is exactly the one worth
// looking at.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Copy, Check, Trash2, FileText, ListChecks, MessageSquareText, PenLine,
  CornerDownRight, FolderOpen, TriangleAlert,
} from "lucide-react";
import { formatElapsed, cn } from "@ledgeur/ui";
import { attributeMeetingNotes, type AttributedNote, type AttributableLine } from "@ledgeur/core";
import { Page } from "../components/PageHeader.tsx";
import { Badge, Button, Card, ErrorNote, IconButton, Label, Notice, Segmented, SpeakerChip, Spinner } from "../components/ui.tsx";
import { FollowUpPanel } from "../components/meeting/FollowUpPanel.tsx";
import { getMeeting, saveMeeting, deleteMeeting, type LocalMeeting } from "../lib/meetingsStore.ts";
import { renameSpeakerInMeeting } from "../lib/renameSpeaker.ts";
import { getCloudMeeting, deleteCloudMeeting } from "../lib/cloudMeeting.ts";
import { hasBackend } from "../lib/config.ts";
import { saveMeetingToNotion } from "../lib/notion.ts";
import { useFolders, setMeetingFolder } from "../lib/folders.ts";

const TABS = [
  { value: "notes", label: <><FileText className="h-4 w-4" /> Notes</> },
  { value: "transcript", label: <><MessageSquareText className="h-4 w-4" /> Transcript</> },
] as const;

export function MeetingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [meeting, setMeeting] = useState<LocalMeeting | null | undefined>(undefined);
  const [tab, setTab] = useState<"notes" | "transcript">("notes");
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notion, setNotion] = useState<{ busy: boolean; msg: string; error: boolean }>({ busy: false, msg: "", error: false });
  const [fromCloud, setFromCloud] = useState(false);
  /** Which speaker is being renamed, and to what. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renameNote, setRenameNote] = useState("");
  /** Transcript line to scroll to and highlight, set by clicking a citation. */
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const folders = useFolders();
  const segmentRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getMeeting(id).then(async (local) => {
      if (cancelled) return;
      if (local) { setMeeting(local); return; }
      const cloud = await getCloudMeeting(id).catch(() => null);
      if (cancelled) return;
      if (cloud) { setMeeting(cloud); setFromCloud(true); } else { setMeeting(null); }
    });
    return () => { cancelled = true; };
  }, [id]);

  const speakers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of meeting?.segments ?? []) seen.set(s.speakerLabel, (seen.get(s.speakerLabel) ?? 0) + 1);
    return [...seen.entries()];
  }, [meeting]);

  // Linking notes back to the transcript is pure and cheap, but it is O(notes ×
  // lines) over a whole meeting — memoised so switching tabs doesn't redo it.
  const attributed = useMemo(() => {
    if (!meeting) return null;
    const lines: AttributableLine[] = meeting.segments.map((s) => ({
      id: s.id, startMs: s.startMs, speakerLabel: s.speakerLabel, text: s.text,
    }));
    return attributeMeetingNotes(meeting, lines);
  }, [meeting]);

  // Scrolling has to happen after the transcript tab has actually rendered.
  useEffect(() => {
    if (!jumpTo || tab !== "transcript") return;
    const el = segmentRefs.current.get(jumpTo);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => setJumpTo(null), 2600);
    return () => clearTimeout(timer);
  }, [jumpTo, tab]);

  const openAt = (lineId: string) => { setTab("transcript"); setJumpTo(lineId); };

  /**
   * Name a voice.
   *
   * Two things happen, and the second is the point: the label changes
   * throughout this meeting, and the voice print is saved under that name so
   * every later meeting recognises the person without being asked again. A
   * cloud copy is read-only here — it belongs to whichever device recorded it.
   */
  async function commitRename(previous: string) {
    const name = draftName.trim();
    setRenaming(null);
    if (!meeting || !name || name === previous) return;
    const { meeting: updated, rememberError } = await renameSpeakerInMeeting(meeting, previous, name);
    setMeeting(updated);
    setRenameNote(rememberError);
    if (!fromCloud) await saveMeeting(updated, "full").catch((e: unknown) => {
      setRenameNote(e instanceof Error ? e.message : String(e));
    });
  }

  if (meeting === undefined) return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted"><Spinner /> Loading</div>;
  if (meeting === null) {
    return (
      <Page>
        <Notice>This meeting isn't on this device or in your workspace. It may have been deleted.</Notice>
      </Page>
    );
  }

  async function copyMd() {
    await navigator.clipboard.writeText(meeting!.noteMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  async function remove() {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3500); return; }
    if (fromCloud) await deleteCloudMeeting(meeting!.id).catch(() => {});
    else await deleteMeeting(meeting!.id);
    nav("/meetings");
  }
  async function saveNotion() {
    if (!hasBackend) { nav("/integrations"); return; }
    setNotion({ busy: true, msg: "", error: false });
    try {
      await saveMeetingToNotion(meeting!.title, meeting!.noteMarkdown);
      setNotion({ busy: false, msg: "Saved to Notion.", error: false });
    } catch (e) {
      setNotion({ busy: false, msg: e instanceof Error ? e.message : String(e), error: true });
    }
  }

  const folder = folders.find((f) => f.id === meeting.folderId);

  return (
    <Page>
      <button onClick={() => nav("/meetings")} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-ink-text">
        <ArrowLeft className="h-4 w-4" /> Library
      </button>

      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="ldg-display text-2xl leading-tight text-ink-text">{meeting.title}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span>{new Date(meeting.createdAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}</span>
              <span>· {meeting.wordCount} words</span>
              {!meeting.synced && <Badge tone="warn">On this device</Badge>}
              {folder && <Badge tone={folder.tone}>{folder.name}</Badge>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" tone="secondary" onClick={saveNotion} disabled={notion.busy}
              title={hasBackend ? "Save these notes to Notion" : "Connect Notion in Settings to enable"}>
              {notion.busy ? <Spinner /> : <FileText className="h-4 w-4" />} Notion
            </Button>
            <Button size="sm" tone="secondary" onClick={copyMd}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
            </Button>
            {confirmDelete
              ? <Button size="sm" tone="danger" onClick={remove}>Delete for good</Button>
              : <IconButton label="Delete meeting" size="sm" onClick={remove}><Trash2 className="h-4 w-4" /></IconButton>}
          </div>
        </div>
        {/* Filing. Local meetings only: a cloud copy belongs to whichever
            device recorded it, and spaces are this device's organisation. */}
        {!fromCloud && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <FolderOpen className="h-4 w-4 shrink-0 text-faint" />
            <label htmlFor="md-folder" className="sr-only">Space</label>
            <select
              id="md-folder"
              value={meeting.folderId ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                setMeeting({ ...meeting, folderId: next ?? undefined });
                void setMeetingFolder(meeting.id, next).catch((err: unknown) =>
                  setRenameNote(err instanceof Error ? err.message : String(err)));
              }}
              className="h-8 rounded-md bg-surface-muted px-2 text-sm font-medium text-ink-text outline-none focus:bg-surface-sunken"
            >
              <option value="">Unfiled</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {folders.length === 0 && <span className="text-xs text-faint">Create spaces in the library to file meetings.</span>}
          </div>
        )}
      </header>

      {notion.msg && (notion.error
        ? <ErrorNote className="mb-4">{notion.msg}</ErrorNote>
        : <Notice tone="accent" className="mb-4">{notion.msg}</Notice>)}

      <Segmented options={TABS} value={tab} onChange={setTab} className="mb-5" />

      {tab === "notes" ? (
        <div className="ldg-prose space-y-4">
          <NoteBlock title="Summary" items={attributed?.summary ?? []} onJump={openAt} />
          {meeting.manualNotes?.trim() && (
            <Card className="border-brand/40 p-5">
              <div className="mb-3 flex items-center gap-2"><PenLine className="h-4 w-4 text-brand-strong" /><Label>Your notes</Label></div>
              <p className="whitespace-pre-wrap text-ink-text">{meeting.manualNotes.trim()}</p>
            </Card>
          )}
          {meeting.actionItems.length > 0 && (
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2"><ListChecks className="h-4 w-4 text-accent-strong" /><Label>Action items</Label></div>
              <ul className="space-y-2.5">
                {(attributed?.actionItems ?? []).map((a, i) => (
                  <li key={i} className="text-ink-text">
                    <span className="flex items-start gap-2.5">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                      <span>{a.text}</span>
                    </span>
                    <CitationLink note={a} onJump={openAt} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <NoteBlock title="Decisions" items={attributed?.decisions ?? []} onJump={openAt} />
          <NoteBlock title="Open questions" items={attributed?.questions ?? []} onJump={openAt} />
          {meeting.summary.length === 0 && meeting.actionItems.length === 0 && !meeting.manualNotes?.trim() && (
            <Notice>No structured notes were extracted — the transcript may have been very short.</Notice>
          )}
          {/* Lines nothing in the transcript supports. Worth naming rather than
              leaving as a silently uncited bullet: it is either a model getting
              ahead of itself or a gap in what was heard, and both are things
              somebody reading these notes should know before acting on them. */}
          {attributed && attributed.unsupported > 0 && meeting.segments.length > 0 && (
            <Notice tone="warn" icon={<TriangleAlert className="h-4 w-4 text-warn" />}>
              {attributed.unsupported} note {attributed.unsupported === 1 ? "line has" : "lines have"} no matching
              moment in the transcript, so {attributed.unsupported === 1 ? "it carries" : "they carry"} no link back.
              That usually means paraphrasing, but it can also mean something was misheard — worth a look before
              you rely on {attributed.unsupported === 1 ? "it" : "them"}.
            </Notice>
          )}
          {!fromCloud && <FollowUpPanel meeting={meeting} />}
        </div>
      ) : (
        <Card className="ldg-prose p-5">
          {speakers.length > 0 && (
            <div className="mb-5 border-b border-hairline pb-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Label>Speakers</Label>
                {speakers.map(([label, count]) => (
                  <span key={label} className="flex items-baseline gap-1.5">
                    {renaming === label ? (
                      <form
                        onSubmit={(e) => { e.preventDefault(); void commitRename(label); }}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          autoFocus
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null); }}
                          aria-label={`Name for ${label}`}
                          placeholder="Who is this?"
                          className="h-8 w-40 rounded-full border border-hairline-strong bg-surface px-3 text-sm outline-none focus:border-brand"
                        />
                        <Button size="sm" type="submit">Save</Button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setRenaming(label); setDraftName(label); setRenameNote(""); }}
                        title="Say who this is — Ledgeur will recognise them next time"
                        className="cursor-pointer"
                      >
                        <SpeakerChip label={label} />
                      </button>
                    )}
                    <span className="ldg-num text-2xs text-faint">×{count}</span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-faint">
                Click a name to say who it is. The voice print is saved on this device, and every
                later meeting recognises them without being asked again.
              </p>
              {renameNote && <ErrorNote className="mt-3">{renameNote}</ErrorNote>}
            </div>
          )}
          {meeting.segments.length === 0 ? (
            <p className="text-sm text-muted">No transcript captured.</p>
          ) : (
            <div className="space-y-4">
              {meeting.segments.map((s) => (
                <div
                  key={s.id}
                  ref={(el) => { if (el) segmentRefs.current.set(s.id, el); else segmentRefs.current.delete(s.id); }}
                  className={cn("-mx-2 flex gap-3 rounded-lg px-2 py-1 transition-colors duration-500", jumpTo === s.id && "bg-brand-soft")}
                >
                  <span className="ldg-num w-11 shrink-0 pt-1 text-right text-xs text-faint">{formatElapsed(s.startMs / 1000)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1"><SpeakerChip label={s.speakerLabel} confidence={s.speakerConfidence} /></div>
                    <p className="text-ink-text">{s.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </Page>
  );
}

function NoteBlock({ title, items, onJump }: { title: string; items: AttributedNote[]; onJump: (lineId: string) => void }) {
  if (items.length === 0) return null;
  return (
    <Card className="p-5">
      <Label className="mb-3">{title}</Label>
      <ul className="space-y-3">
        {items.map((it, i) => (
          <li key={i} className="text-ink-text">
            <span className="flex items-start gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              <span>{it.text}</span>
            </span>
            <CitationLink note={it} onJump={onJump} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * "From 12:04" under a note line — the click that turns a claim into evidence.
 *
 * Absent when the line has no citation, rather than shown greyed out: a
 * disabled link invites clicking, and there is nothing to go to.
 */
function CitationLink({ note, onJump }: { note: AttributedNote; onJump: (lineId: string) => void }) {
  if (!note.citation) return null;
  const { lineIds, startMs, confidence } = note.citation;
  return (
    <button
      type="button"
      onClick={() => onJump(lineIds[0])}
      className="ldg-num ml-4 mt-1 inline-flex items-center gap-1 text-xs font-medium text-faint transition-colors hover:text-brand-strong"
      title={
        confidence >= 0.6
          ? "This line closely matches what was said here"
          : "A looser match — the wording differs from the transcript, so check it"
      }
    >
      <CornerDownRight className="h-3 w-3" />
      from {formatElapsed(startMs / 1000)}
      {confidence < 0.6 && <span className="text-warn"> · loose match</span>}
    </button>
  );
}
