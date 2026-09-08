// Who was in this meeting — and which of those names Ledgeur worked out itself.
//
// The rule the whole panel exists to enforce: a name the app decided must never
// look like a name a person typed. A guessed name carries a mark, the belief
// behind it, and the line it came from, and is one click to accept, change or
// reject. A typed name carries none of that, because questioning it would be
// rude and pointless.
//
// Correcting a guess is not cosmetic. If the guess was confident enough to have
// taught the voice store, the correction un-teaches it (see renameSpeaker.ts) —
// otherwise the same wrong name arrives, more confidently, in every later
// meeting.

import { useEffect, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { Button, ErrorNote, Label, SpeakerChip } from "../ui.tsx";
import {
  confirmSpeakerGuess, rejectSpeakerGuess, renameSpeakerInMeeting,
} from "../../lib/renameSpeaker.ts";
import { inferSpeakerNames } from "../../lib/speakerNames.ts";
import { applyNameProposals } from "@ledgeur/core";
import type { LocalMeeting, LocalSpeaker } from "../../lib/meetingsStore.ts";

export interface SpeakerPanelProps {
  meeting: LocalMeeting;
  /** Lines per label, counted from the transcript this screen is showing. */
  counts: Map<string, number>;
  /** Persist and re-render. A cloud copy passes `readOnly` instead. */
  onChange: (next: LocalMeeting) => Promise<void> | void;
  /** Which voice is being renamed. Owned by the screen so "rename everywhere",
   *  chosen from a line down in the transcript, opens the field up here rather
   *  than throwing a browser prompt at the user. */
  renaming: string | null;
  onRenamingChange: (label: string | null) => void;
  /** A meeting recorded on another device belongs to that device. */
  readOnly?: boolean;
}

export function SpeakerPanel({ meeting, counts, onChange, renaming, onRenamingChange, readOnly }: SpeakerPanelProps) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Opening the field from a transcript line has to start it empty for a
  // placeholder and pre-filled for a real name, exactly as clicking the chip up
  // here does — otherwise the same action behaves differently in two places.
  useEffect(() => {
    if (renaming) setDraft(/^speaker\s*\d+$/i.test(renaming) ? "" : renaming);
  }, [renaming]);

  const labels = [...counts.keys()];
  if (labels.length === 0) return null;

  const speakerFor = (label: string): LocalSpeaker | undefined =>
    meeting.speakers?.find((s) => s.label === label);
  const isGuess = (label: string) => speakerFor(label)?.nameSource === "inferred";
  const guesses = labels.filter(isGuess);

  async function commitRename(previous: string) {
    const name = draft.trim();
    onRenamingChange(null);
    if (!name || name === previous) return;
    setBusy(true);
    try {
      const { meeting: updated, rememberError } = await renameSpeakerInMeeting(meeting, previous, name);
      setNote(rememberError);
      await onChange(updated);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(label: string) {
    setBusy(true);
    try {
      const { meeting: updated, rememberError } = await confirmSpeakerGuess(meeting, label);
      setNote(rememberError);
      await onChange(updated);
    } finally {
      setBusy(false);
    }
  }

  async function reject(label: string) {
    setBusy(true);
    try {
      await onChange(await rejectSpeakerGuess(meeting, label));
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ask again, by hand.
   *
   * For meetings recorded before this existed, and for the ones where the model
   * was not downloaded yet when they finished. A failure is shown as itself —
   * "no model" and "nobody said a name" are different answers and are never
   * collapsed into one.
   */
  async function suggest() {
    setBusy(true);
    setNote("");
    try {
      const proposals = await inferSpeakerNames(meeting.segments);
      if (proposals.length === 0) {
        setNote("Nothing in this transcript says who anybody is, so no names were suggested. Click a speaker to name them yourself.");
        return;
      }
      const out = applyNameProposals(meeting.segments, meeting.speakers ?? [], proposals);
      await onChange({ ...meeting, segments: out.segments, speakers: out.speakers });
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const unnamed = labels.filter((l) => /^speaker\s*\d+$/i.test(l));

  return (
    <div className="mb-5 border-b border-hairline pb-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Label>Speakers</Label>
        {labels.map((label) => (
          <span key={label} className="flex items-baseline gap-1.5">
            {renaming === label ? (
              <form
                onSubmit={(e) => { e.preventDefault(); void commitRename(label); }}
                className="flex items-center gap-1.5"
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") onRenamingChange(null); }}
                  aria-label={`Name for ${label}`}
                  placeholder="Who is this?"
                  className="h-8 w-40 rounded-full border border-hairline-strong bg-surface px-3 text-sm outline-none focus:border-brand"
                />
                <Button size="sm" type="submit">Save</Button>
              </form>
            ) : (
              <button
                type="button"
                disabled={readOnly || busy}
                onClick={() => { onRenamingChange(label); setNote(""); }}
                title={isGuess(label)
                  ? "Ledgeur worked this name out — click to change it"
                  : "Say who this is — Ledgeur will recognise them next time"}
                className="cursor-pointer disabled:cursor-default"
              >
                <SpeakerChip label={label} guessed={isGuess(label)} confidence={speakerFor(label)?.confidence ?? null} />
              </button>
            )}
            <span className="ldg-num text-2xs text-faint">×{counts.get(label)}</span>
          </span>
        ))}
      </div>

      {/* One row per guess, with the words that produced it. A guess the reader
          cannot check is a guess they have to take on trust, which is the thing
          this feature must never ask for. */}
      {guesses.length > 0 && (
        <ul className="mt-3 space-y-2">
          {guesses.map((label) => {
            const s = speakerFor(label);
            return (
              <li key={label} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-xs">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand" />
                <span className="text-muted">
                  Guessed <span className="font-semibold text-ink-text">{label}</span>
                  {s?.confidence != null && <span className="ldg-num text-faint"> · {Math.round(s.confidence * 100)}% sure</span>}
                  {s?.nameEvidence && <> — heard <span className="italic text-ink-text">“{s.nameEvidence}”</span></>}
                </span>
                {!readOnly && (
                  <span className="ml-auto flex items-center gap-1.5">
                    <Button size="sm" tone="soft" disabled={busy} onClick={() => void confirm(label)}>
                      <Check className="h-3.5 w-3.5" /> That's right
                    </Button>
                    <Button size="sm" tone="ghost" disabled={busy} onClick={() => { onRenamingChange(label); }}>
                      Change
                    </Button>
                    <Button size="sm" tone="ghost" disabled={busy} onClick={() => void reject(label)} title="Put this voice back to a number">
                      <X className="h-3.5 w-3.5" /> Not them
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="text-xs text-faint">
          Click a name to say who it is. The voice print is saved on this device, and every
          later meeting recognises them without being asked again.
        </p>
        {!readOnly && unnamed.length > 0 && (
          <Button size="sm" tone="ghost" disabled={busy} onClick={() => void suggest()} className="ml-auto">
            <Sparkles className="h-3.5 w-3.5" /> {busy ? "Reading the transcript…" : "Suggest names"}
          </Button>
        )}
      </div>

      {note && <ErrorNote className="mt-3">{note}</ErrorNote>}
    </div>
  );
}
