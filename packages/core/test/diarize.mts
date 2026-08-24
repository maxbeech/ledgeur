// Diarization logic — clustering, attribution and voice memory. Pure functions,
// so everything here is exact rather than "roughly right".
import {
  cosine, normalise, centroid, clusterEmbeddings, MERGE_SIMILARITY,
} from "../src/diarize/cluster.ts";
import {
  mergeAdjacentTurns, overlapSeconds, applyClusters, attributeChunks,
  groupBySpeaker, formatOffset, offsetTurns,
} from "../src/diarize/turns.ts";
import {
  matchProfile, identifySpeakers, rememberVoice, forgetVoice,
  defaultSpeakerLabel, IDENTIFY_SIMILARITY,
} from "../src/diarize/voiceprints.ts";
import type { RawTurn, SpeakerTurn, VoiceProfile } from "../src/diarize/types.ts";

export function runDiarizeTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- cosine / normalise / centroid ----------
  ok("cosine of identical vectors is 1", Math.abs(cosine([1, 0, 0], [1, 0, 0]) - 1) < 1e-9);
  ok("cosine of orthogonal vectors is 0", Math.abs(cosine([1, 0], [0, 1])) < 1e-9);
  ok("cosine ignores magnitude", Math.abs(cosine([1, 1], [5, 5]) - 1) < 1e-9);
  ok("cosine of mismatched lengths is -1", cosine([1, 2], [1]) === -1);
  ok("cosine of empty is -1", cosine([], []) === -1);
  ok("cosine of a zero vector is -1", cosine([0, 0], [1, 1]) === -1);

  ok("normalise gives unit length", Math.abs(Math.hypot(...normalise([3, 4])) - 1) < 1e-9);
  ok("normalise of zero vector does not divide by zero", normalise([0, 0]).every((x) => x === 0));

  ok("centroid averages then normalises", (() => {
    const c = centroid([[1, 0], [0, 1]]);
    return Math.abs(c[0] - c[1]) < 1e-9 && Math.abs(Math.hypot(...c) - 1) < 1e-9;
  })());
  ok("centroid of nothing is empty", centroid([]).length === 0);
  ok("centroid ignores a stray dimension", centroid([[1, 0], [1, 2, 3]]).length === 2);

  // ---------- clustering ----------
  // Two tight groups, far apart: must come back as exactly two speakers.
  const twoGroups = [[1, 0.02], [0.98, 0.05], [0.03, 1], [0.01, 0.99]];
  const twoLabels = clusterEmbeddings(twoGroups);
  ok("clusters two distinct voices into two", new Set(twoLabels).size === 2, JSON.stringify(twoLabels));
  ok("groups the right members together",
    twoLabels[0] === twoLabels[1] && twoLabels[2] === twoLabels[3] && twoLabels[0] !== twoLabels[2],
    JSON.stringify(twoLabels));
  ok("numbers clusters by first appearance", twoLabels[0] === 0, JSON.stringify(twoLabels));

  ok("a single embedding is one speaker", JSON.stringify(clusterEmbeddings([[1, 0]])) === "[0]");
  ok("no embeddings is no speakers", clusterEmbeddings([]).length === 0);

  ok("identical embeddings collapse to one speaker",
    new Set(clusterEmbeddings([[1, 0], [1, 0], [1, 0]])).size === 1);

  ok("a forced speaker count is honoured even when voices are alike",
    new Set(clusterEmbeddings([[1, 0], [1, 0.01], [1, 0.02]], { speakers: 2 })).size === 2);
  ok("a forced count larger than the data is clamped",
    new Set(clusterEmbeddings([[1, 0], [0, 1]], { speakers: 9 })).size === 2);

  // The two members of each group sit ~0.9995 apart, so "refuse everything"
  // needs a threshold above that rather than merely a high-sounding one.
  ok("a high enough threshold refuses to merge anything",
    new Set(clusterEmbeddings(twoGroups, { threshold: 0.9999 })).size === 4,
    JSON.stringify(clusterEmbeddings(twoGroups, { threshold: 0.9999 })));
  ok("a threshold of -1 merges everything",
    new Set(clusterEmbeddings(twoGroups, { threshold: -1 })).size === 1);

  ok("the default merge threshold is below the identify threshold",
    MERGE_SIMILARITY < IDENTIFY_SIMILARITY, `${MERGE_SIMILARITY} vs ${IDENTIFY_SIMILARITY}`);

  // Average linkage must resist chaining: A and C are far apart, B sits between.
  ok("average linkage does not chain two speakers through a bridge", (() => {
    const labels = clusterEmbeddings([[1, 0], [0.7, 0.7], [0, 1]], { threshold: 0.8 });
    return labels[0] !== labels[2];
  })());

  // ---------- turns ----------
  const raw: RawTurn[] = [
    { start: 0, end: 2, speaker: 0, confidence: 0.9 },
    { start: 2.2, end: 4, speaker: 0, confidence: 0.5 },
    { start: 4.4, end: 6, speaker: 1, confidence: 0.8 },
  ];
  const merged = mergeAdjacentTurns(raw, 0.5);
  ok("merges a same-speaker run across a short gap", merged.length === 2, JSON.stringify(merged));
  ok("the merged turn spans both", merged[0].start === 0 && merged[0].end === 4);
  ok("merged confidence is duration-weighted",
    Math.abs(merged[0].confidence - (0.9 * 2 + 0.5 * 1.8) / 3.8) < 1e-9, String(merged[0].confidence));
  ok("does not merge across a speaker change", merged[1].speaker === 1);
  ok("a gap wider than the tolerance is not merged", mergeAdjacentTurns(raw, 0.1).length === 3);
  ok("merging sorts unsorted input", (() => {
    const out = mergeAdjacentTurns([raw[2], raw[0], raw[1]], 0.5);
    return out[0].start === 0 && out.length === 2;
  })());

  ok("offsetTurns shifts both ends", (() => {
    const [t] = offsetTurns([{ start: 1, end: 2, speaker: 0, confidence: 1 }], 10);
    return t.start === 11 && t.end === 12;
  })());

  ok("overlapSeconds finds a partial overlap", overlapSeconds(0, 5, 3, 9) === 2);
  ok("overlapSeconds is zero for disjoint spans", overlapSeconds(0, 1, 4, 5) === 0);
  ok("overlapSeconds is zero for touching spans", overlapSeconds(0, 4, 4, 8) === 0);

  // A short turn was never embedded; it should inherit the nearest neighbour.
  ok("a turn too short to embed inherits its nearest neighbour", (() => {
    const turns: RawTurn[] = [
      { start: 0, end: 5, speaker: 0, confidence: 1 },   // embedded → cluster 0
      { start: 5.1, end: 5.4, speaker: 1, confidence: 1 }, // too short
      { start: 20, end: 25, speaker: 2, confidence: 1 },  // embedded → cluster 1
    ];
    const out = applyClusters(turns, [0, 2], [0, 1]);
    return out[1].speaker === 0 && out[2].speaker === 1;
  })());

  // ---------- attribution ----------
  const turns2: SpeakerTurn[] = [
    { start: 0, end: 5, speaker: 0, confidence: 0.9 },
    { start: 5, end: 10, speaker: 1, confidence: 0.8 },
  ];
  const single = attributeChunks([{ text: "Hello there team", start: 0, end: 4 }], turns2);
  ok("a chunk inside one turn goes to that speaker", single.length === 1 && single[0].speaker === 0);
  ok("attribution converts seconds to milliseconds", single[0].startMs === 0 && single[0].endMs === 4000);

  const straddle = attributeChunks(
    [{ text: "we should ship it I disagree entirely", start: 3, end: 7 }],
    turns2,
  );
  ok("a chunk straddling a speaker change is split", straddle.length === 2, JSON.stringify(straddle));
  ok("the split halves keep their speakers",
    straddle[0]?.speaker === 0 && straddle[1]?.speaker === 1, JSON.stringify(straddle));
  ok("the split loses no words", (() => {
    const rejoined = straddle.map((s) => s.text).join(" ");
    return rejoined === "we should ship it I disagree entirely";
  })(), JSON.stringify(straddle.map((s) => s.text)));
  ok("the split is contiguous in time",
    straddle[0].endMs === straddle[1].startMs, JSON.stringify(straddle));

  ok("text overlapping no turn is kept with a null speaker", (() => {
    const out = attributeChunks([{ text: "orphan words", start: 50, end: 52 }], turns2);
    return out.length === 1 && out[0].speaker === null && out[0].text === "orphan words";
  })());
  ok("empty text is dropped rather than attributed",
    attributeChunks([{ text: "   ", start: 0, end: 2 }], turns2).length === 0);
  ok("a null end (Whisper's last chunk) does not crash", (() => {
    const out = attributeChunks([{ text: "trailing", start: 6, end: null }], turns2);
    return out.length === 1 && out[0].text === "trailing";
  })());
  ok("a brief interjection below the share floor does not split the sentence", (() => {
    const brief: SpeakerTurn[] = [
      { start: 0, end: 10, speaker: 0, confidence: 0.9 },
      { start: 4.0, end: 4.2, speaker: 1, confidence: 0.9 }, // 0.2s "mm-hm"
    ];
    const out = attributeChunks([{ text: "one two three four five six", start: 0, end: 8 }], brief);
    return out.length === 1 && out[0].speaker === 0;
  })());

  // ---------- grouping & formatting ----------
  const grouped = groupBySpeaker([
    { startMs: 0, endMs: 1000, text: "Hello.", speaker: 0, confidence: 0.9 },
    { startMs: 1000, endMs: 2000, text: "How are you?", speaker: 0, confidence: 0.7 },
    { startMs: 2000, endMs: 3000, text: "Fine.", speaker: 1, confidence: 0.8 },
  ]);
  ok("consecutive segments from one speaker become a paragraph", grouped.length === 2);
  ok("the paragraph joins the text", grouped[0].text === "Hello. How are you?");
  ok("the paragraph spans to the last end", grouped[0].endMs === 2000);
  ok("the paragraph keeps the weakest confidence", grouped[0].confidence === 0.7);
  ok("grouping does not mutate its input", (() => {
    const input = [{ startMs: 0, endMs: 1, text: "a", speaker: 0, confidence: null }];
    groupBySpeaker([...input, { startMs: 1, endMs: 2, text: "b", speaker: 0, confidence: null }]);
    return input[0].text === "a";
  })());

  ok("formatOffset renders mm:ss", formatOffset(65_000) === "01:05", formatOffset(65_000));
  ok("formatOffset renders h:mm:ss past an hour", formatOffset(3_725_000) === "1:02:05", formatOffset(3_725_000));
  ok("formatOffset floors negatives to zero", formatOffset(-5) === "00:00");

  // ---------- voice profiles ----------
  const iso = "2026-08-24T00:00:00.000Z";
  const priya: VoiceProfile = { id: "vp_priya", name: "Priya", embedding: normalise([1, 0, 0]), samples: 3, createdAt: iso, updatedAt: iso };
  const sam: VoiceProfile = { id: "vp_sam", name: "Sam", embedding: normalise([0, 1, 0]), samples: 1, createdAt: iso, updatedAt: iso };

  ok("matches a known voice", matchProfile(normalise([0.99, 0.05, 0]), [priya, sam])?.profile.id === "vp_priya");
  ok("refuses a stranger", matchProfile(normalise([0, 0, 1]), [priya, sam]) === null);
  ok("no profiles means no match", matchProfile([1, 0, 0], []) === null);
  ok("an empty embedding never matches", matchProfile([], [priya, sam]) === null);
  ok("refuses when two profiles are indistinguishable", (() => {
    const twin: VoiceProfile = { ...priya, id: "vp_twin", name: "Twin", embedding: normalise([1, 0.001, 0]) };
    return matchProfile(normalise([1, 0, 0]), [priya, twin]) === null;
  })());

  ok("defaultSpeakerLabel counts from one", defaultSpeakerLabel(0) === "Speaker 1" && defaultSpeakerLabel(2) === "Speaker 3");

  const identified = identifySpeakers([
    { speaker: 0, embedding: normalise([1, 0.02, 0]), speakingSeconds: 120 },
    { speaker: 1, embedding: normalise([0, 0, 1]), speakingSeconds: 60 },
  ], [priya, sam]);
  ok("names a speaker it recognises", identified[0].label === "Priya" && identified[0].profileId === "vp_priya");
  ok("falls back to Speaker N for an unknown voice", identified[1].label === "Speaker 2" && identified[1].profileId === null);
  ok("reports the match confidence", (identified[0].confidence ?? 0) >= IDENTIFY_SIMILARITY);
  ok("an unmatched speaker has null confidence", identified[1].confidence === null);
  ok("identification preserves speaking time", identified[0].speakingSeconds === 120);

  ok("one profile cannot name two speakers in the same clip", (() => {
    const out = identifySpeakers([
      { speaker: 0, embedding: normalise([1, 0.05, 0]), speakingSeconds: 10 },
      { speaker: 1, embedding: normalise([1, 0.01, 0]), speakingSeconds: 10 },
    ], [priya]);
    const named = out.filter((s) => s.profileId === "vp_priya");
    return named.length === 1 && named[0].speaker === 1; // the closer match keeps the name
  })(), JSON.stringify(identifySpeakers([
    { speaker: 0, embedding: normalise([1, 0.05, 0]), speakingSeconds: 10 },
    { speaker: 1, embedding: normalise([1, 0.01, 0]), speakingSeconds: 10 },
  ], [priya]).map((s) => s.label)));

  // ---------- remembering ----------
  const added = rememberVoice([], { name: "Dana", embedding: normalise([0, 0, 1]), now: 1_700_000_000_000 });
  ok("naming a new voice creates a profile", added.length === 1 && added[0].name === "Dana");
  ok("a new profile starts at one sample", added[0].samples === 1);
  ok("a new profile is stored normalised", Math.abs(Math.hypot(...added[0].embedding) - 1) < 1e-9);

  const updated = rememberVoice([priya], { name: "Priya", embedding: normalise([0.9, 0.4, 0]) });
  ok("naming an existing person updates rather than duplicates", updated.length === 1);
  ok("an update increments the sample count", updated[0].samples === 4);
  ok("the running mean leans on the established voice", (() => {
    // 3 old samples vs 1 new: the result must stay closer to the old print.
    const toOld = cosine(updated[0].embedding, priya.embedding);
    const toNew = cosine(updated[0].embedding, normalise([0.9, 0.4, 0]));
    return toOld > toNew;
  })(), JSON.stringify(updated[0].embedding));
  ok("matching by name is case-insensitive",
    rememberVoice([priya], { name: "priya", embedding: normalise([1, 0, 0]) }).length === 1);
  ok("an explicit profile id wins over the name",
    rememberVoice([priya, sam], { name: "Renamed", embedding: normalise([1, 0, 0]), profileId: "vp_sam" })
      .find((p) => p.id === "vp_sam")?.name === "Renamed");
  ok("a rename with no embedding still renames", (() => {
    const out = rememberVoice([priya], { name: "Priya P", embedding: [], profileId: "vp_priya" });
    return out[0].name === "Priya P" && out[0].samples === 3;
  })());
  ok("an empty name is ignored", rememberVoice([], { name: "  ", embedding: [1, 0] }).length === 0);
  ok("remembering does not mutate the input array", (() => {
    const before = [...[priya]];
    rememberVoice(before, { name: "Priya", embedding: normalise([1, 0, 0]) });
    return before.length === 1 && before[0].samples === 3;
  })());
  ok("a mismatched embedding dimension does not corrupt the profile", (() => {
    const out = rememberVoice([priya], { name: "Priya", embedding: [1, 0] });
    return out[0].embedding.length === 3 && out[0].samples === 3;
  })());

  ok("forgetVoice removes exactly one", forgetVoice([priya, sam], "vp_priya").length === 1);
  ok("forgetting an unknown id is a no-op", forgetVoice([priya, sam], "nope").length === 2);
}
