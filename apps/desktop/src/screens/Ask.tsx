// The copilot conversation — question the whole record. Grounded in the org
// hive mind (semantic search when signed in + model up) plus the user's real
// local meetings. The conversation and its input live in the app shell (the
// ever-present bottom field); this screen just renders the shared thread.
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Kicker } from "../components/ui.tsx";
import { ThreadView } from "../components/chat/ThreadView.tsx";
import { useChatDock } from "../lib/useChatDock.ts";
import { messageToItem } from "../lib/thread.ts";

const STARTERS = [
  "What did we decide about pricing?",
  "What are my open action items?",
  "Summarise last week's meetings",
  "What's blocking the launch?",
];

export function Ask() {
  const [params] = useSearchParams();
  const dock = useChatDock();
  const started = useRef(false);

  // A deep link (?q=…) asks a question on arrival.
  useEffect(() => {
    const q = params.get("q");
    if (q && !started.current) { started.current = true; dock.send(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const items = dock.appMessages.map(messageToItem);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 px-5 pt-5 sm:px-6">
        <Kicker className="mb-2">Consult the record</Kicker>
        <h1 className="ldg-display text-[26px] leading-tight text-ink-text">Ask your brain</h1>
        <p className="mt-1 text-sm text-muted">Answers are grounded in your meetings and connected tools — never invented. Ask below.</p>
        <div className="mt-4 h-px bg-hairline" />
      </header>

      {items.length === 0 ? (
        <div className="mx-auto w-full max-w-3xl px-5 pt-6 sm:px-6">
          <div className="ldg-stagger grid gap-2 sm:grid-cols-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => dock.send(s)}
                className="rounded-xl border border-hairline bg-surface px-4 py-3 text-left text-sm text-ink-text shadow-[var(--shadow-card)] transition-all duration-150 hover:-translate-y-0.5 hover:border-glow/40 hover:shadow-[var(--shadow-float)]"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col">
          <ThreadView items={items} busy={dock.busy} onQuote={dock.onQuote} emptyHint="Ask anything across your company brain…" />
        </div>
      )}
    </div>
  );
}
