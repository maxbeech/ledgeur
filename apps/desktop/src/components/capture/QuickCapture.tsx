// The capture box: type it or say it, and it is kept.
//
// ── The one rule ────────────────────────────────────────────────────────────
// Between a thought arriving and it being on disk there is exactly one action.
// Everything else — deciding whether it is a task, working out which space it
// belongs to, tidying the wording — happens afterwards, to a row that is
// already saved, and none of it can fail in a way that loses the thought.
//
// So: no space picker, no kind toggle, no "add details" step. The box opens
// focused, Enter keeps it, and it closes. A person holding a phone in a
// corridor gets the same two seconds as a person at a keyboard.
//
// The confirmation is deliberately not a blocking one. It appears after the box
// has gone, and updates itself from "Kept" to "Task · Acme" when the model
// finishes — which is the only honest way to show a decision that takes a
// second or two while claiming the capture was instant, because it was.

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, CornerDownLeft, X, Loader2 } from "lucide-react";
import { cn } from "@ledgeur/ui";
import { LevelMeter } from "../recorder/LevelMeter.tsx";
import { ErrorNote } from "../ui.tsx";
import { addCapture } from "../../lib/captures.ts";
import { sortCapture } from "../../lib/routeCapture.ts";
import { startDictation, type DictationHandle } from "../../lib/dictation.ts";
import { setAudioLevel } from "../../lib/audioLevel.ts";
import { announceCapture, closeCapture, useCaptureDock } from "../../lib/captureDock.ts";
import { useDevice } from "../../lib/platform.ts";
import { createLogger } from "../../lib/logger.ts";

const log = createLogger("quick-capture");

type Phase = "typing" | "listening" | "transcribing";

export function QuickCapture() {
  const dock = useCaptureDock();
  const device = useDevice();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("typing");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dictation = useRef<DictationHandle | null>(null);
  /** Set while the box is closing, so a late dictation result cannot reopen it
   *  or land in the next capture. */
  const closed = useRef(false);
  /** Whether any of this capture came from the microphone. Kept so a spoken
   *  capture is stored as one even after it has been edited by hand — the text
   *  is still a transcript, with a transcript's mistakes, and the UI says so. */
  const hasSpoken = useRef(false);

  const stopListening = useCallback(async (keep: boolean): Promise<string> => {
    const handle = dictation.current;
    dictation.current = null;
    setAudioLevel(0);
    if (!handle) return "";
    if (!keep) { await handle.cancel(); return ""; }
    setPhase("transcribing");
    try {
      return await handle.stop();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return "";
    } finally {
      setPhase("typing");
    }
  }, []);

  /** Stop the microphone and put what was said into the box, where it can be
   *  read and corrected before it is kept. A speech model that mis-heard a name
   *  is a normal thing; keeping the mistake silently is not. */
  const finishListening = useCallback(async () => {
    const said = await stopListening(true);
    if (closed.current || !said) return;
    setText((current) => (current ? `${current.trim()} ${said}` : said));
    inputRef.current?.focus();
  }, [stopListening]);

  const listen = useCallback(async () => {
    setError("");
    setPhase("listening");
    try {
      dictation.current = await startDictation({
        onLevel: setAudioLevel,
        onAutoStop: () => { void finishListening(); },
      });
    } catch (e) {
      setPhase("typing");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [finishListening]);

  const keep = useCallback(() => {
    const body = text.trim();
    if (!body) return;
    let saved;
    try {
      saved = addCapture(body, hasSpoken.current ? "spoken" : "typed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    // Closed before anything else happens. The sort runs against the saved row
    // and reports itself through the confirmation, so nobody waits on a model.
    announceCapture(saved.id);
    closed.current = true;
    closeCapture();
    void sortCapture(saved).catch((e) => log.warn("sorting threw", e));
  }, [text]);

  const dismiss = useCallback(() => {
    closed.current = true;
    void stopListening(false);
    closeCapture();
  }, [stopListening]);

  // Opening resets everything: the box is never pre-filled with the last
  // thought, which would be both confusing and a way to keep it twice.
  useEffect(() => {
    if (!dock.open) return;
    closed.current = false;
    hasSpoken.current = false;
    setText("");
    setError("");
    setPhase("typing");
    const focus = setTimeout(() => inputRef.current?.focus(), 10);
    if (dock.mode === "speak") { hasSpoken.current = true; void listen(); }
    return () => clearTimeout(focus);
  }, [dock.open, dock.mode, listen]);

  // Leaving the box open with the microphone on, on a screen nobody is looking
  // at, is the one state this component must never be in.
  useEffect(() => () => { void dictation.current?.cancel(); setAudioLevel(0); }, []);

  if (!dock.open) return null;

  const listening = phase === "listening";
  const transcribing = phase === "transcribing";

  return (
    <div
      className="ldg-fade-in fixed inset-0 z-50 flex items-start justify-center bg-ink-text/30 px-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={dismiss}
      role="dialog"
      aria-modal="true"
      aria-label="Keep a thought"
    >
      <div
        className="ldg-pop-in w-full max-w-lg overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-palette)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <span className="ldg-label">Keep a thought</span>
          <button
            onClick={dismiss}
            className="rounded-md p-1 text-faint transition-colors hover:text-ink-text"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          ref={inputRef}
          name="capture"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter keeps it. Shift+Enter is a new line, because some thoughts
            // are two lines and nobody should have to choose the other box.
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); keep(); }
            else if (e.key === "Escape") { e.preventDefault(); dismiss(); }
          }}
          rows={3}
          placeholder={listening ? "Listening — say it, then press Enter" : "A task, an idea, something worth keeping…"}
          className="ldg-prose max-h-56 min-h-[84px] w-full resize-none bg-transparent px-4 py-3.5 text-base leading-relaxed text-ink-text outline-none placeholder:text-faint"
          aria-label="What to keep"
        />

        {listening && (
          <div className="flex items-center gap-3 border-t border-hairline px-4 py-2">
            <LevelMeter />
            <span className="ml-auto text-xs font-medium text-muted">Listening</span>
          </div>
        )}

        {error && <ErrorNote className="mx-4 mb-3">{error}</ErrorNote>}

        <div className="flex items-center gap-2 border-t border-hairline bg-surface-muted px-3 py-2.5">
          <button
            onClick={() => {
              hasSpoken.current = true;
              if (listening) void finishListening();
              else void listen();
            }}
            disabled={transcribing}
            className={cn(
              "flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors disabled:opacity-60",
              listening ? "bg-danger-soft text-danger" : "bg-surface text-ink-text hover:bg-surface-sunken",
            )}
          >
            {transcribing
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Writing it down</>
              : listening
                ? <><Square className="h-3.5 w-3.5 fill-current" /> Stop</>
                : <><Mic className="h-4 w-4" /> Speak</>}
          </button>

          <span className="ml-auto flex items-center gap-2">
            {!device.phone && (
              <span className="text-2xs text-faint">
                <kbd className="rounded border border-hairline-strong px-1 py-0.5 font-medium">esc</kbd> to close
              </span>
            )}
            <button
              onClick={keep}
              disabled={!text.trim() || transcribing}
              className="flex h-9 items-center gap-2 rounded-lg bg-ink px-3.5 text-sm font-semibold text-on-ink transition-colors hover:bg-ink-soft disabled:opacity-40"
            >
              Keep
              <CornerDownLeft className="h-3.5 w-3.5 opacity-70" />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
