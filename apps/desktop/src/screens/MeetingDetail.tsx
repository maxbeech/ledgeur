// A single entry in the record: editorial notes page + fully attributed
// transcript. Opens local meetings instantly and falls back to the cloud copy
// (recorded on another device). Delete asks for confirmation.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Copy, Check, Trash2, FileText, ListChecks, MessageSquareText, PenLine } from "lucide-react";
import { formatElapsed } from "@parleynotes/ui";
import { Page } from "../components/PageHeader.tsx";
import { Button, Card, ErrorNote, Kicker, Spinner } from "../components/ui.tsx";
import { SpeakerTag } from "../components/SpeakerTag.tsx";
import { getMeeting, deleteMeeting, type LocalMeeting } from "../lib/meetingsStore.ts";
import { getCloudMeeting, deleteCloudMeeting } from "../lib/cloudMeeting.ts";
import { hasBackend } from "../lib/config.ts";
import { saveMeetingToNotion } from "../lib/notion.ts";

export function MeetingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [meeting, setMeeting] = useState<LocalMeeting | null | undefined>(undefined);
  const [tab, setTab] = useState<"notes" | "transcript">("notes");
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notion, setNotion] = useState<{ busy: boolean; msg: string; error: boolean }>({ busy: false, msg: "", error: false });
  const [fromCloud, setFromCloud] = useState(false);

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

      <header className="pn-rise mb-6">
        <Kicker className="mb-2">
          {new Date(meeting.createdAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })} · {meeting.wordCount} words
          {!meeting.synced && <span className="text-warn"> · local only</span>}
        </Kicker>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="pn-display min-w-0 text-[28px] leading-tight text-ink-text">{meeting.title}</h1>
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
        <div className="pn-stagger pn-prose space-y-5">
          <NoteBlock title="Summary" items={meeting.summary} />
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
                {meeting.actionItems.map((a, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[15px] leading-relaxed text-ink-text">
                    <span className="mt-1 h-4 w-4 shrink-0 rounded border border-hairline-strong" />{a}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <NoteBlock title="Decisions" items={meeting.decisions} />
          <NoteBlock title="Open questions" items={meeting.questions} />
          {meeting.summary.length === 0 && meeting.actionItems.length === 0 && !meeting.manualNotes?.trim() && (
            <p className="text-sm text-muted">No structured notes were extracted — the transcript may have been very short.</p>
          )}
        </div>
      ) : (
        <Card className="pn-prose p-6">
          {speakers.length > 1 && (
            <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline pb-4">
              <Kicker>Speakers</Kicker>
              {speakers.map(([label, count]) => (
                <span key={label} className="flex items-baseline gap-1.5">
                  <SpeakerTag label={label} />
                  <span className="font-mono text-[10px] text-faint">×{count}</span>
                </span>
              ))}
            </div>
          )}
          {meeting.segments.length === 0 ? (
            <p className="text-sm text-muted">No transcript captured.</p>
          ) : (
            <div className="space-y-5">
              {meeting.segments.map((s) => (
                <div key={s.id} className="grid grid-cols-[52px_1fr] gap-x-3">
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

function NoteBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="p-6">
      <Kicker className="mb-3">{title}</Kicker>
      <ul className="space-y-2.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[15px] leading-relaxed text-ink-text">
            <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{it}
          </li>
        ))}
      </ul>
    </Card>
  );
}
