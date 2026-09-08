// Laying the speaker pass's turns over a transcript that already exists — the
// step that replaced re-transcribing every meeting from scratch on Stop.
import {
  dominantTurn, attributeSpeakers, speakersFromTurns, turnsToMeetingClock,
  type AttributedTurn, type AudioSpan,
} from "../src/diarize/attribute.ts";

type Line = { startMs: number; endMs: number; text: string; speakerLabel: string; speakerConfidence: number | null };

const line = (startMs: number, endMs: number, speakerLabel = ""): Line =>
  ({ startMs, endMs, text: "x", speakerLabel, speakerConfidence: null });

const turns: AttributedTurn[] = [
  { startMs: 0, endMs: 5_000, label: "Speaker 1", confidence: null },
  { startMs: 5_000, endMs: 12_000, label: "Priya", confidence: 0.82 },
];

export function runAttributeTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- dominantTurn ----------
  ok("a line inside one turn takes that turn", dominantTurn(1_000, 2_000, turns)?.label === "Speaker 1");
  ok(
    "a line spanning two turns takes the one it spends longest in",
    // 1 s in the first turn, 4 s in the second.
    dominantTurn(4_000, 9_000, turns)?.label === "Priya",
  );
  ok("a line past the end of every turn takes none", dominantTurn(20_000, 21_000, turns) === null);
  ok("a zero-length overlap does not count", dominantTurn(12_000, 15_000, turns) === null);
  ok("no turns at all is not a crash", dominantTurn(0, 1_000, []) === null);

  // ---------- attributeSpeakers ----------
  const attributed = attributeSpeakers([line(1_000, 2_000), line(6_000, 9_000)], turns);
  ok("each line gets its speaker", attributed[0].speakerLabel === "Speaker 1" && attributed[1].speakerLabel === "Priya");
  ok("an identified voice keeps its confidence", attributed[1].speakerConfidence === 0.82);
  ok("an anonymous speaker carries no percentage", attributed[0].speakerConfidence === null);
  ok("the text is left alone", attributed[0].text === "x");

  // A line no turn covers must keep whatever it already had, rather than being
  // handed a speaker picked from nowhere — the reader cannot tell a guess from
  // a fact once it is on screen.
  const outside = attributeSpeakers([line(30_000, 31_000, "Speaker 2")], turns);
  ok("a line outside every turn keeps its existing label", outside[0].speakerLabel === "Speaker 2");
  const unknown = attributeSpeakers([line(30_000, 31_000)], turns);
  ok("an unattributed line outside every turn stays unattributed", unknown[0].speakerLabel === "");

  // No turns at all (the speaker pass failed, or found nothing) must leave the
  // live transcript exactly as it was, not blank it.
  const nothing = attributeSpeakers([line(0, 1_000, "Speaker 1")], []);
  ok("no turns leaves the transcript untouched", nothing[0].speakerLabel === "Speaker 1");

  ok("the input is not mutated", (() => {
    const src = [line(1_000, 2_000)];
    attributeSpeakers(src, turns);
    return src[0].speakerLabel === "";
  })());

  // ---------- turnsToMeetingClock ----------
  // Two retained stretches with ten seconds of skipped silence between them:
  // 0–5 s of audio is 0–5 s of meeting, and 5–10 s of audio is 15–20 s of it.
  const spans: AudioSpan[] = [
    { atMs: 0, durationMs: 5_000, meetingMs: 0 },
    { atMs: 5_000, durationMs: 5_000, meetingMs: 15_000 },
  ];
  const moved = turnsToMeetingClock([{ startMs: 6_000, endMs: 8_000, label: "Priya", confidence: null }], spans);
  ok("a turn after a cut is moved onto the meeting clock", moved.length === 1
    && moved[0].startMs === 16_000 && moved[0].endMs === 18_000);
  ok("the label survives the move", moved[0].label === "Priya");

  const before = turnsToMeetingClock([{ startMs: 1_000, endMs: 2_000, label: "A", confidence: null }], spans);
  ok("a turn before any cut is unchanged", before[0].startMs === 1_000 && before[0].endMs === 2_000);

  // A turn straddling the cut becomes two, because the halves really did happen
  // at different times — carrying it across as one would attribute the silence.
  const split = turnsToMeetingClock([{ startMs: 4_000, endMs: 6_000, label: "A", confidence: null }], spans);
  ok("a turn straddling a cut is split", split.length === 2);
  ok("the first half stays put", split[0].startMs === 4_000 && split[0].endMs === 5_000);
  ok("the second half jumps the gap", split[1].startMs === 15_000 && split[1].endMs === 16_000);

  ok("the result is in time order", (() => {
    const many = turnsToMeetingClock([
      { startMs: 6_000, endMs: 7_000, label: "B", confidence: null },
      { startMs: 1_000, endMs: 2_000, label: "A", confidence: null },
    ], spans);
    return many[0].label === "A" && many[1].label === "B";
  })());

  ok("a turn outside every span is dropped rather than misplaced", (() => {
    return turnsToMeetingClock([{ startMs: 50_000, endMs: 51_000, label: "A", confidence: null }], spans).length === 0;
  })());
  ok("no spans leaves the turns alone", (() => {
    const t: AttributedTurn[] = [{ startMs: 1, endMs: 2, label: "A", confidence: null }];
    return turnsToMeetingClock(t, [])[0].startMs === 1;
  })());

  // The case that made this necessary end to end: nothing skipped, so the two
  // clocks are the same and the turns must come through untouched.
  ok("a meeting with no skipped audio is a no-op", (() => {
    const contiguous: AudioSpan[] = [
      { atMs: 0, durationMs: 5_000, meetingMs: 0 },
      { atMs: 5_000, durationMs: 5_000, meetingMs: 5_000 },
    ];
    const t = turnsToMeetingClock([{ startMs: 2_000, endMs: 8_000, label: "A", confidence: null }], contiguous);
    // Split at the span boundary, but adjacent and in the same place.
    return t[0].startMs === 2_000 && t[t.length - 1].endMs === 8_000;
  })());

  // ---------- speakersFromTurns ----------
  const people = speakersFromTurns([
    { startMs: 0, endMs: 5_000, label: "Speaker 1", confidence: null },
    { startMs: 5_000, endMs: 12_000, label: "Priya", confidence: 0.82 },
    { startMs: 12_000, endMs: 14_000, label: "Priya", confidence: 0.61 },
  ]);
  ok("one entry per person, not per turn", people.length === 2);
  ok("the person who spoke most comes first", people[0].label === "Priya");
  ok("speaking time is summed across turns", people[0].speakingSeconds === 9);
  ok("the most confident sighting wins, not the last", people[0].confidence === 0.82);
  ok("an anonymous speaker has no confidence", people[1].confidence === null);
  ok("no turns means no speakers", speakersFromTurns([]).length === 0);
}
