// When the recorder says "audio is coming in but no words are coming back",
// and — the part that was missing — when it takes that back.
//
// The iOS simulator has no WebGPU, so the transcriber ran ~50s behind the
// recording and worked through the silence before anyone spoke first. Three
// empty slices in a row raised the warning, and nothing ever cleared it: the
// peach "the speech model isn't returning any text" notice sat on screen
// directly under the grey "Transcribing 46s behind" line, each contradicting
// the other, for the rest of the meeting.
import {
  EMPTY_STREAK_LIMIT, EMPTY_TRANSCRIPT_WARNING, emptyTranscriptInitial, onEmptySlice, onTranscribedSlice,
} from "../src/lib/emptyTranscript.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;

/** Feed n empty slices in a row, returning the state and how often it asked to warn. */
function emptyRun(n: number, from = emptyTranscriptInitial()) {
  let state = from, shown = 0;
  for (let i = 0; i < n; i++) {
    const r = onEmptySlice(state);
    state = r.state;
    if (r.show) shown++;
  }
  return { state, shown };
}

export function runEmptyTranscriptTests(ok: Ok): void {
  ok("nothing is wrong at the start", !emptyTranscriptInitial().warned && emptyTranscriptInitial().streak === 0);

  // ── raising it ────────────────────────────────────────────────────────────
  const short = emptyRun(EMPTY_STREAK_LIMIT - 1);
  ok("a couple of empty slices say nothing", short.shown === 0, `shown ${short.shown}`);
  ok("but they are counted", short.state.streak === EMPTY_STREAK_LIMIT - 1, `${short.state.streak}`);

  const atLimit = emptyRun(EMPTY_STREAK_LIMIT);
  ok("the warning is raised on the third in a row", atLimit.shown === 1, `shown ${atLimit.shown}`);
  ok("and the state records that it is showing", atLimit.state.warned);

  const wellPast = emptyRun(EMPTY_STREAK_LIMIT + 6);
  ok("it is raised once, not on every slice after", wellPast.shown === 1, `shown ${wellPast.shown}`);

  // ── retracting it ─────────────────────────────────────────────────────────
  const recovered = onTranscribedSlice(atLimit.state);
  ok("words coming back retract the warning", recovered.retract);
  ok("the streak resets with them", recovered.state.streak === 0);
  ok("and it is no longer marked as showing", !recovered.state.warned);

  const quiet = onTranscribedSlice(short.state);
  ok("a slice with words retracts nothing when nothing was shown", !quiet.retract);
  ok("it still resets the streak", quiet.state.streak === 0);

  const never = onTranscribedSlice(emptyTranscriptInitial());
  ok("nor at the very start of a recording", !never.retract);

  // The whole point: silence, then speech, must end up clean — this is the iOS
  // sequence that left the two contradicting notices on screen.
  const afterSilence = emptyRun(EMPTY_STREAK_LIMIT + 2);
  const thenSpeech = onTranscribedSlice(afterSilence.state);
  ok("silence then speech leaves no warning behind", thenSpeech.retract && !thenSpeech.state.warned);

  // ...and it can be raised again if the model really does stop returning text.
  const relapse = emptyRun(EMPTY_STREAK_LIMIT, thenSpeech.state);
  ok("a genuine second failure warns again", relapse.shown === 1, `shown ${relapse.shown}`);

  ok("the warning says the recording is continuing", /recording is continuing/.test(EMPTY_TRANSCRIPT_WARNING));
}
