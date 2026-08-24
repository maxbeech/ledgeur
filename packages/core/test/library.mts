// Meetings as data — titles, speaker edits, search and export. All pure.
import {
  transcriptText, transcriptWithSpeakers, deriveTitle, renameSpeaker, mergeSpeakers,
  speakerLabel, searchLibrary, speakingShare, meetingToMarkdown, exportFilename,
  type LocalMeeting,
} from "../src/library/meeting.ts";

const base: LocalMeeting = {
  id: "m1",
  title: "Pricing review",
  startedAt: "2026-08-24T09:00:00.000Z",
  endedAt: "2026-08-24T09:30:00.000Z",
  durationSec: 1800,
  lang: "en",
  source: "recording",
  sourceName: null,
  segments: [
    { startMs: 0, endMs: 4000, text: "Right, shall we talk about the pricing page.", speaker: 0, confidence: 0.9 },
    { startMs: 4000, endMs: 9000, text: "I think six dollars is too low.", speaker: 1, confidence: 0.8 },
    { startMs: 9000, endMs: 12000, text: "Agreed, let's revisit it.", speaker: 0, confidence: 0.9 },
  ],
  speakers: [
    { speaker: 0, label: "Priya", profileId: "vp_priya", confidence: 0.81, speakingSeconds: 7 },
    { speaker: 1, label: "Speaker 2", profileId: null, confidence: null, speakingSeconds: 5 },
  ],
  notes: {
    summary: ["The team reviewed pricing."],
    actionItems: ["Revisit the six dollar tier."],
    decisions: ["Pricing needs another look."],
    questions: ["Is six dollars too low?"],
    wordCount: 20,
  },
  manualNotes: "Remember to check competitor pricing.",
  remoteId: null,
  updatedAt: "2026-08-24T09:30:00.000Z",
};

export function runLibraryTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- reading ----------
  ok("transcriptText joins every segment",
    transcriptText(base).startsWith("Right, shall we talk") && transcriptText(base).endsWith("revisit it."));
  ok("transcriptText of an empty meeting is empty", transcriptText({ segments: [] }) === "");

  const withSpeakers = transcriptWithSpeakers(base);
  ok("the readable transcript names the speaker", withSpeakers.includes("Priya:"), withSpeakers);
  ok("the readable transcript timestamps each line", withSpeakers.includes("[00:00]"), withSpeakers);
  ok("an unnamed speaker still gets a label", withSpeakers.includes("Speaker 2:"), withSpeakers);
  ok("a segment with no speaker gets no name prefix", (() => {
    const line = transcriptWithSpeakers({ segments: [{ startMs: 0, endMs: 1, text: "anon", speaker: null, confidence: null }], speakers: [] });
    return line === "[00:00] anon";
  })(), transcriptWithSpeakers({ segments: [{ startMs: 0, endMs: 1, text: "anon", speaker: null, confidence: null }], speakers: [] }));

  // ---------- titles ----------
  ok("an untitled meeting is named after the first thing said",
    deriveTitle(base).startsWith("Right, shall we talk"), deriveTitle(base));
  ok("a long opening line is cut on a word boundary", (() => {
    const t = deriveTitle({ ...base, segments: [{ startMs: 0, endMs: 1, text: "a".repeat(20) + " " + "b".repeat(80), speaker: 0, confidence: null }] }, 40);
    return t.endsWith("…") && !t.includes("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  })());
  ok("a silent import falls back to its filename",
    deriveTitle({ segments: [], startedAt: base.startedAt, sourceName: "standup-2026-08.m4a" }) === "standup-2026-08",
    deriveTitle({ segments: [], startedAt: base.startedAt, sourceName: "standup-2026-08.m4a" }));
  ok("a silent recording falls back to its date",
    deriveTitle({ segments: [], startedAt: base.startedAt, sourceName: null }).startsWith("Meeting — "),
    deriveTitle({ segments: [], startedAt: base.startedAt, sourceName: null }));
  ok("an unparseable date does not produce 'Invalid Date'",
    deriveTitle({ segments: [], startedAt: "not a date", sourceName: null }) === "Untitled meeting");
  ok("whitespace-only segments do not become a title",
    deriveTitle({ segments: [{ startMs: 0, endMs: 1, text: "   ", speaker: null, confidence: null }], startedAt: "x", sourceName: null }) === "Untitled meeting");

  // ---------- speaker editing ----------
  const renamed = renameSpeaker(base, 1, "Sam");
  ok("renaming a speaker changes their label", speakerLabel(renamed, 1) === "Sam");
  ok("renaming leaves the other speaker alone", speakerLabel(renamed, 0) === "Priya");
  ok("renaming does not mutate the original", speakerLabel(base, 1) === "Speaker 2");
  ok("a hand-typed name drops the confidence score",
    renameSpeaker(base, 0, "Priya Patel").speakers.find((s) => s.speaker === 0)?.confidence === null);
  ok("an empty rename is ignored", renameSpeaker(base, 1, "   ") === base);
  ok("renaming a speaker that has no row adds one",
    renameSpeaker(base, 5, "Guest").speakers.some((s) => s.speaker === 5 && s.label === "Guest"));

  const mergedMeeting = mergeSpeakers(base, 1, 0);
  ok("merging moves every segment to the target",
    mergedMeeting.segments.every((s) => s.speaker === 0), JSON.stringify(mergedMeeting.segments.map((s) => s.speaker)));
  ok("merging removes the absorbed speaker",
    mergedMeeting.speakers.length === 1 && mergedMeeting.speakers[0].speaker === 0);
  ok("merging sums the speaking time", mergedMeeting.speakers[0].speakingSeconds === 12);
  ok("merging a speaker into itself is a no-op", mergeSpeakers(base, 0, 0) === base);
  ok("merging does not mutate the original", base.speakers.length === 2);
  ok("merging into a speaker with no row creates one", (() => {
    const out = mergeSpeakers(base, 0, 7);
    return out.speakers.some((s) => s.speaker === 7);
  })());

  ok("speakerLabel of null is null", speakerLabel(base, null) === null);
  ok("speakerLabel falls back to Speaker N for an unknown index", speakerLabel(base, 4) === "Speaker 5");

  // ---------- search ----------
  const hits = searchLibrary([base], "pricing");
  ok("search finds a phrase in the transcript", hits.length >= 1, JSON.stringify(hits));
  ok("a hit knows which meeting it came from", hits[0].meetingId === "m1");
  ok("a hit carries a timestamp to jump to", typeof hits[0].startMs === "number");
  ok("a hit names the speaker", hits[0].speaker === "Priya", String(hits[0].speaker));
  ok("search is case-insensitive", searchLibrary([base], "PRICING").length === hits.length);
  ok("an empty query returns nothing", searchLibrary([base], "  ").length === 0);
  ok("a term that was never said returns nothing", searchLibrary([base], "kangaroo").length === 0);
  ok("a title-only match still returns the meeting", (() => {
    const out = searchLibrary([{ ...base, segments: [{ startMs: 0, endMs: 1, text: "unrelated words", speaker: null, confidence: null }] }], "Pricing review");
    return out.length === 1;
  })());
  ok("search respects the limit", searchLibrary([base], "e", { limit: 1 }).length === 1);
  ok("an excerpt is trimmed with ellipses when it is long", (() => {
    const long = { ...base, segments: [{ startMs: 0, endMs: 1, text: "x".repeat(200) + " needle " + "y".repeat(200), speaker: null, confidence: null }] };
    const out = searchLibrary([long], "needle", { contextChars: 10 });
    return out[0].excerpt.startsWith("…") && out[0].excerpt.endsWith("…");
  })());

  // ---------- speaking share ----------
  const share = speakingShare(base);
  ok("speaking share is sorted by who talked most", share[0].label === "Priya");
  ok("speaking share sums to one", Math.abs(share.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
  ok("a meeting with no speaking time has no share", speakingShare({ speakers: [] }).length === 0);
  ok("zero-second speakers do not divide by zero",
    speakingShare({ speakers: [{ speaker: 0, label: "A", profileId: null, confidence: null, speakingSeconds: 0 }] }).length === 0);

  // ---------- export ----------
  const md = meetingToMarkdown(base);
  ok("the export leads with the title", md.startsWith("# Pricing review"));
  ok("the export lists the speakers", md.includes("**Priya**"), md.slice(0, 400));
  ok("the export keeps the user's own notes", md.includes("Remember to check competitor pricing."));
  ok("the export includes decisions", md.includes("## Decisions"));
  ok("the export includes action items", md.includes("## Action items"));
  ok("the export includes the transcript", md.includes("## Transcript") && md.includes("Priya:"));
  ok("an export with no notes omits the empty sections", (() => {
    const bare = meetingToMarkdown({ ...base, notes: null, manualNotes: "" });
    return !bare.includes("## Summary") && !bare.includes("## Your notes") && bare.includes("## Transcript");
  })());

  ok("the filename is date-prefixed and slugged",
    exportFilename(base, "md") === "2026-08-24-pricing-review.md", exportFilename(base, "md"));
  ok("a title of only punctuation still yields a filename",
    exportFilename({ title: "!!!", startedAt: base.startedAt }, "md").endsWith("meeting.md"),
    exportFilename({ title: "!!!", startedAt: base.startedAt }, "md"));
  ok("a bad date does not produce 'NaN' in the filename",
    !exportFilename({ title: "x", startedAt: "nope" }, "md").includes("NaN"));
}
