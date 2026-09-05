// Desktop-side logic for the people directory, meeting ranking and recipes.
//
// All pure functions over real shapes — the parts where a wrong answer is a
// wrong screen rather than a crash, and so the parts worth pinning.

import { buildDirectory } from "../src/lib/directory.ts";
import { rankMeetings } from "../src/lib/meetingRanking.ts";
import type { LocalMeeting, LocalSegment } from "../src/lib/meetingsStore.ts";

const segment = (id: string, speakerLabel: string, startMs: number, text: string): LocalSegment =>
  ({ id, speakerLabel, startMs, endMs: startMs + 3000, text, confidence: 0.9 });

const meeting = (over: Partial<LocalMeeting> & { id: string }): LocalMeeting => ({
  title: over.id, createdAt: "2026-09-01T10:00:00.000Z", startedAt: null, endedAt: null,
  status: "complete", lang: "en-hq", segments: [], summary: [], decisions: [], questions: [],
  actionItems: [], noteMarkdown: "", wordCount: 0, synced: false, ...over,
});

export function runGranolaDesktopTests(ok: (name: string, cond: boolean, detail?: string) => void): void {
  // ── people directory ──────────────────────────────────────────────────────
  const meetings: LocalMeeting[] = [
    meeting({
      id: "m1", title: "Q3 pricing", createdAt: "2026-09-01T10:00:00.000Z",
      segments: [
        segment("a", "Sarah", 0, "one two three four"),
        segment("b", "Ravi", 4000, "five six"),
        segment("c", "Sarah", 8000, "seven"),
      ],
      speakers: [
        { label: "Sarah", confidence: null, speakingSeconds: 120 },
        { label: "Ravi", confidence: 0.8, speakingSeconds: 60 },
      ],
    }),
    meeting({
      id: "m2", title: "Hiring sync", createdAt: "2026-09-03T10:00:00.000Z",
      segments: [segment("d", "Sarah", 0, "eight nine"), segment("e", "Speaker 2", 4000, "ten")],
      speakers: [{ label: "Sarah", confidence: null, speakingSeconds: 30 }],
    }),
  ];

  const dir = buildDirectory(meetings, ["sarah"]);
  ok("the directory lists named speakers", dir.people.map((p) => p.name).sort().join(",") === "Ravi,Sarah");
  ok("an unnamed voice is NOT listed as a person",
    !dir.people.some((p) => p.name.startsWith("Speaker")),
    "otherwise the directory fills with numbered strangers");
  ok("unnamed voices are counted instead", dir.unnamedVoices === 1);
  ok("the busiest person sorts first", dir.people[0].name === "Sarah");
  ok("meeting counts are real", dir.people[0].meetingCount === 2);
  ok("speaking seconds come from the speaker record", dir.people[0].speakingSeconds === 150);
  ok("word counts are counted from the segments", dir.people[0].wordCount === 4 + 1 + 2);
  ok("last seen is the most recent meeting", dir.people[0].lastSeen === "2026-09-03T10:00:00.000Z");
  ok("a person's meetings are newest first", dir.people[0].meetings[0].id === "m2");
  ok("enrolment is matched case-insensitively", dir.people[0].enrolled === true);
  ok("someone with no voice print is marked as such",
    dir.people.find((p) => p.name === "Ravi")?.enrolled === false);
  ok("meetings with speakers are counted", dir.meetingsWithSpeakers === 2);

  ok("an empty library is an empty directory, not an error", (() => {
    const empty = buildDirectory([], []);
    return empty.people.length === 0 && empty.unnamedVoices === 0;
  })());
  ok("the same unnamed label in two meetings counts as two voices", (() => {
    const d = buildDirectory([
      meeting({ id: "x", segments: [segment("1", "Speaker 1", 0, "hi")] }),
      meeting({ id: "y", segments: [segment("2", "Speaker 1", 0, "hi")] }),
    ], []);
    return d.unnamedVoices === 2;
  })(), "nothing links 'Speaker 1' in one meeting to 'Speaker 1' in another");
  ok("a meeting with no speaker records still yields speaking time from segments", (() => {
    const d = buildDirectory([meeting({ id: "z", segments: [segment("1", "Ada", 0, "hello")] })], []);
    return d.people[0].speakingSeconds === 3;
  })());

  // ── ranking local meetings for a question ─────────────────────────────────
  // Ranked, not "the newest twelve": a question about a meeting from three
  // weeks ago used to be answered with "I don't have that information" while
  // the answer sat in IndexedDB.
  const library: LocalMeeting[] = [
    meeting({ id: "newest", title: "Standup", createdAt: "2026-09-04T10:00:00.000Z", summary: ["Nothing much happened."] }),
    meeting({ id: "middle", title: "Design crit", createdAt: "2026-09-03T10:00:00.000Z", summary: ["We reviewed the onboarding flow."] }),
    meeting({ id: "oldest", title: "Pricing workshop", createdAt: "2026-08-01T10:00:00.000Z", summary: ["Enterprise pricing set at forty thousand."], decisions: ["Go with forty thousand."] }),
  ];
  ok("an old but relevant meeting outranks a recent irrelevant one",
    rankMeetings(library, "what did we decide about enterprise pricing", 1)[0].id === "oldest");
  ok("recency breaks a tie between equally relevant meetings",
    rankMeetings(library, "completely unrelated words here", 1)[0].id === "newest");
  ok("ranking respects the limit", rankMeetings(library, "pricing", 2).length === 2);
  ok("a library smaller than the limit is returned whole",
    rankMeetings(library, "pricing", 10).length === 3);
  ok("an empty library ranks to nothing", rankMeetings([], "anything", 5).length === 0);
}
