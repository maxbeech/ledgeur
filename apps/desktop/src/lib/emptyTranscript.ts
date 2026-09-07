/**
 * When to tell someone that audible audio is producing no words, and when to
 * take it back.
 *
 * This lives apart from `useRecorder` because it is a rule rather than a piece
 * of recording machinery, and because the recorder itself cannot be imported
 * under plain Node. The rule is not "the model has failed" — it is "several
 * audible slices in a row came back with nothing in them", which is how
 * "recorded fine, transcript came out empty" used to happen silently.
 *
 * The retraction matters as much as the warning. On a device with no WebGPU the
 * transcriber runs well behind the recording, so the slices it works through
 * first can genuinely be the silence before anyone speaks. Warning and then
 * never retracting leaves the notice on screen contradicting the live
 * "transcribing 46s behind" line directly above it, which is what the iOS
 * simulator showed.
 */

/** Audible-but-empty slices in a row before it is worth saying something. */
export const EMPTY_STREAK_LIMIT = 3;

export interface EmptyTranscriptState {
  /** Consecutive audible slices that transcribed to nothing. */
  streak: number;
  /** Whether the warning is currently on screen. */
  warned: boolean;
}

export const emptyTranscriptInitial = (): EmptyTranscriptState => ({ streak: 0, warned: false });

export const EMPTY_TRANSCRIPT_WARNING =
  "Audio is being picked up, but the speech model isn't returning any text. The recording is continuing — if the transcript is still empty at the end, try again or restart the app.";

/**
 * A slice that passed the silence gate transcribed to nothing.
 * `show` is true only on the transition that first crosses the limit, so the
 * notice is not re-patched on every subsequent empty slice.
 */
export function onEmptySlice(state: EmptyTranscriptState): { state: EmptyTranscriptState; show: boolean } {
  const streak = state.streak + 1;
  const show = streak >= EMPTY_STREAK_LIMIT && !state.warned;
  return { state: { streak, warned: state.warned || show }, show };
}

/**
 * A slice came back with words. `retract` is true only when a warning is
 * actually on screen, so this never clears an unrelated recording error.
 */
export function onTranscribedSlice(state: EmptyTranscriptState): { state: EmptyTranscriptState; retract: boolean } {
  return { state: { streak: 0, warned: false }, retract: state.warned };
}
