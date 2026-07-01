import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Copy, Check, Trash2, FileText, ListChecks, MessageSquareText } from "lucide-react";
import { Page } from "../components/PageHeader.tsx";
import { Button, Card, Chip, Spinner } from "../components/ui.tsx";
import { getMeeting, deleteMeeting, type LocalMeeting } from "../lib/meetingsStore.ts";
import { hasBackend } from "../lib/config.ts";
import { saveMeetingToNotion } from "../lib/notion.ts";

export function MeetingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [meeting, setMeeting] = useState<LocalMeeting | null | undefined>(undefined);
  const [tab, setTab] = useState<"notes" | "transcript">("notes");
  const [copied, setCopied] = useState(false);
  const [notion, setNotion] = useState<{ busy: boolean; msg: string; error: boolean }>({ busy: false, msg: "", error: false });

  useEffect(() => { if (id) getMeeting(id).then(setMeeting); }, [id]);

  if (meeting === undefined) return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted"><Spinner /> Loading…</div>;
  if (meeting === null) return <Page><p className="text-sm text-muted">Meeting not found.</p></Page>;

  async function copyMd() {
    await navigator.clipboard.writeText(meeting!.noteMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  async function remove() {
    await deleteMeeting(meeting!.id);
    nav("/meetings");
  }
  async function saveNotion() {
    if (!hasBackend) { nav("/integrations"); return; }
    setNotion({ busy: true, msg: "", error: false });
    try {
      const url = await saveMeetingToNotion(meeting!.title, meeting!.noteMarkdown);
      setNotion({ busy: false, msg: `Saved to Notion${url ? "" : ""}`, error: false });
    } catch (e) {
      setNotion({ busy: false, msg: e instanceof Error ? e.message : String(e), error: true });
    }
  }

  return (
    <Page>
      <button onClick={() => nav("/meetings")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink-text">
        <ArrowLeft className="h-4 w-4" /> Meetings
      </button>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-ink-text">{meeting.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted">
            <span>{new Date(meeting.createdAt).toLocaleString()}</span>
            <span>·</span><span>{meeting.wordCount} words</span>
            {!meeting.synced && <Chip tone="warn">Local only</Chip>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={saveNotion} disabled={notion.busy}
            title={hasBackend ? "Save these notes to Notion" : "Connect Notion in Integrations to enable"}>
            {notion.busy ? <Spinner /> : <FileText className="h-4 w-4" />} Save to Notion
          </Button>
          <Button variant="outline" onClick={copyMd}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy Markdown"}</Button>
          <Button variant="ghost" onClick={remove} aria-label="Delete meeting"><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      {notion.msg && (
        <div className={`mb-4 rounded-xl px-4 py-2.5 text-sm ${notion.error ? "bg-red-50 text-red-700" : "bg-accent-soft text-accent-strong"}`}>
          {notion.msg}
        </div>
      )}

      <div className="mb-5 inline-flex rounded-xl bg-surface-muted p-1">
        {([["notes", "Notes", FileText], ["transcript", "Transcript", MessageSquareText]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium ${tab === key ? "bg-surface text-ink-text shadow-sm" : "text-muted"}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "notes" ? (
        <div className="space-y-5">
          <NoteBlock title="Summary" items={meeting.summary} />
          {meeting.actionItems.length > 0 && (
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-text"><ListChecks className="h-4 w-4 text-accent-strong" /> Action items</div>
              <ul className="space-y-2">
                {meeting.actionItems.map((a, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-ink-text">
                    <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-hairline" />{a}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <NoteBlock title="Decisions" items={meeting.decisions} />
          <NoteBlock title="Open questions" items={meeting.questions} />
          {meeting.summary.length === 0 && meeting.actionItems.length === 0 && (
            <p className="text-sm text-muted">No structured notes were extracted — the transcript may have been very short.</p>
          )}
        </div>
      ) : (
        <Card className="space-y-4 p-6">
          {meeting.segments.length === 0 ? (
            <p className="text-sm text-muted">No transcript captured.</p>
          ) : meeting.segments.map((s) => (
            <div key={s.id}>
              <div className="mb-1 text-[11px] font-medium text-accent-strong">{s.speakerLabel}</div>
              <p className="text-[15px] leading-relaxed text-ink-text">{s.text}</p>
            </div>
          ))}
        </Card>
      )}
    </Page>
  );
}

function NoteBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="p-5">
      <div className="mb-3 text-sm font-semibold text-ink-text">{title}</div>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-text">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{it}
          </li>
        ))}
      </ul>
    </Card>
  );
}
