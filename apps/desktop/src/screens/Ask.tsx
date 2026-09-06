// Ask — question the whole record. Grounded in the org's memory (semantic
// search when signed in + model up), connected tools, and the real local
// meetings. The conversation and its input live in the app shell (the
// ever-present composer); this screen just renders the shared thread.
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { LogoMark } from "../components/ui.tsx";
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

  if (items.length === 0) {
    return (
      <div className="ldg-rise mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-strong">
          <LogoMark className="h-6 w-6" />
        </span>
        <h1 className="ldg-display text-2xl text-ink-text">Ask anything</h1>
        <p className="mt-2 max-w-md text-base text-muted">
          Answers come from your meetings and connected tools, and say where they came from. Nothing is invented.
        </p>
        <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
          {STARTERS.map((s) => (
            <button
              key={s}
              onClick={() => dock.send(s)}
              className="rounded-xl bg-surface-muted px-4 py-3 text-left text-sm font-medium text-ink-text transition-colors hover:bg-surface-sunken"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl min-h-0 flex-col">
      <ThreadView items={items} busy={dock.busy} onQuote={dock.onQuote} emptyHint="Ask anything across your meetings and tools." />
    </div>
  );
}
