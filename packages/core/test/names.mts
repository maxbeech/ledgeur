// Working out who "Speaker 2" is — and, far more importantly, refusing to.
//
// Almost every test here is about rejection. Putting the right name on a
// transcript is worth something; putting the wrong one on it, silently, is
// worth less than nothing, so the validator is the part that has to be proved.
import {
  NAME_BELIEF, ENROL_BELIEF, applyNameProposals, buildNameInferenceMessages, isPlaceholderLabel,
  looksLikeName, nameEvidenceTranscript, parseNameProposals, spokenInTranscript,
  validateNameProposals, type NameableLine, type NameProposal,
} from "../src/diarize/names.ts";
import {
  MAX_SNIPPET_SECONDS, MIN_SNIPPET_SECONDS, chooseVoiceSnippet, sensitivityReasons,
  sensitivityScore, type SnippetLine,
} from "../src/diarize/snippet.ts";
import { meetingRangeToAudio } from "../src/diarize/attribute.ts";

const line = (startMs: number, speakerLabel: string, text: string): NameableLine =>
  ({ startMs, speakerLabel, text });

/** A meeting that names two people the two ways a meeting ever does. */
const meeting: NameableLine[] = [
  line(0, "Speaker 1", "Right, shall we get started."),
  line(4_000, "Speaker 2", "Hi, I'm Max, I look after product here."),
  line(11_000, "Speaker 1", "Thanks for joining, Max. I'm Priya on the engineering side."),
  line(18_000, "Speaker 2", "Good to meet you. So the pricing page is the thing."),
  line(25_000, "Speaker 3", "We should ask Jordan about the migration before we commit."),
  line(32_000, "Speaker 1", "Agreed. Jordan said he would look at it next week."),
];

const propose = (label: string, name: string, confidence: number, evidence: string): NameProposal =>
  ({ label, name, confidence, evidence });

export function runNameTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- placeholders ----------
  ok("a default label is a placeholder", isPlaceholderLabel("Speaker 2"));
  ok("a spaceless default label is a placeholder", isPlaceholderLabel("speaker3"));
  ok("a real name is not a placeholder", !isPlaceholderLabel("Max"));
  ok("an empty label is not a placeholder", !isPlaceholderLabel("  "));

  // ---------- the prompt ----------
  const messages = buildNameInferenceMessages(meeting);
  ok("the prompt is a system turn and a user turn",
    messages.length === 2 && messages[0].role === "system" && messages[1].role === "user");
  ok("the prompt lists the voices still unnamed",
    messages[1].content.includes("Speaker 1") && messages[1].content.includes("Speaker 3"));
  ok("the prompt carries the transcript", messages[1].content.includes("I'm Max"));
  ok("the prompt keeps speaker labels on every line", messages[1].content.includes("Speaker 2: Hi, I'm Max"));
  // The two failure modes worth pinning in the instructions themselves.
  ok("the instructions forbid naming somebody only talked about",
    /talked ABOUT/i.test(messages[0].content));
  ok("the instructions say an address names the other speaker",
    /OTHER speaker/i.test(messages[0].content));

  // ---------- transcript budgeting ----------
  const many: NameableLine[] = Array.from({ length: 400 }, (_, i) =>
    line(i * 5_000, `Speaker ${(i % 3) + 1}`, `This is line number ${i} and it says something of about this length.`));
  const trimmed = nameEvidenceTranscript(many, 2_000);
  ok("a long meeting is trimmed to the budget", trimmed.length <= 2_100, String(trimmed.length));
  ok("trimming keeps the opening, where introductions are", trimmed.includes("line number 0"));
  ok("trimming keeps the close, where goodbyes name people", trimmed.includes("line number 399"));
  ok("trimming marks what it dropped", trimmed.includes("…"));
  ok("a short meeting is not trimmed", !nameEvidenceTranscript(meeting).includes("…"));

  // ---------- parsing ----------
  const parsed = parseNameProposals(
    'Here you go: [{"speaker":"Speaker 2","name":"Max","confidence":0.95,"evidence":"Hi, I\'m Max"}] hope that helps');
  ok("a proposal is read out of surrounding prose", parsed.length === 1 && parsed[0].name === "Max");
  ok("the label is carried", parsed[0].label === "Speaker 2");
  ok("the confidence is carried", parsed[0].confidence === 0.95);
  ok("the evidence is carried", parsed[0].evidence === "Hi, I'm Max");
  ok("an empty list is a valid answer, not an error", parseNameProposals("[]").length === 0);
  ok("a missing confidence counts as none, not as certainty",
    parseNameProposals('[{"speaker":"Speaker 1","name":"Max"}]')[0].confidence === 0);
  ok("confidence is clamped", parseNameProposals('[{"speaker":"S","name":"Max","confidence":7}]')[0].confidence === 1);
  ok("an entry with no name is dropped", parseNameProposals('[{"speaker":"Speaker 1"}]').length === 0);
  ok("prose with no list throws", (() => {
    try { parseNameProposals("I could not tell who was speaking."); return false; } catch { return true; }
  })());
  ok("a broken JSON list throws", (() => {
    try { parseNameProposals('[{"speaker": }]'); return false; } catch { return true; }
  })());

  // ---------- what reads as a name ----------
  ok("a first name is a name", looksLikeName("Max"));
  ok("a full name is a name", looksLikeName("Max Beech"));
  ok("a hyphenated name is a name", looksLikeName("Anne-Marie"));
  ok("an apostrophe name is a name", looksLikeName("O'Neill"));
  ok("lowercase is not a name", !looksLikeName("max"));
  ok("a sentence is not a name", !looksLikeName("The Person Who Spoke First"));
  ok("a common capitalised word is not a name", !looksLikeName("Thanks"));
  ok("a weekday is not a name", !looksLikeName("Friday"));
  ok("a placeholder is not a name", !looksLikeName("Speaker"));
  ok("something with digits is not a name", !looksLikeName("Speaker2"));
  ok("an empty string is not a name", !looksLikeName(""));

  // ---------- grounding ----------
  const spoken = meeting.map((l) => l.text).join(" ");
  ok("a spoken name is grounded", spokenInTranscript("Max", spoken));
  ok("case and punctuation do not matter", spokenInTranscript("max", "hi, i'm max, good to meet you"));
  ok("an unspoken name is not grounded", spokenInTranscript("Rebecca", spoken) === false);
  ok("a partial word does not count as spoken", spokenInTranscript("Ma", spoken) === false);
  ok("every word of a full name must be spoken",
    spokenInTranscript("Max Fletcher", spoken) === false);

  // ---------- validation: the point of the whole module ----------
  const good = validateNameProposals([
    propose("Speaker 2", "Max", 0.95, "Hi, I'm Max, I look after product here."),
    propose("Speaker 1", "Priya", 0.9, "I'm Priya on the engineering side"),
  ], meeting);
  ok("a self-introduction is accepted", good.some((p) => p.label === "Speaker 2" && p.name === "Max"));
  ok("a second introduction in the same line is accepted", good.some((p) => p.name === "Priya"));
  ok("both are kept", good.length === 2);

  const reject = (p: NameProposal, why: string, lines = meeting) =>
    ok(`rejected: ${why}`, validateNameProposals([p], lines).length === 0,
      JSON.stringify(validateNameProposals([p], lines)));

  // An invented name, which is the failure that matters most.
  reject(propose("Speaker 3", "Rebecca", 0.99, "We should ask Jordan about the migration before we commit."),
    "a name nobody said");
  // A real quote with a name laundered onto it: "Priya" is genuinely said in
  // this meeting and this line genuinely exists, so both grounding checks pass
  // on their own — only requiring the cited line to be the line that says the
  // name catches it.
  reject(propose("Speaker 3", "Priya", 0.99, "We should ask Jordan about the migration before we commit."),
    "a real quote that does not contain the name it is offered for");
  // The tell for a fabricated proposal: evidence that is not in the transcript.
  reject(propose("Speaker 1", "Max", 0.99, "My name is Max and I chair these meetings"),
    "evidence that no line contains");
  reject(propose("Speaker 1", "Thanks", 0.99, "Thanks for joining, Max."), "a word that is not a name");
  reject(propose("Speaker 9", "Max", 0.99, "Hi, I'm Max, I look after product here."), "a voice not in this meeting");
  reject(propose("Speaker 2", "Speaker 4", 0.99, "Hi, I'm Max, I look after product here."), "a placeholder as a name");
  reject(propose("Speaker 2", "Max", NAME_BELIEF - 0.01, "Hi, I'm Max, I look after product here."),
    "belief under the threshold");
  reject(propose("Speaker 2", "Max", 0.99, "I'm"), "an evidence quote too short to mean anything");
  reject(propose("Speaker 2", "Max", 0.99, "Hi, I am Max, I look after product here."),
    "a quote that paraphrases the line it claims to copy");

  // A voice that already has a real name is never overwritten — a matched print
  // or a typed name outranks anything said in the room.
  const named: NameableLine[] = [
    line(0, "Priya", "Hi, I'm Max, I look after product here."),
    line(5_000, "Speaker 2", "Good to meet you."),
  ];
  ok("a named voice is never renamed",
    validateNameProposals([propose("Priya", "Max", 0.99, "Hi, I'm Max")], named).length === 0);
  ok("a protected label is never renamed",
    validateNameProposals(
      [propose("Speaker 2", "Max", 0.99, "Hi, I'm Max, I look after product here.")],
      meeting, { protectedLabels: ["Speaker 2"] },
    ).length === 0);

  // Contested names and contested voices: the better-supported one wins, once.
  const contested = validateNameProposals([
    propose("Speaker 1", "Max", 0.8, "Hi, I'm Max, I look after product here."),
    propose("Speaker 2", "Max", 0.95, "Hi, I'm Max, I look after product here."),
  ], meeting);
  ok("one name is claimed by one voice only", contested.length === 1);
  ok("the better-supported claim wins", contested[0].label === "Speaker 2");
  const twoNames = validateNameProposals([
    propose("Speaker 2", "Max", 0.95, "Hi, I'm Max, I look after product here."),
    propose("Speaker 2", "Priya", 0.9, "I'm Priya on the engineering side"),
  ], meeting);
  ok("one voice takes one name only", twoNames.length === 1 && twoNames[0].name === "Max");
  ok("the enrolment bar is stricter than the labelling bar", ENROL_BELIEF > NAME_BELIEF);

  // ---------- application ----------
  const segments = [
    { speakerLabel: "Speaker 1", speakerConfidence: null as number | null, text: "a" },
    { speakerLabel: "Speaker 2", speakerConfidence: null as number | null, text: "b" },
    { speakerLabel: "Speaker 2", speakerConfidence: null as number | null, text: "c" },
  ];
  const speakers = [
    { label: "Speaker 1", confidence: null as number | null, speakingSeconds: 10 },
    { label: "Speaker 2", confidence: null as number | null, speakingSeconds: 20 },
  ];
  const applied = applyNameProposals(segments, speakers,
    [propose("Speaker 2", "Max", 0.95, "Hi, I'm Max, I look after product here.")]);
  ok("every line by that voice is renamed",
    applied.segments.filter((s) => s.speakerLabel === "Max").length === 2);
  ok("other voices are untouched", applied.segments[0].speakerLabel === "Speaker 1");
  ok("the renamed lines carry the belief so the UI can show it as a guess",
    applied.segments[1].speakerConfidence === 0.95);
  ok("the speaker record is renamed too", applied.speakers[1].label === "Max");
  ok("the speaker record says the name was inferred", applied.speakers[1].nameSource === "inferred");
  ok("the speaker record keeps the evidence", applied.speakers[1].nameEvidence?.includes("I'm Max") === true);
  ok("unrelated speaker fields survive", applied.speakers[1].speakingSeconds === 20);
  ok("what actually changed is reported", applied.applied.length === 1);
  ok("applying nothing changes nothing", (() => {
    const out = applyNameProposals(segments, speakers, []);
    return out.applied.length === 0 && out.segments[1].speakerLabel === "Speaker 2";
  })());
  ok("a proposal for a voice that is not there changes nothing", (() => {
    const out = applyNameProposals(segments, speakers, [propose("Speaker 7", "Max", 0.99, "x")]);
    return out.applied.length === 0;
  })());
  ok("the inputs are never mutated", segments[1].speakerLabel === "Speaker 2");
}

/* ------------------------------------------------- choosing a voice sample */

const snip = (startMs: number, endMs: number, speakerLabel: string, text: string): SnippetLine =>
  ({ startMs, endMs, speakerLabel, text });

export function runSnippetTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- sensitivity ----------
  ok("bland speech scores zero", sensitivityScore("Shall we start with the roadmap for next quarter.") === 0);
  ok("a card number is disqualifying", sensitivityScore("It's 4551 2309 8842 1190.") >= 1);
  ok("a spaced-out number is still caught", sensitivityScore("four five five one, 2 3 0 9 8 8 4 2 1 1 9 0") >= 1);
  ok("an email address is disqualifying", sensitivityScore("Send it to max@example.com please.") >= 1);
  ok("a password is disqualifying", sensitivityScore("The password is on the shared doc.") >= 1);
  ok("a sort code is disqualifying", sensitivityScore("Sort code 20-45-11, I'll send the rest.") >= 1);
  ok("a salary mention is a hint, not a disqualification", (() => {
    const s = sensitivityScore("We should revisit her salary at the review.");
    return s > 0 && s < 1;
  })(), String(sensitivityScore("We should revisit her salary at the review.")));
  ok("a sum of money is a hint", (() => {
    const s = sensitivityScore("The tier lands at £29 a seat.");
    return s > 0 && s < 1;
  })());
  ok("markers are named for the log", sensitivityReasons("password is 1234567890").join().includes("credential"));
  ok("bland speech has no markers", sensitivityReasons("Good morning everyone.").length === 0);
  ok("a repeated marker is counted once", (() => {
    const once = sensitivityScore("Her salary is the issue.");
    return sensitivityScore("Her salary, his salary, everyone's salary.") === once;
  })());

  // ---------- choosing ----------
  const lines: SnippetLine[] = [
    snip(0, 3_500, "Speaker 1", "The password is hunter2, don't write it down."),
    snip(4_000, 6_000, "Speaker 2", "Understood."),
    snip(7_000, 11_500, "Speaker 1", "Anyway, the roadmap for next quarter is mostly the pricing page."),
    snip(12_000, 20_000, "Speaker 2", "Sounds sensible to me, we can pick it up on Thursday."),
  ];
  const one = chooseVoiceSnippet(lines, "Speaker 1");
  ok("a sample is chosen", one !== null);
  ok("the sensitive stretch is avoided", one?.startMs === 7_000, JSON.stringify(one));
  ok("the sample is at least the minimum length",
    (one!.endMs - one!.startMs) >= MIN_SNIPPET_SECONDS * 1000);
  ok("the chosen text is reported so a person can see what was kept",
    one?.text.includes("roadmap") === true);
  ok("the chosen sample is bland", one?.sensitivity === 0);

  const two = chooseVoiceSnippet(lines, "Speaker 2");
  ok("a long single utterance is trimmed rather than discarded",
    two !== null && two.endMs - two.startMs === MAX_SNIPPET_SECONDS * 1000, JSON.stringify(two));
  ok("the trimmed sample starts where the utterance does", two?.startMs === 12_000);

  ok("a voice with nothing long enough yields no sample",
    chooseVoiceSnippet([snip(0, 1_200, "Speaker 4", "Yep.")], "Speaker 4") === null);
  ok("a voice whose every stretch is sensitive yields no sample",
    chooseVoiceSnippet(
      [snip(0, 9_000, "Speaker 5", "My card is 4551 2309 8842 1190 and the pin is 4412.")],
      "Speaker 5",
    ) === null);
  ok("an unknown voice yields no sample", chooseVoiceSnippet(lines, "Speaker 9") === null);
  ok("an empty label yields no sample", chooseVoiceSnippet(lines, "  ") === null);
  // Two turns by the same person with somebody else in between must not be
  // spliced together — the audio in the middle is not that person's voice.
  ok("a window never spans another speaker's turn", (() => {
    const across = chooseVoiceSnippet([
      snip(0, 2_000, "Speaker 1", "One thing first."),
      snip(2_000, 4_000, "Speaker 2", "Go on."),
      snip(4_000, 6_000, "Speaker 1", "It is the roadmap."),
    ], "Speaker 1");
    return across === null;
  })());

  // ---------- meeting clock back to audio clock ----------
  // Silence is dropped from the retained buffer, so the two clocks drift; a
  // sample cut on the wrong clock is somebody else's voice.
  const spans = [
    { atMs: 0, durationMs: 4_000, meetingMs: 0 },
    { atMs: 4_000, durationMs: 5_000, meetingMs: 30_000 },
  ];
  ok("a range inside one span is shifted onto the audio clock", (() => {
    const out = meetingRangeToAudio(spans, 31_000, 34_000);
    return out.length === 1 && out[0].atMs === 5_000 && out[0].durationMs === 3_000;
  })(), JSON.stringify(meetingRangeToAudio(spans, 31_000, 34_000)));
  ok("a range straddling a cut comes back in pieces",
    meetingRangeToAudio(spans, 2_000, 32_000).length === 2);
  ok("a range in a gap comes back empty", meetingRangeToAudio(spans, 10_000, 20_000).length === 0);
  ok("an empty range comes back empty", meetingRangeToAudio(spans, 5_000, 5_000).length === 0);
  ok("with no spans the range passes through", (() => {
    const out = meetingRangeToAudio([], 1_000, 4_000);
    return out.length === 1 && out[0].atMs === 1_000 && out[0].durationMs === 3_000;
  })());
}
