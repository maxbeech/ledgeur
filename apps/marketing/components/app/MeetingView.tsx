"use client";

// One saved meeting: its notes, its transcript, who spoke and for how long, and
// everything you can do with it.

import { useCallback, useMemo, useState } from "react";
import {
  formatOffset, meetingToMarkdown, exportFilename, speakingShare, transcriptWithSpeakers,
  speakerLabel as speakerLabelOf, type LocalMeeting,
} from "@ledgeur/core";
import { Badge, Button, Card, ErrorNote, Kicker, SpeakerChip } from "@ledgeur/ui/components";
import { Transcript } from "./Transcript";

export function MeetingView({
  meeting, onRename, onMerge, onSave, onDelete, onBack,
}: {
  meeting: LocalMeeting;
  onRename: (speaker: number, name: string) => Promise<string>;
  onMerge: (from: number, into: number) => void;
  onSave: (meeting: LocalMeeting) => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<"transcript" | "markdown" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const share = useMemo(() => speakingShare(meeting), [meeting]);
  const [mergeFrom, setMergeFrom] = useState<number | null>(null);

  const rename = useCallback(async (speaker: number, name: string) => {
    setNotice(await onRename(speaker, name));
  }, [onRename]);

  const copy = useCallback((what: "transcript" | "markdown") => {
    const text = what === "transcript" ? transcriptWithSpeakers(meeting) : meetingToMarkdown(meeting);
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    });
  }, [meeting]);

  const download = useCallback(() => {
    // A Blob URL rather than a data: URI — a long meeting's Markdown can exceed
    // what some browsers accept in a data URI, and would silently do nothing.
    const blob = new Blob([meetingToMarkdown(meeting)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename(meeting, "md");
    a.click();
    // Revoked on the next tick: revoking immediately can cancel the download in
    // some browsers before it has started reading.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [meeting]);

  const notes = meeting.notes;

  return (
    <div className="space-y-5">
      <Card raised className="p-6">
        <button onClick={onBack} className="text-[13px] text-muted hover:text-ink-text lg:hidden">
          ← All meetings
        </button>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {titleDraft === null ? (
              <button
                onClick={() => setTitleDraft(meeting.title)}
                title="Rename this meeting"
                className="ldg-display text-left text-[24px] leading-tight text-ink-text hover:underline"
              >
                {meeting.title}
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (titleDraft.trim()) onSave({ ...meeting, title: titleDraft.trim() });
                  setTitleDraft(null);
                }}
                className="flex flex-wrap gap-2"
              >
                <input
                  autoFocus value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") setTitleDraft(null); }}
                  aria-label="Meeting title"
                  className="min-w-0 flex-1 rounded-lg border border-hairline-strong bg-paper px-3 py-1.5 text-[16px] outline-none focus:border-accent"
                />
                <Button type="submit" size="sm">Save</Button>
              </form>
            )}
            <p className="mt-1.5 text-[13px] text-faint">
              {new Date(meeting.startedAt).toLocaleString()} · {formatOffset(meeting.durationSec * 1000)}
              {meeting.source === "import" && meeting.sourceName && ` · imported from ${meeting.sourceName}`}
            </p>
          </div>
          {meeting.source === "import" && <Badge tone="neutral">Imported</Badge>}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" tone="secondary" onClick={() => copy("transcript")}>
            {copied === "transcript" ? "Copied ✓" : "Copy transcript"}
          </Button>
          <Button size="sm" tone="secondary" onClick={() => copy("markdown")}>
            {copied === "markdown" ? "Copied ✓" : "Copy as Markdown"}
          </Button>
          <Button size="sm" tone="secondary" onClick={download}>Download .md</Button>
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <Button size="sm" tone="danger" onClick={onDelete}>Delete for good</Button>
              <button onClick={() => setConfirmDelete(false)} className="text-[12.5px] text-muted hover:text-ink-text">
                Keep it
              </button>
            </span>
          ) : (
            <Button size="sm" tone="ghost" onClick={() => setConfirmDelete(true)} className="text-danger">
              Delete
            </Button>
          )}
        </div>

        {notice && <ErrorNote className="mt-4">{notice}</ErrorNote>}
      </Card>

      {meeting.speakers.length > 0 && (
        <Card raised className="p-6">
          <Kicker>Who spoke</Kicker>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Click a name in the transcript to say who it is. Ledgeur remembers the voice and
            recognises them next time — on this device only, and never uploaded.
          </p>

          <ul className="mt-4 space-y-2.5">
            {share.map((s) => (
              <li key={s.label} className="flex items-center gap-3">
                <span className="w-32 shrink-0"><SpeakerChip label={s.label} /></span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(s.share * 100)}%` }} />
                </span>
                <span className="w-24 shrink-0 text-right font-mono text-[11.5px] text-faint tabular-nums">
                  {formatOffset(s.seconds * 1000)} · {Math.round(s.share * 100)}%
                </span>
              </li>
            ))}
          </ul>

          {/* Splitting one person into two is the failure this product
              deliberately prefers over the alternative — so the fix has to be
              here, not a support ticket. */}
          {meeting.speakers.length > 1 && (
            <div className="mt-5 border-t border-hairline pt-4">
              <p className="text-[13px] text-muted">
                Two of these the same person? Fold one into the other.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {mergeFrom === null ? (
                  meeting.speakers.map((s) => (
                    <button
                      key={s.speaker}
                      onClick={() => setMergeFrom(s.speaker)}
                      className="rounded-full border border-hairline-strong px-3 py-1 text-[12.5px] text-ink-text transition-colors hover:border-accent"
                    >
                      {s.label}
                    </button>
                  ))
                ) : (
                  <>
                    <span className="text-[12.5px] text-muted">
                      Fold <strong className="text-ink-text">{speakerLabelOf(meeting, mergeFrom)}</strong> into:
                    </span>
                    {meeting.speakers
                      .filter((s) => s.speaker !== mergeFrom)
                      .map((s) => (
                        <button
                          key={s.speaker}
                          onClick={() => { onMerge(mergeFrom, s.speaker); setMergeFrom(null); }}
                          className="rounded-full border border-accent bg-accent-soft px-3 py-1 text-[12.5px] text-accent-strong"
                        >
                          {s.label}
                        </button>
                      ))}
                    <button
                      onClick={() => setMergeFrom(null)}
                      className="text-[12.5px] text-muted hover:text-ink-text"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {notes && (notes.summary.length > 0 || notes.actionItems.length > 0) && (
        <Card raised className="p-6">
          <Kicker>Notes</Kicker>
          <p className="mt-1.5 text-[12px] text-faint">
            Pulled from what was actually said. Nothing here is invented — if a decision is missing,
            it was not stated plainly enough to extract.
          </p>
          <div className="mt-4 space-y-5">
            <NoteSection title="Summary" items={notes.summary} />
            <NoteSection title="Decisions" items={notes.decisions} />
            <NoteSection title="Action items" items={notes.actionItems} />
            <NoteSection title="Open questions" items={notes.questions} />
          </div>
        </Card>
      )}

      <Card raised className="p-6">
        <Kicker>Transcript</Kicker>
        <Transcript meeting={meeting} onRename={rename} className="mt-3" />
      </Card>

      <Card raised className="p-6">
        <Kicker>Your own notes</Kicker>
        <textarea
          value={meeting.manualNotes}
          onChange={(e) => onSave({ ...meeting, manualNotes: e.target.value })}
          placeholder="Anything you want to remember that nobody said out loud."
          aria-label="Your own notes"
          className="mt-3 h-32 w-full resize-y rounded-xl border border-hairline bg-paper p-3.5 text-[14px] leading-relaxed outline-none focus:border-accent"
        />
        <p className="mt-2 text-[12px] text-faint">
          Kept verbatim, and included in every export above the generated summary.
        </p>
      </Card>
    </div>
  );
}

function NoteSection({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-[13px] font-medium text-ink-text">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-[14px] leading-relaxed text-muted">
            <span aria-hidden className="mt-[3px] text-accent-strong">·</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
