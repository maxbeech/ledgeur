"use client";

// The transcript, and the one interaction that makes diarization worth having:
// clicking a speaker's name and telling Ledgeur who they are.

import { useState } from "react";
import { formatOffset, speakerLabel, type LocalMeeting } from "@ledgeur/core";
import { SpeakerChip, Button } from "@ledgeur/ui/components";
import { cn } from "@ledgeur/ui";

export function Transcript({
  meeting, onRename, editable = true, className,
}: {
  meeting: Pick<LocalMeeting, "segments" | "speakers">;
  onRename?: (speaker: number, name: string) => void;
  editable?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  if (meeting.segments.length === 0) {
    return (
      <p className={cn("py-10 text-center text-[14px] text-faint", className)}>
        The transcript will appear here as the meeting is recorded.
      </p>
    );
  }

  function beginEdit(speaker: number) {
    setEditing(speaker);
    setDraft(speakerLabel(meeting, speaker) ?? "");
  }

  function commit() {
    if (editing != null && draft.trim()) onRename?.(editing, draft.trim());
    setEditing(null);
  }

  return (
    <div className={cn("ldg-prose divide-y divide-hairline", className)}>
      {meeting.segments.map((segment, i) => {
        const label = speakerLabel(meeting, segment.speaker);
        const speakerRow = meeting.speakers.find((s) => s.speaker === segment.speaker);
        // A previous line by the same speaker means the name is already on
        // screen; repeating it turns a conversation into a list.
        const repeated = i > 0 && meeting.segments[i - 1].speaker === segment.speaker;

        return (
          <div key={`${segment.startMs}-${i}`} className="flex gap-3 py-2.5">
            <time className="mt-1 w-11 shrink-0 font-mono text-[11px] text-faint tabular-nums">
              {formatOffset(segment.startMs)}
            </time>
            <div className="min-w-0 flex-1">
              {label && !repeated && (
                editing === segment.speaker ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); commit(); }}
                    className="mb-1.5 flex flex-wrap items-center gap-2"
                  >
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }}
                      aria-label="Speaker name"
                      placeholder="Who is this?"
                      className="w-40 rounded-lg border border-hairline-strong bg-paper px-2.5 py-1 text-[13px] outline-none focus:border-accent"
                    />
                    <Button type="submit" size="sm">Save</Button>
                    <button type="button" onClick={() => setEditing(null)} className="text-[12px] text-muted hover:text-ink-text">
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => editable && segment.speaker != null && beginEdit(segment.speaker)}
                    disabled={!editable || segment.speaker == null}
                    title={editable ? "Click to name this voice — Ledgeur will recognise them next time" : undefined}
                    className={cn("mb-1.5 block", editable && "cursor-pointer")}
                  >
                    <SpeakerChip label={label} confidence={speakerRow?.confidence ?? null} />
                  </button>
                )
              )}
              <p className="text-[14.5px] leading-relaxed text-ink-text">{segment.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
