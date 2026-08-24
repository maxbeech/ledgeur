"use client";

// The library: every meeting on this device, and a search across all of them.

import { useMemo, useState } from "react";
import { formatOffset, searchLibrary, type LocalMeeting } from "@ledgeur/core";
import { Badge, EmptyState, Button } from "@ledgeur/ui/components";
import { cn } from "@ledgeur/ui";

export function Library({
  meetings, selectedId, onSelect, onNew, loading, error,
}: {
  meetings: LocalMeeting[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  loading: boolean;
  error: string;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  // Searching the transcripts, not just the titles — the phrase you remember is
  // almost never in the title.
  const hits = useMemo(() => (trimmed ? searchLibrary(meetings, trimmed) : []), [meetings, trimmed]);
  const matchedIds = useMemo(() => new Set(hits.map((h) => h.meetingId)), [hits]);
  const shown = trimmed ? meetings.filter((m) => matchedIds.has(m.id)) : meetings;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          placeholder="Search everything said…"
          aria-label="Search your meetings"
          className="min-w-0 flex-1 rounded-lg border border-hairline bg-paper px-3 py-1.5 text-[13.5px] outline-none focus:border-accent"
        />
        <Button size="sm" onClick={onNew}>New</Button>
      </div>

      {trimmed && (
        <p className="border-b border-hairline px-4 py-2 text-[12px] text-faint">
          {hits.length === 0
            ? `Nothing matches “${trimmed}”.`
            : `${hits.length} ${hits.length === 1 ? "mention" : "mentions"} across ${shown.length} ${shown.length === 1 ? "meeting" : "meetings"}.`}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && <p className="px-4 py-6 text-[13.5px] text-faint">Opening your library…</p>}

        {error && (
          <p className="m-4 rounded-xl border border-warn/25 bg-warn-soft px-3.5 py-3 text-[13px] leading-relaxed text-warn">
            {error}
            <span className="mt-1.5 block text-[12.5px]">
              Recording still works — but nothing will be kept once you close this tab.
            </span>
          </p>
        )}

        {!loading && !error && meetings.length === 0 && (
          <div className="p-4">
            <EmptyState
              title="Nothing recorded yet"
              body="Record a meeting, or drag an existing recording anywhere onto this page."
              action={<Button size="sm" onClick={onNew}>Record something</Button>}
            />
          </div>
        )}

        <ul>
          {shown.map((meeting) => {
            const mentions = hits.filter((h) => h.meetingId === meeting.id);
            return (
              <li key={meeting.id}>
                <button
                  onClick={() => onSelect(meeting.id)}
                  className={cn(
                    "w-full border-b border-hairline px-4 py-3 text-left transition-colors hover:bg-surface-muted",
                    selectedId === meeting.id && "bg-accent-soft",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 text-[13.5px] font-medium text-ink-text">{meeting.title}</span>
                    {meeting.source === "import" && <Badge tone="neutral">File</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-faint">
                    <time dateTime={meeting.startedAt}>
                      {new Date(meeting.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    </time>
                    <span aria-hidden>·</span>
                    <span>{formatOffset(meeting.durationSec * 1000)}</span>
                    {meeting.speakers.length > 0 && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{meeting.speakers.length} {meeting.speakers.length === 1 ? "voice" : "voices"}</span>
                      </>
                    )}
                  </div>

                  {/* The line the search actually matched, so a result is worth
                      clicking before you click it. */}
                  {mentions.length > 0 && (
                    <p className="mt-2 line-clamp-2 border-l-2 border-accent/40 pl-2.5 text-[12px] leading-relaxed text-muted">
                      {mentions[0].speaker && <span className="font-medium">{mentions[0].speaker}: </span>}
                      {mentions[0].excerpt}
                    </p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
