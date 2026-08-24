// Assembling diarization from model output — including the live path, where the
// meeting arrives twenty seconds at a time.
import {
  assembleDiarization, concatSlices, offsetSlice, unattributed,
  type AnalysedSlice,
} from "../src/diarize/assemble.ts";
import type { AsrChunk, VoiceProfile } from "../src/diarize/types.ts";

const chunks: AsrChunk[] = [
  { text: "Good morning everyone", start: 0, end: 3 },
  { text: "Morning, shall we start", start: 6, end: 9 },
  { text: "Yes let us begin", start: 26, end: 29 },
];

const slice = (turns: AnalysedSlice["turns"], embeddings: number[][], indices: number[]): AnalysedSlice =>
  ({ turns, embeddings, embeddedIndices: indices });

export function runAssembleTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- offsetting ----------
  const shifted = offsetSlice(
    slice([{ start: 1, end: 4, speaker: 0, confidence: 0.9 }], [[1, 0]], [0]),
    20,
  );
  ok("a slice is moved onto the meeting clock", shifted.turns[0].start === 21 && shifted.turns[0].end === 24);
  ok("a zero offset is a no-op", (() => {
    const s = slice([{ start: 1, end: 2, speaker: 0, confidence: 1 }], [[1, 0]], [0]);
    return offsetSlice(s, 0) === s;
  })());
  ok("offsetting leaves the embeddings alone", shifted.embeddings.length === 1 && shifted.embeddings[0][0] === 1);

  // ---------- concatenation ----------
  // The hard part: embeddedIndices point into each slice's own turn list, so
  // concatenating has to renumber them or the wrong turns get the wrong voices.
  const joined = concatSlices([
    slice(
      [{ start: 0, end: 3, speaker: 0, confidence: 0.9 }, { start: 3, end: 5, speaker: 1, confidence: 0.9 }],
      [[1, 0, 0]], [0],
    ),
    slice(
      [{ start: 20, end: 24, speaker: 0, confidence: 0.9 }],
      [[0, 1, 0]], [0],
    ),
  ]);
  ok("concatenation keeps every turn", joined.turns.length === 3, `${joined.turns.length}`);
  ok("concatenation keeps every embedding", joined.embeddings.length === 2);
  ok("the second slice's indices are renumbered", joined.embeddedIndices.join() === "0,2", joined.embeddedIndices.join());
  ok("each embedding still points at its own turn",
    joined.turns[joined.embeddedIndices[1]].start === 20,
    JSON.stringify(joined.turns[joined.embeddedIndices[1]]));
  ok("concatenating nothing yields nothing", concatSlices([]).turns.length === 0);
  ok("an empty slice does not shift the numbering", (() => {
    const out = concatSlices([slice([], [], []), slice([{ start: 0, end: 2, speaker: 0, confidence: 1 }], [[1, 0]], [0])]);
    return out.embeddedIndices[0] === 0;
  })());
  ok("a slice with a missing embedding vector drops that index rather than misaligning", (() => {
    const out = concatSlices([slice(
      [{ start: 0, end: 3, speaker: 0, confidence: 1 }, { start: 3, end: 6, speaker: 1, confidence: 1 }],
      [[], [0, 1]], [0, 1],
    )]);
    return out.embeddings.length === 1 && out.embeddedIndices.join() === "1";
  })());

  // ---------- assembly ----------
  const live = [
    offsetSlice(slice([{ start: 0, end: 3, speaker: 0, confidence: 0.9 }], [[1, 0, 0]], [0]), 0),
    offsetSlice(slice([{ start: 6, end: 9, speaker: 0, confidence: 0.9 }], [[0, 1, 0]], [0]), 0),
    offsetSlice(slice([{ start: 6, end: 9, speaker: 0, confidence: 0.9 }], [[1, 0.02, 0]], [0]), 20),
  ];
  const result = assembleDiarization(chunks, concatSlices(live));
  ok("clustering across slices finds two people, not three",
    result.speakers.length === 2, JSON.stringify(result.speakers.map((s) => s.label)));
  ok("a voice heard in slice 1 and slice 3 is one speaker", (() => {
    const first = result.segments.find((s) => s.startMs === 0)?.speaker;
    const third = result.segments.find((s) => s.startMs === 26000)?.speaker;
    return first != null && first === third;
  })(), JSON.stringify(result.segments.map((s) => [s.startMs, s.speaker])));
  ok("the second voice is a different speaker", (() => {
    const first = result.segments.find((s) => s.startMs === 0)?.speaker;
    const second = result.segments.find((s) => s.startMs === 6000)?.speaker;
    return first !== second;
  })());
  ok("every line of the transcript survives assembly", result.segments.length >= 3);
  ok("a clean assembly carries no warning", result.warning === null);

  // ---------- names ----------
  const priya: VoiceProfile = {
    id: "vp_priya", name: "Priya", embedding: [1, 0, 0], samples: 4,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const named = assembleDiarization(chunks, concatSlices(live), { profiles: [priya] });
  ok("a remembered voice is named across the whole meeting",
    named.speakers.some((s) => s.label === "Priya"), JSON.stringify(named.speakers.map((s) => s.label)));
  ok("the unrecognised voice stays numbered",
    named.speakers.some((s) => /^Speaker \d$/.test(s.label)), JSON.stringify(named.speakers.map((s) => s.label)));

  // ---------- forced speaker count ----------
  ok("a stated speaker count is honoured", (() => {
    const out = assembleDiarization(chunks, concatSlices(live), { speakers: 1 });
    return out.speakers.length === 1;
  })());

  // ---------- degradation ----------
  const noTurns = assembleDiarization(chunks, { turns: [], embeddings: [], embeddedIndices: [] });
  ok("audio with no separable speech still yields a transcript", noTurns.segments.length === 3);
  ok("audio with no separable speech is not an error", noTurns.warning === null);
  ok("audio with no separable speech has no invented speakers",
    noTurns.segments.every((s) => s.speaker === null));

  ok("turns with no embeddings at all do not crash", (() => {
    const out = assembleDiarization(chunks, {
      turns: [{ start: 0, end: 3, speaker: 0, confidence: 1 }], embeddings: [], embeddedIndices: [],
    });
    return out.segments.length === 3 && out.speakers.length === 0;
  })());

  ok("an empty transcript assembles to nothing", assembleDiarization([], concatSlices(live)).segments.length === 0);

  const warned = unattributed(chunks, "models could not load");
  ok("an explicit failure keeps the transcript", warned.segments.length === 3);
  ok("an explicit failure reports its reason", warned.warning === "models could not load");
  ok("an explicit failure names no speakers", warned.speakers.length === 0);
}
