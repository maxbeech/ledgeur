// Proactive coaching — the brain whispers things you could say next, grounded
// in the live transcript via the on-device model. Refresh on demand or every
// 60s with Auto. Explicit unavailable state when the model is off.
import { useEffect, useRef, useState } from "react";
import { Lightbulb, RefreshCw, AlertCircle } from "lucide-react";
import { Button, Toggle, Kicker } from "../ui.tsx";
import { suggestNext } from "../../lib/suggestions.ts";

const AUTO_MS = 60_000;

export function SuggestPanel({ getTranscript }: { getTranscript: () => string }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(false);
  const inFlight = useRef(false);

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      setSuggestions(await suggestNext(getTranscript()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!auto) return;
    void refresh();
    const id = setInterval(() => void refresh(), AUTO_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <Kicker>You could say</Kicker>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-faint">Auto</span>
          <Toggle on={auto} onChange={setAuto} />
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={busy} aria-label="Refresh suggestions">
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 pb-4">
        {busy && suggestions.length === 0 && (
          <div className="space-y-1.5 pt-2">
            <div className="pn-shimmer h-px w-32" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-glow-strong">Reading the room…</span>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-hairline bg-surface-muted/50 px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> {error}
          </div>
        )}
        {!busy && !error && suggestions.length === 0 && (
          <p className="pt-2 text-[13px] leading-relaxed text-muted">
            Tap refresh and the on-device model will suggest a question to ask, a decision to push for, or a commitment to capture — based on what's actually being said.
          </p>
        )}
        {suggestions.map((s, i) => (
          <blockquote
            key={`${i}-${s.slice(0, 24)}`}
            className="pn-rise rounded-xl border border-glow/25 bg-glow-soft/40 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink-text"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <Lightbulb className="mb-1 h-3.5 w-3.5 text-glow-strong" />
            <p className="pn-prose">“{s}”</p>
          </blockquote>
        ))}
      </div>
    </div>
  );
}
