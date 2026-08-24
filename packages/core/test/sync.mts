// Mapping a local meeting to the cloud.
//
// The headline test is the last one: no payload, however constructed, may
// contain a voice print. The privacy notice states plainly that voice prints
// never leave the device that heard the voice, and a comment cannot enforce
// that — this can.
import {
  toRemoteSpeakers, toRemoteSegments, toRemoteMeeting, toRemoteNote,
  toRemoteActionItems, toSyncPayload,
} from "../src/library/sync.ts";
import type { LocalMeeting } from "../src/library/meeting.ts";

const print = [0.11, 0.22, 0.33, 0.44];

const meeting: LocalMeeting = {
  id: "m1",
  title: "Pricing review",
  startedAt: "2026-08-24T09:00:00.000Z",
  endedAt: "2026-08-24T09:30:00.000Z",
  durationSec: 1800,
  lang: "en",
  source: "recording",
  sourceName: null,
  segments: [
    { startMs: 0, endMs: 4000, text: "Shall we talk about pricing.", speaker: 0, confidence: 0.9 },
    { startMs: 4000, endMs: 9000, text: "Six dollars is too low.", speaker: 1, confidence: 0.8 },
    { startMs: 9000, endMs: 11000, text: "Someone unattributed.", speaker: null, confidence: null },
  ],
  speakers: [
    { speaker: 0, label: "Priya", profileId: "vp_priya", confidence: 0.81, speakingSeconds: 7, embedding: print },
    { speaker: 1, label: "Speaker 2", profileId: null, confidence: null, speakingSeconds: 5, embedding: print },
  ],
  notes: {
    summary: ["The team reviewed pricing."],
    actionItems: ["Revisit the six dollar tier."],
    decisions: ["Pricing needs another look."],
    questions: ["Is six dollars too low?"],
    wordCount: 20,
  },
  manualNotes: "Check competitor pricing.",
  remoteId: null,
  updatedAt: "2026-08-24T09:30:00.000Z",
};

export function runSyncTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- speakers ----------
  const speakers = toRemoteSpeakers(meeting.speakers);
  ok("every speaker is carried", speakers.length === 2);
  ok("speakers are ordered by index", speakers[0].label === "Priya");
  ok("a named voice becomes an identity", speakers[0].identified_name === "Priya");
  ok("a named voice carries its confidence", speakers[0].identity_confidence === 0.81);
  // "Speaker 2" is a placeholder, not somebody's name.
  ok("a placeholder label is not stored as an identity", speakers[1].identified_name === null);
  ok("a placeholder label carries no confidence", speakers[1].identity_confidence === null);
  ok("a placeholder label is still stored as a label", speakers[1].label === "Speaker 2");
  ok("a speaker named the same as their placeholder is treated as unnamed", (() => {
    const out = toRemoteSpeakers([{ speaker: 2, label: "Speaker 3", profileId: null, confidence: null, speakingSeconds: 1 }]);
    return out[0].identified_name === null;
  })());
  ok("an empty label is not an identity", (() => {
    const out = toRemoteSpeakers([{ speaker: 0, label: "", profileId: null, confidence: null, speakingSeconds: 1 }]);
    return out[0].identified_name === null;
  })());
  ok("unsorted speakers are ordered before mapping", (() => {
    const out = toRemoteSpeakers([
      { speaker: 1, label: "B", profileId: null, confidence: null, speakingSeconds: 1 },
      { speaker: 0, label: "A", profileId: null, confidence: null, speakingSeconds: 1 },
    ]);
    return out[0].label === "A";
  })());

  // ---------- segments ----------
  const segments = toRemoteSegments(meeting.segments, meeting.speakers);
  ok("every segment is carried", segments.length === 3);
  ok("a segment points at its speaker's position", segments[0].speakerIndex === 0 && segments[1].speakerIndex === 1);
  ok("an unattributed segment stays unattributed", segments[2].speakerIndex === null);
  ok("timings survive", segments[0].start_ms === 0 && segments[0].end_ms === 4000);
  ok("text survives", segments[1].text === "Six dollars is too low.");
  ok("confidence survives", segments[0].confidence === 0.9);
  ok("a segment referring to a missing speaker is not mis-attributed", (() => {
    const out = toRemoteSegments(
      [{ startMs: 0, endMs: 1, text: "x", speaker: 9, confidence: null }],
      meeting.speakers,
    );
    return out[0].speakerIndex === null;
  })());
  ok("segment indices line up with the speaker array order", (() => {
    const spk = toRemoteSpeakers(meeting.speakers);
    const seg = toRemoteSegments(meeting.segments, meeting.speakers);
    return spk[seg[0].speakerIndex!].label === "Priya";
  })());

  // ---------- meeting and notes ----------
  const remote = toRemoteMeeting(meeting);
  ok("the title is carried", remote.title === "Pricing review");
  ok("an untitled meeting gets a fallback rather than an empty title",
    toRemoteMeeting({ ...meeting, title: "" }).title === "Untitled meeting");
  ok("the meeting is marked complete", remote.status === "complete");
  ok("timestamps are carried", remote.started_at === meeting.startedAt && remote.ended_at === meeting.endedAt);
  ok("the language is carried", remote.lang === "en");

  const note = toRemoteNote(meeting, "# Pricing review");
  ok("the summary is carried", note.summary.length === 1);
  ok("decisions are carried", note.decisions.length === 1);
  ok("questions are carried", note.questions.length === 1);
  ok("the markdown is carried", note.markdown === "# Pricing review");
  ok("the word count is carried", note.word_count === 20);
  ok("a meeting with no notes still maps", (() => {
    const out = toRemoteNote({ ...meeting, notes: null }, "x");
    return out.summary.length === 0 && out.word_count > 0;
  })());
  // Action items are their own table, so they must not be duplicated into the note.
  ok("action items are carried separately", toRemoteActionItems(meeting).length === 1);
  ok("a meeting with no notes has no action items", toRemoteActionItems({ ...meeting, notes: null }).length === 0);

  // ---------- the property that matters ----------
  const payload = toSyncPayload(meeting, "# Pricing review");
  const wire = JSON.stringify(payload);

  ok("no voice print reaches the wire", !wire.includes("embedding"), wire.slice(0, 300));
  // Belt and braces: check the actual numbers, in case a field is ever renamed.
  for (const value of print) {
    ok(`the vector component ${value} is not in the payload`, !wire.includes(String(value)), wire.slice(0, 300));
  }
  ok("no speaker object carries an embedding key",
    payload.speakers.every((s) => !("embedding" in s)));
  ok("the payload still carries everything else",
    payload.speakers.length === 2 && payload.segments.length === 3 && payload.actionItems.length === 1);

  // A meeting whose speakers have no embeddings at all must map identically.
  const bare = toSyncPayload({
    ...meeting,
    speakers: meeting.speakers.map(({ embedding: _drop, ...rest }) => rest),
  }, "# Pricing review");
  ok("a meeting with no stored prints maps the same way",
    JSON.stringify(bare) === wire, "the embedding must make no difference to the wire form");
}
