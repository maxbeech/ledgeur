// Drafting the follow-up email for a finished meeting.
//
// On-device model when there is one, the deterministic local assembler when
// there isn't — the same two-path shape as the notes themselves, and for the
// same reason: an offline machine should still get something sendable, and the
// difference has to be visible rather than guessed at (`source` on the result).

import {
  buildFollowUpPrompt, localFollowUp, parseFollowUp, type FollowUpEmail, type MeetingNotes,
} from "@ledgeur/core";
import { chatComplete } from "./llm.ts";
import { getSettings } from "./settings.ts";
import type { LocalMeeting } from "./meetingsStore.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("follow-up");

/** Bounded like note generation: an on-device model has no cancellation, and a
 *  draft that never arrives is worse than a plainer one that does. */
const TIMEOUT_MS = 45_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Draft timed out.")), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

const notesOf = (m: LocalMeeting): MeetingNotes => ({
  summary: m.summary, decisions: m.decisions, questions: m.questions,
  actionItems: m.actionItems, wordCount: m.wordCount,
});

/**
 * Draft the follow-up. Always resolves — a model failure falls back to the
 * locally assembled recap rather than leaving the user with nothing.
 */
export async function draftFollowUp(meeting: LocalMeeting): Promise<FollowUpEmail> {
  const { senderName, followUpTone } = getSettings();
  const options = { senderName: senderName.trim() || undefined, tone: followUpTone };
  const notes = notesOf(meeting);
  const transcript = meeting.segments.map((s) => `${s.speakerLabel}: ${s.text}`).join("\n");

  try {
    const reply = await withTimeout(
      chatComplete(buildFollowUpPrompt(meeting.title, notes, transcript, options), {
        temperature: 0.4, maxTokens: 700,
      }),
      TIMEOUT_MS,
    );
    const draft = parseFollowUp(reply, meeting.title);
    // A model that returned nothing usable must not produce an empty email
    // that looks like the feature working.
    if (draft.body.trim().length < 20) throw new Error("Model returned an empty draft.");
    return draft;
  } catch (e) {
    log.warn("model draft unavailable, assembling locally", e);
    return localFollowUp(meeting.title, notes, options);
  }
}
