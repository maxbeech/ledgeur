// UtteranceSegmenter — the boundaries the speech model actually sees.
//
// These matter because the recorder used to cut on a wall clock, mid-word, and
// that is a direct cause of both complaints it was meant to answer: a truncated
// word at each edge is guessed rather than lost (bad transcript), and a pass per
// fixed interval pays Whisper's fixed 30-second padding cost far more often than
// speech requires (slow transcript).

import { UtteranceSegmenter } from "../src/audio/segmenter.ts";
import { WHISPER_SAMPLE_RATE } from "../src/audio/pcm.ts";

const RATE = WHISPER_SAMPLE_RATE;

/** Loud, speech-like audio: alternating sign so RMS is well above any gate. */
function speech(seconds: number, amplitude = 0.3): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = i % 2 === 0 ? amplitude : -amplitude;
  return out;
}

function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * RATE));
}

const seconds = (samples: number) => samples / RATE;

export function runSegmenterTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // --- nothing is emitted before there is enough to be worth a model pass ---
  {
    const seg = new UtteranceSegmenter();
    seg.push(speech(1));
    ok("a short burst is not emitted", seg.take() === null);
    ok("pending tracks what is buffered", Math.abs(seg.pendingSeconds - 1) < 0.01, String(seg.pendingSeconds));
  }

  // --- speech that never pauses is held, not chopped on a clock ---
  {
    const seg = new UtteranceSegmenter();
    seg.push(speech(10));
    ok("continuous speech under the ceiling is not cut", seg.take() === null);
  }

  // --- a pause ends an utterance ---
  {
    const seg = new UtteranceSegmenter();
    seg.push(speech(5));
    seg.push(silence(1));
    const out = seg.take();
    ok("a pause after speech emits an utterance", out !== null);
    ok("the utterance is flagged as a real boundary", out?.reason === "pause", out?.reason);
    ok("it starts at zero", out?.startSample === 0, String(out?.startSample));
    // Cut just after the speech ends, plus the configured tail pad — not at the
    // end of the whole silent run.
    const cutSeconds = seconds(out?.endSample ?? 0);
    ok("it cuts shortly after speech stops", cutSeconds > 4.9 && cutSeconds < 5.4, String(cutSeconds));
    // The pause itself is not handed to the model: only the tail pad crosses the
    // cut, and the rest of the silence stays behind to be consumed by the next
    // utterance (where it costs nothing).
    ok("the pause is not transcribed", seg.pendingSeconds > 0.7 && seg.pendingSeconds < 1, String(seg.pendingSeconds));
  }

  // --- a pause too early doesn't trigger a wasteful pass ---
  {
    const seg = new UtteranceSegmenter();
    seg.push(speech(1));
    seg.push(silence(1));
    ok("a pause after too little speech is ignored", seg.take() === null);
  }

  // --- a monologue is still cut, at the ceiling ---
  {
    const seg = new UtteranceSegmenter();
    seg.push(speech(25));
    const out = seg.take();
    ok("an unbroken monologue is cut at the ceiling", out !== null);
    ok("the ceiling cut is flagged as such", out?.reason === "max", out?.reason);
    ok(
      "the ceiling cut is no longer than the maximum",
      seconds(out?.endSample ?? 0) <= 18.01,
      String(seconds(out?.endSample ?? 0)),
    );
  }

  // --- offsets stay on the meeting clock across many utterances ---
  {
    const seg = new UtteranceSegmenter();
    const emitted: { start: number; end: number }[] = [];
    for (let i = 0; i < 3; i++) {
      seg.push(speech(4));
      seg.push(silence(1));
      const out = seg.take();
      if (out) emitted.push({ start: out.startSample, end: out.endSample });
    }
    ok("each pause produced an utterance", emitted.length === 3, String(emitted.length));
    ok(
      "utterances are contiguous on the clock",
      emitted.every((e, i) => i === 0 || e.start === emitted[i - 1].end),
      JSON.stringify(emitted),
    );
    ok("the clock advances monotonically", emitted.every((e) => e.end > e.start));
    // Three ~5s stretches: the third utterance must start around 10s in, not at
    // zero. Restarting each slice's timestamps at zero is what used to make
    // speaker labels impossible to line up.
    ok("later utterances carry a real offset", seconds(emitted[2].start) > 9, String(seconds(emitted[2].start)));
  }

  // --- flush gives back the tail, so the end of a meeting isn't dropped ---
  {
    const seg = new UtteranceSegmenter();
    seg.push(speech(2));
    ok("a short tail is not emitted by take", seg.take() === null);
    const out = seg.flush();
    ok("flush returns the short tail", out !== null);
    ok("flush is flagged as such", out?.reason === "flush", out?.reason);
    ok("flush empties the buffer", seg.pendingSamples === 0, String(seg.pendingSamples));
    ok("a second flush returns nothing", seg.flush() === null);
  }

  // --- a backlog collapses into one pass rather than many ---
  //
  // Only the pause at the END of the buffer is a cut point. That is deliberate:
  // when transcription has fallen behind, several sentences are already
  // buffered, and Whisper pads every input to the same 30-second window — so
  // transcribing them as one pass costs one pass, and as three costs three. The
  // way to catch up is fewer passes, not more.
  {
    const seg = new UtteranceSegmenter();
    for (let i = 0; i < 3; i++) { seg.push(speech(4)); seg.push(silence(1)); }
    const out = seg.take();
    ok("a backlog is emitted", out !== null);
    ok(
      "a backlog is caught up in one pass, not one per sentence",
      out !== null && seconds(out.endSample) > 13,
      String(seconds(out?.endSample ?? 0)),
    );
    ok("the backlog is then empty", seg.take() === null);
  }

  // --- an over-ceiling backlog is still bounded, and stays in order ---
  {
    const seg = new UtteranceSegmenter();
    for (let i = 0; i < 8; i++) { seg.push(speech(4)); seg.push(silence(1)); }
    const first = seg.take();
    const second = seg.take();
    ok("an over-ceiling backlog yields more than one utterance", first !== null && second !== null);
    ok(
      "backlogged utterances stay contiguous",
      (first?.endSample ?? -1) === (second?.startSample ?? -2),
      `${first?.endSample} → ${second?.startSample}`,
    );
    ok("each stays under the ceiling", seconds((first?.endSample ?? 0)) <= 18.01);
  }

  // --- the emitted buffer is detached from the retained remainder ---
  {
    const seg = new UtteranceSegmenter();
    seg.push(speech(5));
    seg.push(silence(1));
    const out = seg.take();
    seg.push(speech(2)); // more arrives after the cut
    ok("an utterance was emitted", out !== null);
    ok(
      "the emitted buffer is exactly its own length",
      out !== null && out.audio.length === out.audio.buffer.byteLength / 4,
      "an emitted chunk must be a copy — a view would retain the whole capture buffer, "
        + "and it is transferred to a worker, which would detach the remainder with it",
    );
  }

  // --- options are honoured ---
  {
    const seg = new UtteranceSegmenter({ minSeconds: 1, maxSeconds: 4 });
    seg.push(speech(6));
    const out = seg.take();
    ok("a custom ceiling is respected", out !== null && seconds(out.endSample) <= 4.01, String(seconds(out?.endSample ?? 0)));
  }
}
