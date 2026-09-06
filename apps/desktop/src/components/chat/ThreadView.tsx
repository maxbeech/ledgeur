// A conversation: transcript lines, copilot answers, your questions and
// proactive suggestions, as one auto-scrolling thread.
import { useEffect, useRef } from "react";
import type { ThreadItem } from "../../lib/thread.ts";
import { ThreadBubble } from "./ThreadBubble.tsx";

export function ThreadView({
  items,
  busy,
  live,
  onQuote,
  emptyHint,
}: {
  items: ThreadItem[];
  busy?: boolean;
  live?: boolean;
  onQuote?: (item: ThreadItem) => void;
  emptyHint?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest entry only when the reader is already near the end.
  useEffect(() => {
    if (atBottom.current) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items.length, busy]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  };

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        {live && <div className="ldg-shimmer h-px w-40" />}
        <p className="max-w-sm text-sm leading-relaxed text-muted">
          {emptyHint ?? (live ? "Listening. What is said appears here, and you can ask the copilot anything." : "No conversation yet.")}
        </p>
      </div>
    );
  }

  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
      {items.map((item) => <ThreadBubble key={item.id} item={item} onQuote={onQuote} />)}
      {busy && (
        <div className="flex items-center gap-3 pl-10">
          <div className="ldg-shimmer h-px w-24" />
          <span className="text-xs font-medium text-brand-strong">Reading the record</span>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
