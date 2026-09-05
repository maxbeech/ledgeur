// A single entry in the record: editorial notes page + fully attributed
// transcript. Opens local meetings instantly and falls back to the cloud copy
// (recorded on another device). Delete asks for confirmation.
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
import { formatElapsed } from "@ledgeur/ui";
import { attributeMeetingNotes, type AttributedNote, type AttributableLine } from "@ledgeur/core";
import { Page } from "../components/PageHeader.tsx";
import { Button, Card, ErrorNote, Kicker, Spinner } from "../components/ui.tsx";
import { SpeakerTag } from "../components/SpeakerTag.tsx";
import { FollowUpPanel } from "../components/meeting/FollowUpPanel.tsx";
import { getMeeting, saveMeeting, deleteMeeting, type LocalMeeting } from "../lib/meetingsStore.ts";
import { renameSpeakerInMeeting } from "../lib/renameSpeaker.ts";
import { getCloudMeeting, deleteCloudMeeting } from "../lib/cloudMeeting.ts";
import { hasBackend } from "../lib/config.ts";
import { saveMeetingToNotion } from "../lib/notion.ts";
import { useFolders, setMeetingFolder } from "../lib/folders.ts";

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
    if (!fromCloud) await saveMeeting(updated).catch((e: unknown) => {
      setRenameNote(e instanceof Error ? e.message : String(e));
    });
  }

  if (meeting === undefined) return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted"><Spinner /> Loading…</div>;
  if (meeting === null) return <Page><p className="py-10 text-center text-sm text-muted">This meeting isn't in your record (it may have been deleted).</p></Page>;

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

  return (
    <Page>
      <button onClick={() => nav("/meetings")} className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink-text">
        <ArrowLeft className="h-4 w-4" /> Library
      </button>

      <header className="ldg-rise mb-6">
        <Kicker className="mb-2">
          {new Date(meeting.createdAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })} · {meeting.wordCount} words
          {!meeting.synced && <span className="text-warn"> · local only</span>}
        </Kicker>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="ldg-display min-w-0 text-[28px] leading-tight text-ink-text">{meeting.title}</h1>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={saveNotion} disabled={notion.busy}
              title={hasBackend ? "Save these notes to Notion" : "Connect Notion in Settings to enable"}>
              {notion.busy ? <Spinner /> : <FileText className="h-4 w-4" />} Save to Notion
            </Button>
            <Button size="sm" variant="outline" onClick={copyMd}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant={confirmDelete ? "danger" : "ghost"} onClick={remove} aria-label="Delete meeting">
              <Trash2 className="h-4 w-4" /> {confirmDelete ? "Sure?" : ""}
            </Button>
          </div>
        </div>
        {/* Filing. Local meetings only: a cloud copy belongs to whichever
            device recorded it, and spaces are this device's organisation. */}
        {!fromCloud && (
          <div className="mt-3 flex items-center gap-2">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-faint" />
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
              className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink-text outline-none focus:ring-2 focus:ring-accent/40"
            >
              <option value="">Unfiled</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {folders.length === 0 && (
              <span className="text-[11px] text-faint">Create spaces in the Library to file meetings.</span>
            )}
          </div>
        )}
        <div className="mt-4 h-px bg-hairline" />
      </header>

      {notion.msg && (notion.error
        ? <ErrorNote className="mb-4">{notion.msg}</ErrorNote>
        : <div className="mb-4 rounded-xl bg-accent-soft px-4 py-2.5 text-sm text-accent-strong">{notion.msg}</div>)}

      <div className="mb-6 inline-flex rounded-xl bg-surface-muted p-1">
        {([["notes", "Notes", FileText], ["transcript", "Transcript", MessageSquareText]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all ${tab === key ? "bg-surface text-ink-text shadow-sm" : "text-muted hover:text-ink-text"}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "notes" ? (
        <div className="ldg-stagger ldg-prose space-y-5">
          <NoteBlock title="Summary" items={attributed?.summary ?? []} onJump={openAt} />
          {meeting.manualNotes?.trim() && (
            <Card className="border-glow/25 p-6">
              <div className="mb-3 flex items-center gap-2"><PenLine className="h-4 w-4 text-glow-strong" /><Kicker>Your notes</Kicker></div>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-text">{meeting.manualNotes.trim()}</p>
            </Card>
          )}
          {meeting.actionItems.length > 0 && (
            <Card className="p-6">
              <div className="mb-3 flex items-center gap-2"><ListChecks className="h-4 w-4 text-accent-strong" /><Kicker>Action items</Kicker></div>
              <ul className="space-y-2.5">
                {(attributed?.actionItems ?? []).map((a, i) => (
                  <li key={i} className="text-[15px] leading-relaxed text-ink-text">
                    <span className="flex items-start gap-2.5">
                      <span className="mt-1 h-4 w-4 shrink-0 rounded border border-hairline-strong" />
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
            <p className="text-sm text-muted">No structured notes were extracted — the transcript may have been very short.</p>
          )}
          {/* Lines nothing in the transcript supports. Worth naming rather than
              leaving as a silently uncited bullet: it is either a model getting
              ahead of itself or a gap in what was heard, and both are things
              somebody reading these notes should know before acting on them. */}
          {attributed && attributed.unsupported > 0 && meeting.segments.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-warn/25 bg-warn-soft/40 px-4 py-3 text-[12.5px] leading-relaxed text-ink-text">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
              <span>
                {attributed.unsupported} note {attributed.unsupported === 1 ? "line has" : "lines have"} no matching
                moment in the transcript, so {attributed.unsupported === 1 ? "it carries" : "they carry"} no link back.
                That usually means paraphrasing, but it can also mean something was misheard — worth a look before
                you rely on {attributed.unsupported === 1 ? "it" : "them"}.
              </span>
            </div>
          )}
          {!fromCloud && <FollowUpPanel meeting={meeting} />}
        </div>
      ) : (
        <Card className="ldg-prose p-6">
          {speakers.length > 0 && (
            <div className="mb-6 border-b border-hairline pb-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Kicker>Speakers</Kicker>
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
                          className="w-40 rounded-lg border border-hairline bg-surface px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-accent/40"
                        />
                        <Button size="sm" type="submit">Save</Button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setRenaming(label); setDraftName(label); setRenameNote(""); }}
                        title="Click to say who this is — Ledgeur will recognise them next time"
                        className="cursor-pointer"
                      >
                        <SpeakerTag label={label} />
                      </button>
                    )}
                    <span className="font-mono text-[10px] text-faint">×{count}</span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-faint">
                Click a name to say who it is. The voice print is saved on this device, and every
                later meeting recognises them without being asked again.
              </p>
              {renameNote && <ErrorNote className="mt-3">{renameNote}</ErrorNote>}
            </div>
          )}
          {meeting.segments.length === 0 ? (
            <p className="text-sm text-muted">No transcript captured.</p>
          ) : (
            <div className="space-y-5">
              {meeting.segments.map((s) => (
                <div
                  key={s.id}
                  ref={(el) => { if (el) segmentRefs.current.set(s.id, el); else segmentRefs.current.delete(s.id); }}
                  className={`grid grid-cols-[52px_1fr] gap-x-3 rounded-lg transition-colors duration-500 ${jumpTo === s.id ? "bg-glow-soft/60" : ""}`}
                >
                  <span className="pt-0.5 text-right font-mono text-[10.5px] tabular-nums leading-5 text-faint">{formatElapsed(s.startMs / 1000)}</span>
                  <div className="border-l border-hairline pl-3">
                    <div className="mb-1"><SpeakerTag label={s.speakerLabel} confidence={s.speakerConfidence} /></div>
                    <p className="text-[15px] leading-relaxed text-ink-text">{s.text}</p>
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
    <Card className="p-6">
      <Kicker className="mb-3">{title}</Kicker>
      <ul className="space-y-3">
        {items.map((it, i) => (
          <li key={i} className="text-[15px] leading-relaxed text-ink-text">
            <span className="flex items-start gap-2.5">
              <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
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
      className="mt-1 ml-[18px] inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-faint transition-colors hover:text-accent-strong"
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
