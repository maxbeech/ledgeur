// Asking the on-device model where a thought belongs.
//
// The pure half — the prompt, the parser, and the validator that throws out
// anything the capture does not support — lives in @ledgeur/core (capture/) and
// is unit-tested there. This file is the part that touches the world: it sends
// the prompt, folds the answer into the saved capture, and records an honest
// reason when there was nothing to ask.
//
// ── Sorting is never allowed to fail the capture ────────────────────────────
// Everything here is called *after* the thought is on disk. A model that is
// missing, slow, or talking nonsense leaves the capture exactly where it is: in
// the inbox, as a note, with a line saying why it was not sorted. It never
// throws into the caller's path, because the caller's path is somebody standing
// in a corridor waiting to see that their thought was kept.
//
// ── Never a keyword fallback ────────────────────────────────────────────────
// If no model can answer, nothing is guessed. There is no list of verbs that
// makes something a task: "remember that Priya prefers async reviews" starts
// with one and is not a task, and a Tasks screen with things nobody meant to do
// in it stops being a list anybody trusts.

import {
  buildCaptureMessages, buildMeetingSpaceMessages, parseCaptureVerdict, validateCapture,
  validateMeetingSpace, type CaptureRecord, type MeetingDigest, type SpaceOption,
} from "@ledgeur/core";
import { chatComplete } from "./llm.ts";
import { createLogger } from "./logger.ts";
import { getFolders } from "./folders.ts";
import { markCaptureUnsorted, routeCaptureRecord } from "./captures.ts";

const log = createLogger("route-capture");

/**
 * How long sorting may take before the capture is left in the inbox.
 *
 * Deliberately short. Nobody is waiting for the *sort* — they are already back
 * in their next meeting — but a pass that hangs holds the single shared model
 * mutex, and the thing behind it in the queue is usually somebody's live
 * copilot question, which cannot wait at all.
 */
const ROUTE_TIMEOUT_MS = 25_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out.`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

const spaceOptions = (): SpaceOption[] => getFolders().map((f) => ({ id: f.id, name: f.name }));

/**
 * Sort one saved capture: task or note, and which space.
 *
 * Resolves either way. The capture is already safe; this only decides where it
 * is shown, and being unsorted in the inbox is a perfectly good outcome that
 * the UI presents as such rather than as a failure.
 */
export async function sortCapture(capture: CaptureRecord, signal?: AbortSignal): Promise<void> {
  const spaces = spaceOptions();
  try {
    const raw = await withTimeout(
      chatComplete(buildCaptureMessages(capture.text, spaces), {
        // Low but not zero: at zero this model tends to answer "task" for
        // everything short, which is most captures.
        temperature: 0.1,
        maxTokens: 256,
        signal,
      }),
      ROUTE_TIMEOUT_MS,
      "Sorting the thought",
    );
    const routing = validateCapture(parseCaptureVerdict(raw), { text: capture.text, spaces });
    routeCaptureRecord(capture.id, routing);
    log.info("capture sorted", {
      kind: routing.kind,
      filed: Boolean(routing.spaceId),
      kindConfidence: routing.kindConfidence,
      spaceConfidence: routing.spaceConfidence,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    markCaptureUnsorted(capture.id, message);
    log.info("capture kept but not sorted", { reason: message });
  }
}

/**
 * Which space a finished meeting belongs in.
 *
 * Returns null whenever nothing should change — no spaces to choose from, no
 * model to ask, or a model that was not sure enough. A meeting that stays
 * unfiled is the normal case and is not worth a message to anybody.
 *
 * Never runs against a meeting somebody has already filed by hand: overriding
 * that is the one outcome nobody would forgive, and it is cheaper to check here
 * than to explain afterwards.
 */
export async function chooseMeetingSpace(
  digest: MeetingDigest,
  signal?: AbortSignal,
): Promise<{ spaceId: string; confidence: number; evidence: string } | null> {
  const spaces = spaceOptions();
  if (spaces.length === 0) return null;
  try {
    const raw = await withTimeout(
      chatComplete(buildMeetingSpaceMessages(digest, spaces), {
        temperature: 0.1, maxTokens: 200, signal,
      }),
      ROUTE_TIMEOUT_MS,
      "Filing the meeting",
    );
    const filed = validateMeetingSpace(parseCaptureVerdict(raw), { digest, spaces });
    if (!filed.spaceId) return null;
    return { spaceId: filed.spaceId, confidence: filed.confidence, evidence: filed.evidence };
  } catch (e) {
    // A meeting that could not be filed is a meeting in the library, which is
    // where every meeting was until this feature existed. Not worth surfacing.
    log.info("meeting not filed", { reason: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
