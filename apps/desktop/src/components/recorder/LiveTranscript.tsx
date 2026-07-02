// The live transcript — a court record being typeset before your eyes. Mono
// timestamps in a left gutter, heritage-toned speaker marks, per-segment ASR
// confidence flagged when it drops. Speaker labels appear only when diarization
// supplies them; nothing is fabricated.
import { useEffect, useRef } from "react";
import { formatElapsed, confidenceTier } from "@parleynotes/ui";
import type { LocalSegment } from "../../lib/meetingsStore.ts";
import { SpeakerTag } from "../SpeakerTag.tsx";

export function LiveTranscript({ segments, live }: { segments: LocalSegment[]; live: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments.length, live]);

  if (segments.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        {live && <div className="pn-shimmer h-px w-40" />}
        <p className="text-sm text-muted">
          {live ? "Listening… the transcript appears here as people speak." : "No transcript yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="pn-prose space-y-5 px-1 py-1">
      {segments.map((s) => {
        const asr = confidenceTier(s.confidence);
        return (
          <div key={s.id} className="pn-rise grid grid-cols-[52px_1fr] gap-x-3">
            <span className="pt-0.5 text-right font-mono text-[10.5px] tabular-nums leading-5 text-faint">
              {formatElapsed(s.startMs / 1000)}
            </span>
            <div className="border-l border-hairline pl-3">
              <div className="mb-1 flex items-center gap-2">
                <SpeakerTag label={s.speakerLabel} confidence={s.speakerConfidence} />
                {(asr === "medium" || asr === "low") && (
                  <span
                    className="font-mono text-[9.5px] uppercase tracking-wider text-faint/80"
                    title={`Transcription confidence: ${Math.round((s.confidence ?? 0) * 100)}%`}
                  >
                    {asr === "medium" ? "unsure" : "low confidence"}
                  </span>
                )}
              </div>
              <p className="text-[15px] leading-relaxed text-ink-text">{s.text}</p>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
