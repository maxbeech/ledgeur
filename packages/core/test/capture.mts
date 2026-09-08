// Sorting a captured thought — and, far more importantly, refusing to.
//
// Almost every test here is about rejection. Filing a thought in the right
// space saves somebody a few seconds; filing it confidently in the wrong one
// loses it, because nobody looks in the wrong space and nobody checks an inbox
// they believe is empty. So the validator is the part that has to be proved,
// and the one invariant behind all of it is that no rejection ever loses the
// thought itself.
import {
  CAPTURE_SYSTEM, SPACE_BELIEF, TASK_BELIEF, applyRouting, buildCaptureMessages,
  buildMeetingSpaceMessages, capturesInSpace, kindIsGuess, markUnsorted, meetingDigestText,
  newCapture, parseCaptureVerdict, setKind, setSpace, spaceIsGuess, unfileOrphans,
  unroutedCapture, validateCapture, validateMeetingSpace, wordsAppearIn,
  type CaptureRecord, type CaptureVerdict, type SpaceOption,
} from "../src/capture/index.ts";

const SPACES: SpaceOption[] = [
  { id: "s-acme", name: "Acme" },
  { id: "s-hiring", name: "Hiring" },
  { id: "s-personal", name: "Personal" },
];

const verdict = (v: Partial<CaptureVerdict> = {}): CaptureVerdict => ({
  kind: "note", kindConfidence: 0, spaceName: "", spaceConfidence: 0, spaceEvidence: "", title: "",
  ...v,
});

/** A capture at rest, as the store holds it. */
const record = (over: Partial<CaptureRecord> = {}): CaptureRecord => ({
  ...newCapture({ id: "c1", text: "chase the Acme renewal", entry: "typed", now: "2026-09-08T10:00:00.000Z" }),
  ...over,
});

export function runCaptureTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- the prompt ----------
  {
    const msgs = buildCaptureMessages("chase Priya about the SOC2 letter", SPACES);
    ok("the capture prompt is a system message and a user message",
      msgs.length === 2 && msgs[0].role === "system" && msgs[1].role === "user");
    ok("the prompt offers every space by name",
      SPACES.every((s) => msgs[1].content.includes(`"${s.name}"`)), msgs[1].content);
    ok("the prompt carries the thought", msgs[1].content.includes("SOC2 letter"));
    ok("the prompt forbids inventing a space", /never invent a space/i.test(CAPTURE_SYSTEM));
    ok("the prompt says an unsorted thought is a good answer", /good answer/i.test(CAPTURE_SYSTEM));
    ok("the prompt defaults to a note when unsure", /cannot tell, it is a `note`/i.test(CAPTURE_SYSTEM));
    ok("the prompt demands an exact quote", /character for character/i.test(CAPTURE_SYSTEM));

    const none = buildCaptureMessages("a thought", []);
    ok("with no spaces the prompt says so rather than offering nothing",
      /none/i.test(none[1].content), none[1].content);

    // A pasted email must not turn a sub-second sort into a thirty-second one.
    const huge = buildCaptureMessages("x".repeat(9_000), SPACES, { budget: 200 });
    ok("a very long thought is clipped to the budget", huge[1].content.length < 600, `${huge[1].content.length}`);
    ok("a clipped thought is marked as clipped", huge[1].content.includes("…"));
  }

  // ---------- parsing ----------
  {
    const v = parseCaptureVerdict(
      '{"kind":"task","kind_confidence":0.9,"space":"Acme","space_confidence":0.8,"space_evidence":"the Acme renewal","title":"chase the renewal"}');
    ok("a well-formed verdict parses", v.kind === "task" && v.spaceName === "Acme");
    ok("confidences parse as numbers", v.kindConfidence === 0.9 && v.spaceConfidence === 0.8);
    ok("the evidence parses", v.spaceEvidence === "the Acme renewal");

    const chatty = parseCaptureVerdict('Sure! Here is the JSON:\n{"kind":"note","kind_confidence":0.7}\nHope that helps.');
    ok("prose around the JSON is tolerated", chatty.kind === "note" && chatty.kindConfidence === 0.7);

    const bare = parseCaptureVerdict('{"kind":"task"}');
    ok("a missing confidence is no confidence, not certainty", bare.kindConfidence === 0);
    ok("a missing space is empty", bare.spaceName === "" && bare.spaceEvidence === "");

    const odd = parseCaptureVerdict('{"kind":"URGENT","kind_confidence":"very"}');
    ok("an unknown kind is dropped rather than guessed at", odd.kind === "");
    ok("a non-numeric confidence is zero", odd.kindConfidence === 0);

    const clamped = parseCaptureVerdict('{"kind":"task","kind_confidence":4}');
    ok("an out-of-range confidence is clamped", clamped.kindConfidence === 1);

    let threw = "";
    try { parseCaptureVerdict("I think that's a task, personally."); } catch (e) { threw = String(e); }
    ok("a reply with no JSON at all throws", threw.includes("did not answer"), threw);
    threw = "";
    try { parseCaptureVerdict('{"kind": task}'); } catch (e) { threw = String(e); }
    ok("invalid JSON throws", threw.includes("not valid JSON"), threw);
    // The other model prompt in this codebase asks for an array, so a model
    // that wraps its one answer in one is doing something predictable. Reading
    // it is strictly better than throwing the sort away over a bracket.
    ok("a single answer wrapped in an array is still understood",
      parseCaptureVerdict('[{"kind":"task","kind_confidence":0.9}]').kind === "task");
    threw = "";
    try { parseCaptureVerdict('[{"kind":"task"},{"kind":"note"}]'); } catch (e) { threw = String(e); }
    ok("two verdicts for one thought are refused rather than picked between",
      threw.includes("not valid JSON"), threw);
  }

  // ---------- validation: kind ----------
  {
    const text = "chase the Acme renewal before Friday";
    const task = validateCapture(verdict({ kind: "task", kindConfidence: 0.9 }), { text, spaces: SPACES });
    ok("a confident task is a task", task.kind === "task");

    const weak = validateCapture(verdict({ kind: "task", kindConfidence: TASK_BELIEF - 0.01 }), { text, spaces: SPACES });
    ok("a task the model is unsure of stays a note", weak.kind === "note");
    ok("an unsure task keeps the thought intact", weak.title === text);

    const exact = validateCapture(verdict({ kind: "task", kindConfidence: TASK_BELIEF }), { text, spaces: SPACES });
    ok("the threshold itself is enough", exact.kind === "task");

    const note = validateCapture(verdict({ kind: "note", kindConfidence: 0.9 }), { text, spaces: SPACES });
    ok("a note is a note", note.kind === "note");
    ok("a decided note records the belief, so the UI can tell it was looked at",
      note.kindConfidence === 0.9);

    const nothing = validateCapture(verdict({ kind: "", kindConfidence: 0.99 }), { text, spaces: SPACES });
    ok("a kind the model did not give stays a note", nothing.kind === "note" && nothing.kindConfidence === 0);
  }

  // ---------- validation: the space (where wrong is worse than nothing) ----------
  {
    const text = "chase the Acme renewal before Friday";
    const good = validateCapture(
      verdict({ spaceName: "Acme", spaceConfidence: 0.85, spaceEvidence: "the Acme renewal" }),
      { text, spaces: SPACES });
    ok("a confident, grounded space is applied", good.spaceId === "s-acme");
    ok("an applied space keeps its quote for the UI", good.spaceEvidence === "the Acme renewal");

    const invented = validateCapture(
      verdict({ spaceName: "Renewals", spaceConfidence: 0.99, spaceEvidence: "the Acme renewal" }),
      { text, spaces: SPACES });
    ok("a space that was never offered is refused", invented.spaceId === null);

    const nearMiss = validateCapture(
      verdict({ spaceName: "Acme Corp", spaceConfidence: 0.99, spaceEvidence: "the Acme renewal" }),
      { text, spaces: SPACES });
    ok("a plausible neighbour of a real space name is refused", nearMiss.spaceId === null);

    const sloppy = validateCapture(
      verdict({ spaceName: "  acme. ", spaceConfidence: 0.85, spaceEvidence: "the Acme renewal" }),
      { text, spaces: SPACES });
    ok("casing and stray punctuation do not lose a correct answer", sloppy.spaceId === "s-acme");

    const unsure = validateCapture(
      verdict({ spaceName: "Acme", spaceConfidence: SPACE_BELIEF - 0.01, spaceEvidence: "the Acme renewal" }),
      { text, spaces: SPACES });
    ok("an unsure space goes to the inbox", unsure.spaceId === null);

    // The one that matters most: a model that read something that was not there.
    const fabricated = validateCapture(
      verdict({ spaceName: "Hiring", spaceConfidence: 0.95, spaceEvidence: "interviewing the backend candidate" }),
      { text, spaces: SPACES });
    ok("a space whose evidence is not in the thought is refused", fabricated.spaceId === null);

    const tiny = validateCapture(
      verdict({ spaceName: "Acme", spaceConfidence: 0.95, spaceEvidence: "the" }),
      { text, spaces: SPACES });
    ok("a quote too short to mean anything is refused", tiny.spaceId === null);

    const noSpaces = validateCapture(
      verdict({ spaceName: "Acme", spaceConfidence: 0.99, spaceEvidence: "the Acme renewal" }),
      { text, spaces: [] });
    ok("with no spaces to choose from, nothing is filed", noSpaces.spaceId === null);

    ok("a refused space still keeps the thought", fabricated.title === text && fabricated.kind === "note");
  }

  // ---------- validation: the title ----------
  {
    const text = "erm, I need to chase the Acme renewal before Friday I think";
    const tidy = validateCapture(
      verdict({ title: "chase the Acme renewal before Friday" }), { text, spaces: SPACES });
    ok("a tidier title in the person's own words is kept",
      tidy.title === "chase the Acme renewal before Friday");

    const invented = validateCapture(
      verdict({ title: "Follow up with Acme regarding contract renewal" }), { text, spaces: SPACES });
    ok("a title using words the person never said is refused", invented.title === text);

    const long = validateCapture(
      verdict({ title: `${"chase ".repeat(30)}` }), { text, spaces: SPACES });
    ok("an absurdly long title is refused", long.title === text);

    const empty = validateCapture(verdict({ title: "" }), { text, spaces: SPACES });
    ok("no title falls back to what was said", empty.title === text);
  }

  // ---------- the invariant: nothing is ever lost ----------
  {
    const text = "  a thought that survives everything  ";
    const hostile = validateCapture(
      verdict({ kind: "", spaceName: "Nope", spaceConfidence: 1, spaceEvidence: "nonsense", title: "invented words entirely" }),
      { text, spaces: SPACES });
    ok("a wholly unbelievable verdict still keeps the thought",
      hostile.title === text.trim() && hostile.kind === "note" && hostile.spaceId === null);
    ok("an unrouted capture is a kept, unfiled note",
      unroutedCapture(text).title === text.trim() && unroutedCapture(text).spaceId === null);
  }

  // ---------- word grounding ----------
  {
    ok("words present are found", wordsAppearIn("Acme renewal", "chase the Acme renewal today"));
    ok("casing does not decide it", wordsAppearIn("ACME", "chase the acme renewal"));
    ok("punctuation does not decide it", wordsAppearIn("renewal.", "chase the renewal, today"));
    ok("a word that is only a substring does not count", !wordsAppearIn("new", "chase the renewal"));
    ok("a missing word fails the whole phrase", !wordsAppearIn("Acme contract", "chase the Acme renewal"));
    ok("empty phrases are never grounded", !wordsAppearIn("", "anything") && !wordsAppearIn("x", ""));
  }

  // ---------- records ----------
  {
    const c = newCapture({ id: "c1", text: "  book the flights  ", entry: "spoken", now: "2026-09-08T10:00:00.000Z" });
    ok("a new capture is saveable before any model has seen it", c.text === "book the flights" && c.title === "book the flights");
    ok("a new capture starts as an unfiled note", c.kind === "note" && c.spaceId === undefined);
    ok("a new capture remembers how it was made", c.entry === "spoken");
    ok("a new capture is not yet a guess anybody should be shown", !kindIsGuess(c) && !spaceIsGuess(c));

    const routed = applyRouting(c, {
      kind: "task", spaceId: "s-acme", title: "book the flights", kindSource: "inferred",
      spaceSource: "inferred", kindConfidence: 0.9, spaceConfidence: 0.8, spaceEvidence: "book the flights",
    }, "2026-09-08T10:00:05.000Z");
    ok("routing applies the model's kind", routed.kind === "task");
    ok("routing applies the model's space", routed.spaceId === "s-acme");
    ok("a filed guess is shown as a guess", spaceIsGuess(routed) && kindIsGuess(routed));
    ok("routing stamps the edit", routed.updatedAt === "2026-09-08T10:00:05.000Z");

    // A person's decision must survive a later pass.
    const mine = setKind(setSpace(routed, "s-hiring"), "note");
    const reRouted = applyRouting(mine, {
      kind: "task", spaceId: "s-acme", title: "something else", kindSource: "inferred",
      spaceSource: "inferred", kindConfidence: 0.99, spaceConfidence: 0.99, spaceEvidence: "book the flights",
    });
    ok("a later pass does not undo a person's kind", reRouted.kind === "note");
    ok("a later pass does not undo a person's filing", reRouted.spaceId === "s-hiring");
    ok("a person's decision is never shown as a guess", !spaceIsGuess(mine) && !kindIsGuess(mine));

    // A renamed capture keeps its name.
    const renamed = applyRouting({ ...c, title: "Flights — Berlin" }, {
      kind: "note", spaceId: null, title: "book the flights", kindSource: "inferred",
      spaceSource: "inferred", kindConfidence: 0.5, spaceConfidence: 0, spaceEvidence: "",
    });
    ok("a title somebody typed is not replaced by the model's", renamed.title === "Flights — Berlin");

    const done = setKind({ ...routed, done: true }, "note");
    ok("a note cannot be done", done.done === undefined);
    const backToTask = setKind({ ...routed, done: true }, "task");
    ok("a task keeps its done state", backToTask.done === true);

    const inbox = setSpace(routed, null);
    ok("a person can take a capture back out of a space", inbox.spaceId === undefined);
    ok("taking it out is a person's decision, not a guess", inbox.spaceSource === "user" && !spaceIsGuess(inbox));

    const unsorted = markUnsorted(c, "No on-device model.");
    ok("a capture nothing could sort says why", unsorted.unsortedReason === "No on-device model.");
    ok("an unsorted capture is still a kept note", unsorted.text === "book the flights" && unsorted.kind === "note");
    ok("sorting it later clears the reason",
      applyRouting(unsorted, unroutedCapture(unsorted.text)).unsortedReason === undefined);
  }

  // ---------- lists ----------
  {
    const items: CaptureRecord[] = [
      record({ id: "a", spaceId: "s-acme", createdAt: "2026-09-01T10:00:00.000Z" }),
      record({ id: "b", createdAt: "2026-09-02T10:00:00.000Z" }),
      record({ id: "c", spaceId: "s-acme", createdAt: "2026-09-03T10:00:00.000Z" }),
      record({ id: "d", deletedAt: "2026-09-04T10:00:00.000Z", spaceId: "s-acme" }),
    ];
    const acme = capturesInSpace(items, "s-acme");
    ok("a space lists its captures", acme.length === 2);
    ok("a space lists them newest first", acme[0].id === "c");
    ok("a deleted capture is in no list", !acme.some((c) => c.id === "d"));
    ok("the inbox is everything filed nowhere", capturesInSpace(items, null).map((c) => c.id).join() === "b");

    // A space deleted on another device must not take thoughts down with it.
    const orphaned = unfileOrphans(items, ["s-hiring"], "2026-09-05T10:00:00.000Z");
    ok("a capture whose space is gone comes back to the inbox",
      capturesInSpace(orphaned, null).length === 3);
    ok("rescuing an orphan clears the stale filing confidence",
      orphaned.every((c) => !c.spaceId ? c.spaceConfidence === 0 : true));
    const kept = unfileOrphans(items, ["s-acme"], "2026-09-05T10:00:00.000Z");
    ok("a capture whose space still exists is left alone", capturesInSpace(kept, "s-acme").length === 2);
  }

  // ---------- filing a meeting ----------
  {
    const digest = {
      title: "Acme renewal call",
      summary: ["Walked through the renewal terms.", "They want a two-year option."],
      decisions: ["Hold the price at current levels."],
      people: ["Max", "Priya"],
    };
    const text = meetingDigestText(digest);
    ok("a meeting's digest carries its title", text.includes("Acme renewal call"));
    ok("a meeting's digest carries who was there", text.includes("Max") && text.includes("Priya"));
    ok("a meeting's digest carries what it decided", text.includes("Hold the price"));
    ok("a meeting's digest is not the transcript", text.length < 400, `${text.length}`);

    const msgs = buildMeetingSpaceMessages(digest, SPACES);
    ok("the meeting prompt offers the spaces", msgs[1].content.includes('"Acme"'));
    ok("the meeting prompt carries the digest", msgs[1].content.includes("Acme renewal call"));

    const filed = validateMeetingSpace(
      verdict({ spaceName: "Acme", spaceConfidence: 0.9, spaceEvidence: "Acme renewal call" }),
      { digest, spaces: SPACES });
    ok("a meeting is filed into a space it is plainly about", filed.spaceId === "s-acme");

    const fabricated = validateMeetingSpace(
      verdict({ spaceName: "Hiring", spaceConfidence: 0.95, spaceEvidence: "the backend candidate" }),
      { digest, spaces: SPACES });
    ok("a meeting whose evidence is not in the digest stays unfiled", fabricated.spaceId === null);

    const unsure = validateMeetingSpace(
      verdict({ spaceName: "Acme", spaceConfidence: 0.4, spaceEvidence: "Acme renewal call" }),
      { digest, spaces: SPACES });
    ok("an unsure meeting stays unfiled", unsure.spaceId === null);
  }
}
