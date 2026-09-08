// Laying speaker turns over a transcript that already exists.
//
// The native path produces these two halves separately and at different times:
// the transcript arrives utterance by utterance while the meeting is running,
// and the speaker turns arrive in one pass when it stops, from a model that has
// finally seen the whole recording. This is where they meet.
//
// It is a separate step, rather than something the speaker pass returns
// finished, because the transcript is not the speaker pass's to rewrite. The
// pass used to re-transcribe the entire meeting so it could hand back both
// halves at once — minutes of work on every Stop, over audio that had already
// been transcribed once, to end up with much the same words.

/** A stretch of the meeting attributed to one person. */
export interface AttributedTurn {
  startMs: number;
  endMs: number;
  /** An enrolled person's name, or "Speaker N". */
  label: string;
  /** Set only when the label came from matching an enrolled voice. */
  confidence?: number | null;
}

/** The shape this needs from a transcript line — anything with a time span. */
export interface TimedLine {
  startMs: number;
  endMs: number;
}

/**
 * The turn that overlaps `[startMs, endMs)` for longest, or null when none does.
 *
 * Longest overlap rather than, say, whoever was talking at the start: a line
 * that begins in the tail of somebody's sentence and then runs for ten seconds
 * of the next person belongs to the next person.
 */
export function dominantTurn<T extends AttributedTurn>(
  startMs: number,
  endMs: number,
  turns: readonly T[],
): T | null {
  let best: T | null = null;
  let bestOverlap = 0;
  for (const turn of turns) {
    const overlap = Math.min(endMs, turn.endMs) - Math.max(startMs, turn.startMs);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = turn;
    }
  }
  return best;
}

/**
 * Attribute each transcript line to a speaker, from the turns of a full pass.
 *
 * A line that no turn overlaps keeps whatever it already had — which is the
 * live guess if there was one, and nothing if there wasn't. Overwriting it with
 * a speaker picked from nowhere would be worse than leaving it unattributed:
 * the reader cannot tell a guess from a fact once it is on the screen.
 */
export function attributeSpeakers<T extends TimedLine & { speakerLabel: string; speakerConfidence?: number | null }>(
  lines: readonly T[],
  turns: readonly AttributedTurn[],
): T[] {
  if (turns.length === 0) return [...lines];
  return lines.map((line) => {
    const turn = dominantTurn(line.startMs, line.endMs, turns);
    if (!turn) return line;
    return { ...line, speakerLabel: turn.label, speakerConfidence: turn.confidence ?? null };
  });
}

/**
 * Where one retained stretch of audio sits on each of the two clocks.
 *
 * The recorder does not keep every sample it captures: an utterance the model
 * scored as silence is transcribed as nothing and never appended to the audio
 * held back for the speaker pass. So the buffer that pass sees is the meeting
 * with its quiet parts cut out, and a timestamp means something different in
 * each — by the length of every silence so far, which on a real meeting is
 * minutes.
 *
 * Nothing noticed while the speaker pass also re-transcribed that same buffer:
 * both halves came back on the compacted clock and agreed with each other, and
 * the saved transcript just had timestamps that quietly disagreed with the
 * recording. Now that the transcript is the live one, the two clocks have to be
 * reconciled explicitly, which is what these spans are for.
 */
export interface AudioSpan {
  /** Start of this stretch within the retained audio. */
  atMs: number;
  /** Its length. */
  durationMs: number;
  /** Where the same stretch starts on the meeting clock. */
  meetingMs: number;
}

/**
 * Move speaker turns from the retained-audio clock onto the meeting clock.
 *
 * A turn that straddles a cut is split, because the two halves genuinely
 * happened at different times — running it through as one span would attribute
 * whatever was said during the silence in between.
 */
export function turnsToMeetingClock(
  turns: readonly AttributedTurn[],
  spans: readonly AudioSpan[],
): AttributedTurn[] {
  if (spans.length === 0) return [...turns];
  const out: AttributedTurn[] = [];
  for (const turn of turns) {
    for (const span of spans) {
      const start = Math.max(turn.startMs, span.atMs);
      const end = Math.min(turn.endMs, span.atMs + span.durationMs);
      if (end <= start) continue;
      const shift = span.meetingMs - span.atMs;
      out.push({ ...turn, startMs: start + shift, endMs: end + shift });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/** The distinct people in a set of turns, with how long each of them spoke. */
export function speakersFromTurns(
  turns: readonly AttributedTurn[],
): { label: string; speakingSeconds: number; confidence: number | null }[] {
  const byLabel = new Map<string, { seconds: number; confidence: number | null }>();
  for (const turn of turns) {
    const seconds = Math.max(0, turn.endMs - turn.startMs) / 1000;
    const existing = byLabel.get(turn.label);
    if (existing) {
      existing.seconds += seconds;
      // Keep the most confident sighting of this person, not the last one.
      if (turn.confidence != null && (existing.confidence == null || turn.confidence > existing.confidence)) {
        existing.confidence = turn.confidence;
      }
    } else {
      byLabel.set(turn.label, { seconds, confidence: turn.confidence ?? null });
    }
  }
  return [...byLabel.entries()]
    .map(([label, v]) => ({ label, speakingSeconds: v.seconds, confidence: v.confidence }))
    .sort((a, b) => b.speakingSeconds - a.speakingSeconds);
}

/**
 * The inverse of {@link turnsToMeetingClock}: where a stretch of the meeting
 * lives inside the retained audio.
 *
 * Needed to cut a voice sample out of the buffer, because the two clocks drift
 * apart by the length of every silence the gate dropped. A range that straddles
 * a cut comes back as several pieces, in order — joining them is correct, since
 * what was cut out was silence.
 *
 * With no spans the buffer *is* the meeting and the range passes through, which
 * is what the webview path (no retained audio, no spans) would want if it ever
 * grew one.
 */
export function meetingRangeToAudio(
  spans: readonly AudioSpan[],
  startMs: number,
  endMs: number,
): { atMs: number; durationMs: number }[] {
  if (endMs <= startMs) return [];
  if (spans.length === 0) return [{ atMs: startMs, durationMs: endMs - startMs }];
  const out: { atMs: number; durationMs: number }[] = [];
  for (const span of [...spans].sort((a, b) => a.meetingMs - b.meetingMs)) {
    const from = Math.max(startMs, span.meetingMs);
    const to = Math.min(endMs, span.meetingMs + span.durationMs);
    if (to <= from) continue;
    const shift = span.atMs - span.meetingMs;
    out.push({ atMs: from + shift, durationMs: to - from });
  }
  return out;
}
