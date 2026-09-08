// Naming a voice from the conversation, in the app: the parts that touch the
// recording and the parts that must never touch the cloud.
//
// The decision logic (what the model is asked, what its answer is allowed to
// mean) lives in @ledgeur/core and is proved in packages/core/test/names.mts.
// What is proved here is the wiring: that a voice sample is cut from the right
// place in the right buffer, that moving one line moves only that line, and
// that none of the biometric data any of this creates can leave the device.
import { WHISPER_SAMPLE_RATE } from "@ledgeur/core";
import { samplesFromVoiceSample, voiceSamplesFor } from "../src/lib/speakerNames.ts";
import { reassignSegmentSpeaker } from "../src/lib/renameSpeaker.ts";
import { remoteSpeakers } from "../src/lib/sync.ts";
import type { LocalMeeting, LocalSegment } from "../src/lib/meetingsStore.ts";

type Ok = (name: string, cond: boolean, detail?: string) => void;

const seg = (
  id: string, label: string, startMs: number, endMs: number, text: string,
): LocalSegment => ({ id, speakerLabel: label, startMs, endMs, text, confidence: 0.9, speakerConfidence: null });

/** A buffer that rises steadily from 0 to 1, so every sample has a different
 *  value and a slice can be traced back to the exact index it was cut from —
 *  which is the only way to tell "the right three seconds" from "three seconds". */
function rampAudio(seconds: number): Float32Array {
  const out = new Float32Array(seconds * WHISPER_SAMPLE_RATE);
  for (let i = 0; i < out.length; i++) out[i] = i / out.length;
  return out;
}

/** What `rampAudio` holds at a given sample index, once stored as 16-bit. */
const pcmAt = (index: number, totalSeconds: number): number =>
  Math.round((index / (totalSeconds * WHISPER_SAMPLE_RATE)) * 32767);

export function runSpeakerNameTests(ok: Ok): void {
  // ── cutting the voice sample ───────────────────────────────────────────────
  {
    const segments = [
      seg("s1", "Speaker 1", 0, 4_000, "The card number is 4551 2309 8842 1190."),
      seg("s2", "Speaker 2", 4_000, 6_000, "Got it."),
      seg("s3", "Speaker 1", 6_000, 11_000, "Anyway, shall we talk about the roadmap for next quarter."),
    ];
    const samples = voiceSamplesFor(segments, rampAudio(12), []);
    const one = samples.get("Speaker 1");
    ok("a voice sample is kept", Boolean(one));
    ok("the sensitive stretch is not the one kept", one?.startMs === 6_000, JSON.stringify(one?.startMs));
    ok("the sample says what is in it", one?.text.includes("roadmap") === true);
    ok("the sample is at 16 kHz", one?.sampleRate === WHISPER_SAMPLE_RATE);
    ok("the sample is at least three seconds", (one!.pcm.length / WHISPER_SAMPLE_RATE) >= 3);
    ok("the sample is the audio under those words",
      one!.pcm[0] === pcmAt(6 * WHISPER_SAMPLE_RATE, 12), `${one?.pcm[0]} vs ${pcmAt(6 * WHISPER_SAMPLE_RATE, 12)}`);
    ok("the sample runs to the end of what was said",
      one!.pcm[one!.pcm.length - 1] === pcmAt(11 * WHISPER_SAMPLE_RATE - 1, 12),
      `${one?.pcm[one!.pcm.length - 1]} vs ${pcmAt(11 * WHISPER_SAMPLE_RATE - 1, 12)}`);
    ok("the round trip back to floats is close enough to embed", (() => {
      const floats = samplesFromVoiceSample(one!);
      return floats.length === one!.pcm.length
        && Math.abs(floats[0] - 6 / 12) < 0.001;
    })());

    // Speaker 2 says two seconds of nothing much: too short to carry identity,
    // so nothing is kept rather than something useless being kept.
    ok("a voice with too little speech yields no sample", !samples.has("Speaker 2"));
  }

  // The silences are cut out of the retained buffer, so a sample taken on the
  // meeting clock is somebody else's voice. This is the mapping that stops it.
  {
    const segments = [
      seg("s1", "Speaker 1", 0, 4_000, "Right, let us begin with the roadmap."),
      // Four minutes of silence happened here and was never retained.
      seg("s2", "Speaker 1", 244_000, 250_000, "So the pricing page is the one that matters most."),
    ];
    const spans = [
      { atMs: 0, durationMs: 4_000, meetingMs: 0 },
      { atMs: 4_000, durationMs: 6_000, meetingMs: 244_000 },
    ];
    const sample = voiceSamplesFor(segments, rampAudio(10), spans).get("Speaker 1");
    // The winning window is the six seconds at 244 s on the meeting clock,
    // which sits at 4 s inside the retained buffer. Reading it on the meeting
    // clock would run off the end of a ten-second buffer and produce nothing —
    // so the value at pcm[0] is the whole assertion.
    ok("a sample after a silence is cut from the retained clock, not the meeting clock",
      sample?.startMs === 244_000 && sample.pcm[0] === pcmAt(4 * WHISPER_SAMPLE_RATE, 10),
      JSON.stringify({ startMs: sample?.startMs, first: sample?.pcm[0], expected: pcmAt(4 * WHISPER_SAMPLE_RATE, 10) }));
    ok("a sample past the end of the buffer is not invented", (() => {
      const short = voiceSamplesFor(segments, rampAudio(1), spans).get("Speaker 1");
      // One second of audio cannot produce a three-second sample.
      return short === undefined;
    })());
  }

  ok("no audio means no samples", voiceSamplesFor([seg("s", "A", 0, 9_000, "hello there everyone")], new Float32Array(0), []).size === 0);

  // ── moving one line ───────────────────────────────────────────────────────
  {
    const meeting: LocalMeeting = {
      id: "m", title: "t", createdAt: "", startedAt: null, endedAt: null,
      status: "complete", lang: "en",
      segments: [
        seg("s1", "Max", 0, 2_000, "so I think we ship"),
        { ...seg("s2", "Max", 2_000, 5_000, "no, hang on"), speakerConfidence: 0.8 },
        seg("s3", "Priya", 5_000, 7_000, "agreed"),
      ],
      speakers: [
        { label: "Max", confidence: 0.9, speakingSeconds: 5, nameSource: "inferred", nameEvidence: "I'm Max" },
        { label: "Priya", confidence: null, speakingSeconds: 2, nameSource: "user" },
      ],
      summary: [], decisions: [], questions: [], actionItems: [],
      noteMarkdown: "", wordCount: 0, synced: false,
    };

    const moved = reassignSegmentSpeaker(meeting, "s2", "Priya");
    ok("the line moves", moved.segments[1].speakerLabel === "Priya");
    ok("no other line moves",
      moved.segments[0].speakerLabel === "Max" && moved.segments[2].speakerLabel === "Priya");
    ok("a line moved by hand is no longer a guess", moved.segments[1].speakerConfidence === null);
    ok("speaking time moves with it",
      moved.speakers?.find((s) => s.label === "Max")?.speakingSeconds === 2 &&
      moved.speakers?.find((s) => s.label === "Priya")?.speakingSeconds === 5,
      JSON.stringify(moved.speakers?.map((s) => [s.label, s.speakingSeconds])));
    // Moving a line says nothing about what anybody sounds like, so the voice
    // print behind the name must be left exactly as it was.
    ok("moving a line does not touch the name's provenance",
      moved.speakers?.find((s) => s.label === "Max")?.nameSource === "inferred");
    ok("the original is not mutated", meeting.segments[1].speakerLabel === "Max");

    const typed = reassignSegmentSpeaker(meeting, "s1", "Jordan");
    ok("a name typed on the spot becomes a speaker",
      typed.speakers?.some((s) => s.label === "Jordan" && s.nameSource === "user"));
    ok("moving to the same speaker is a no-op", reassignSegmentSpeaker(meeting, "s1", "Max") === meeting);
    ok("moving a line that is not there is a no-op", reassignSegmentSpeaker(meeting, "nope", "Priya") === meeting);
    ok("moving to an empty name is a no-op", reassignSegmentSpeaker(meeting, "s1", "  ") === meeting);
  }

  // ── nothing biometric may leave the device ────────────────────────────────
  //
  // The privacy notice says voice prints never leave the machine that heard the
  // voice. A comment cannot enforce that; this can. Both the mean vector and
  // the retained few seconds of audio are covered, because the sample is the
  // more sensitive of the two — it is the words as well as the voice.
  {
    const meeting = {
      id: "m", title: "t", createdAt: "", startedAt: null, endedAt: null,
      status: "complete" as const, lang: "en",
      segments: [seg("s1", "Max", 0, 2_000, "hello")],
      speakers: [{
        label: "Max", confidence: 0.9, speakingSeconds: 2,
        embedding: [0.1, 0.2, 0.3],
        nameSource: "inferred" as const,
        nameEvidence: "Hi, I'm Max",
        profileId: "vp_max_1",
        voiceSample: {
          sampleRate: WHISPER_SAMPLE_RATE, startMs: 0, endMs: 4_000,
          text: "hello", sensitivity: 0, pcm: new Int16Array([1, 2, 3]),
        },
      }],
      summary: [], decisions: [], questions: [], actionItems: [],
      noteMarkdown: "", wordCount: 0, synced: false,
    } satisfies LocalMeeting;

    const rows = remoteSpeakers(meeting);
    const wire = JSON.stringify(rows);
    ok("the speaker still reaches the cloud", rows.length === 1 && rows[0].label === "Max");
    ok("a guessed name goes up with its belief attached, not as a certainty",
      rows[0].identified_name === "Max" && rows[0].identity_confidence === 0.9);
    ok("no voice sample reaches the wire", !wire.includes("pcm") && !wire.includes("voiceSample"), wire);
    ok("no voice print reaches the wire", !wire.includes("embedding") && !wire.includes("0.2"), wire);
    ok("no voice profile id reaches the wire", !wire.includes("vp_max_1"), wire);
    ok("a speaker row carries exactly the three columns it should",
      rows.every((r) => Object.keys(r).sort().join() === "identified_name,identity_confidence,label"),
      JSON.stringify(Object.keys(rows[0])));
  }
}
