import { useEffect, useRef } from "react";
import { formatElapsed } from "@parleynotes/ui";
import type { LocalSegment } from "../../lib/meetingsStore.ts";

/** The live, auto-scrolling transcript. Speaker labels shown when diarization
 *  supplies them; otherwise segments render without fabricated attribution. */
export function LiveTranscript({ segments, live }: { segments: LocalSegment[]; live: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments.length, live]);

  if (segments.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
        {live ? "Listening… transcript appears here as people speak." : "No transcript yet."}
      </div>
    );
  }

  return (
    <div className="space-y-4 px-1 py-1">
      {segments.map((s) => (
        <div key={s.id} className="pn-rise">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-muted">
            <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-accent-strong">{s.speakerLabel}</span>
            <span className="tabular-nums">{formatElapsed(s.startMs / 1000)}</span>
          </div>
          <p className="text-[15px] leading-relaxed text-ink-text">{s.text}</p>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
