// Working out what a thought was, and where it belongs.
//
// A capture is whatever somebody said or typed into the box in the four seconds
// they had before the thought went: "chase Priya about the SOC2 letter", "idea:
// let people name a voice from the library", "we agreed to hold the price".
// Two questions follow, and neither should be asked of the person:
//
//   1. Is that a TASK (something they intend to do) or a NOTE (something they
//      want kept)? The Tasks screen is only useful if it holds things that are
//      actually going to be done.
//   2. Which space is it about? A capture filed into "Acme" is findable next to
//      the meeting it came out of; an unfiled one is findable only by search.
//
// ── Pure on purpose ─────────────────────────────────────────────────────────
// Prompt, parser, validator and the routing decision are all here and all pure,
// so the part that matters — what gets *rejected* — is tested without a model.
// The impure half is a few lines in the app (apps/desktop/src/lib/routeCapture.ts).
//
// ── The capture is never the thing at risk ──────────────────────────────────
// Classification decides where a capture is filed, never whether it is kept.
// A capture with no model to ask, or one the model was unsure about, is saved
// unchanged and lands in the inbox as a note. Losing a thought because a 1.5B
// model was having a bad day would defeat the entire feature.
//
// ── Nothing here guesses without the model ──────────────────────────────────
// There is deliberately no keyword list that calls anything starting with a verb
// a task. "Remember that Priya prefers async reviews" starts with a verb and is
// not a task; "the SOC2 letter" is a task the moment it is said in the right
// tone. Patterns cannot tell those apart, and a Tasks screen full of things
// nobody meant to do is worse than one that missed a few. The model decides;
// everything below only checks its homework.

/** What a capture turned out to be. */
export type CaptureKind = "task" | "note";

/** Where a capture's kind or space came from. Drives what the UI admits to. */
export type CaptureSource =
  /** The model worked it out. Always shown as a guess, one tap to change. */
  | "inferred"
  /** A person chose it. Never questioned, never re-guessed. */
  | "user";

/**
 * How sure the model must be before a capture becomes a task.
 *
 * The two mistakes are not equal. A task filed as a note sits in the inbox
 * where its author will see it — mildly annoying. A note filed as a task joins
 * the list of things the person believes they have committed to, and the whole
 * value of that list is that everything on it is real. So `note` is the
 * default, and `task` is the claim that has to be earned.
 *
 * 0.65 rather than the 0.75 names.ts uses for a name: the evidence here is the
 * entire capture rather than one line of a long transcript, and the cost of
 * being wrong is a tap, not a wrong name on a permanent record.
 */
export const TASK_BELIEF = 0.65;

/**
 * How sure the model must be before a capture is filed into a space.
 *
 * Higher than {@link TASK_BELIEF}, because being unfiled is a perfectly good
 * answer and being in the wrong space is worse than being in none: a capture in
 * the inbox is on the way somewhere, while one filed confidently into "Acme"
 * when it was about hiring is, in practice, lost — nobody looks in Acme for it
 * and nobody checks the inbox because it is empty.
 */
export const SPACE_BELIEF = 0.7;

/** A space the model is allowed to choose from. Never invented — see below. */
export interface SpaceOption {
  id: string;
  name: string;
}

/** What the model claims about one capture, before any of it is believed. */
export interface CaptureVerdict {
  kind: CaptureKind | "";
  /** 0..1, the model's own belief that this is a task. */
  kindConfidence: number;
  /** The space's *name*, as offered. Resolved to an id during validation, so a
   *  model that echoes a plausible-looking id it invented gets nowhere. */
  spaceName: string;
  spaceConfidence: number;
  /** The words from the capture that made it choose that space. Verified to
   *  actually appear — this is what stops "it's about the Acme renewal" being
   *  offered for a capture that never mentions Acme or a renewal. */
  spaceEvidence: string;
  /** A short title for a task, in the person's own words. Optional. */
  title: string;
}

/** What the app should actually do with the capture. */
export interface CaptureRouting {
  kind: CaptureKind;
  /** The space to file it in, or null for the inbox. */
  spaceId: string | null;
  /** The title to show. The capture's own text unless a tidier one survived. */
  title: string;
  /** Only set when the model decided it, so the UI can mark it as a guess. */
  kindSource: CaptureSource;
  spaceSource: CaptureSource;
  kindConfidence: number;
  spaceConfidence: number;
  /** The quote behind a guessed space, shown so "why there?" is answerable. */
  spaceEvidence: string;
}

/** The routing for a capture nothing could be decided about: kept, unfiled, a
 *  note, and honest about it. The state a capture is saved in before the model
 *  answers, and the state it stays in when there is no model to ask. */
export function unroutedCapture(text: string): CaptureRouting {
  return {
    kind: "note", spaceId: null, title: text.trim(),
    kindSource: "inferred", spaceSource: "inferred",
    kindConfidence: 0, spaceConfidence: 0, spaceEvidence: "",
  };
}

/* ------------------------------------------------------------------ prompt */

/**
 * Chars of capture text sent to the model.
 *
 * A capture is a thought, not a document — the longest real ones are a spoken
 * paragraph. The cap exists so that pasting an email into the box cannot turn a
 * sub-second classification into a thirty-second one while somebody waits to
 * see where their thought went.
 */
export const CAPTURE_BUDGET = 4_000;

/**
 * The instructions.
 *
 * Written against what a small model actually does wrong here:
 *
 *   · calling everything a task, because captures are short and imperative;
 *   · filing every capture into the space with the most familiar name;
 *   · inventing a space that "should" exist ("Personal", "Work") when none of
 *     the offered ones fit;
 *   · rewriting the person's thought into a tidier sentence they never said;
 *   · answering with prose around the JSON.
 *
 * `space_evidence` is not decoration: it is checked against the capture (see
 * {@link validateCapture}), so a model that cannot point at the words it read
 * has its filing thrown away and the capture goes to the inbox instead.
 */
export const CAPTURE_SYSTEM =
  "You sort one short thought a person just captured.\n\n" +
  "Decide two things.\n\n" +
  "1. KIND — is it a task or a note?\n" +
  "   - `task`: something the person intends to DO. \"chase Priya about the letter\", " +
  "\"book the flights\", \"reply to Sam by Friday\".\n" +
  "   - `note`: something they want KEPT. An idea, a fact, a decision, an observation, " +
  "a reminder of how something works. \"Priya prefers async reviews\", " +
  "\"idea: name a voice from the library\", \"we agreed to hold the price\".\n" +
  "   - If it is genuinely both, or you cannot tell, it is a `note`. A wrong task " +
  "pollutes a list the person has to trust.\n\n" +
  "2. SPACE — which of the offered spaces is it about?\n" +
  "   - Choose the name of ONE of the spaces listed, copied exactly.\n" +
  "   - Never invent a space. If none of them fit, use \"\" (empty string). " +
  "Leaving it unfiled is a good answer and is often the right one.\n" +
  "   - `space_evidence` must be an EXACT copy of the words from the thought that " +
  "made you choose it — copy them character for character. Not a summary, and " +
  "never words the thought does not contain.\n\n" +
  "Also give `title`: a short label for the thought, using ONLY words that appear " +
  "in it. Drop filler (\"erm\", \"I need to\", \"note to self\"); never add anything. " +
  "If you cannot shorten it honestly, repeat the thought.\n\n" +
  "`kind_confidence` and `space_confidence` are your belief from 0 to 1: about 0.9 " +
  "when it is obvious, about 0.7 when it is likely, below 0.5 when you are guessing.\n\n" +
  "Reply with ONLY a JSON object of this exact shape, and nothing else:\n" +
  '{"kind": "task", "kind_confidence": 0.9, "space": "Acme", "space_confidence": 0.8, ' +
  '"space_evidence": "the Acme renewal", "title": "chase the Acme renewal"}';

/** The two messages to send. Kept with the parser so they cannot drift. */
export function buildCaptureMessages(
  text: string,
  spaces: readonly SpaceOption[],
  options: { budget?: number } = {},
): { role: "system" | "user"; content: string }[] {
  const budget = options.budget ?? CAPTURE_BUDGET;
  const trimmed = text.trim();
  const clipped = trimmed.length > budget ? `${trimmed.slice(0, budget)}…` : trimmed;
  const names = spaces.map((s) => s.name).filter(Boolean);
  return [
    { role: "system", content: CAPTURE_SYSTEM },
    {
      role: "user",
      content:
        `Spaces to choose from: ${names.length ? names.map((n) => `"${n}"`).join(", ") : "(none — leave the space empty)"}\n\n` +
        `Thought:\n${clipped}`,
    },
  ];
}

/* ----------------------------------------------------------------- parsing */

/**
 * Pull the verdict out of a model reply.
 *
 * Unlike the name parser this expects an object, not an array, and every field
 * is optional in practice: a reply that decides the kind but not the space is
 * useful and common. Missing confidences are read as zero rather than as
 * certainty — a model omitting the field is not evidence in its own favour.
 *
 * Throws only when there is no JSON object at all, which means the model
 * ignored the contract. The caller keeps the capture and files it in the inbox.
 *
 * The object is taken from anywhere in the reply, so a model that wraps its one
 * answer in an array — the shape the *other* prompt in this codebase asks for,
 * which is exactly why it happens — is understood rather than thrown away. Two
 * objects in one reply are not: that is genuinely ambiguous for a single
 * thought, and the greedy match makes it invalid JSON, which is the right
 * outcome for the wrong-looking reason and is pinned by a test.
 */
export function parseCaptureVerdict(raw: string): CaptureVerdict {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The model did not answer with a sorted thought.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("The model's answer was not valid JSON.");
  }
  const row = parsed as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  const kindRaw = str(row.kind).toLowerCase();
  return {
    kind: kindRaw === "task" || kindRaw === "note" ? kindRaw : "",
    kindConfidence: num(row.kind_confidence),
    spaceName: str(row.space),
    spaceConfidence: num(row.space_confidence),
    spaceEvidence: str(row.space_evidence),
    title: str(row.title),
  };
}

/* -------------------------------------------------------------- validation */

/** Fold to a form that survives punctuation and casing, so a quote can be found
 *  in the capture without demanding byte equality. Same rules as names.ts. */
const fold = (s: string): string =>
  s.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();

/** Does every word of `phrase` appear as a whole word in `text`? */
export function wordsAppearIn(phrase: string, text: string): boolean {
  const haystack = fold(text);
  const words = fold(phrase).split(" ").filter(Boolean);
  if (words.length === 0 || !haystack) return false;
  return words.every((w) =>
    new RegExp(`(?:^| )${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$| )`).test(haystack));
}

/** The shortest quote that can be believed. Two or three characters match
 *  almost any text, so a "quote" that short is not evidence of anything. */
const MIN_EVIDENCE = 6;

export interface ValidateCaptureOptions {
  /** Minimum belief before this becomes a task. Defaults to {@link TASK_BELIEF}. */
  taskThreshold?: number;
  /** Minimum belief before this is filed. Defaults to {@link SPACE_BELIEF}. */
  spaceThreshold?: number;
}

/**
 * Turn a claimed verdict into what the app will actually do.
 *
 * Every rejection below falls back to the safe answer rather than to nothing —
 * an unbelievable kind becomes a note, an unbelievable space becomes the inbox,
 * an unbelievable title becomes the person's own words. There is no path
 * through this function that loses the capture.
 *
 * A space is dropped when:
 *
 *  1. the model named a space that was not offered — it invented one, or
 *     hallucinated a plausible neighbour of a real name;
 *  2. its belief is under the threshold;
 *  3. the quoted evidence is too short to mean anything;
 *  4. the quoted evidence does not appear in the capture — the model read
 *     something that was never there, which is the tell for a confident filing
 *     based on nothing.
 *
 * A title is dropped when it uses words the person did not, which is the only
 * way a "tidied" title can be wrong in a way that matters.
 */
export function validateCapture(
  verdict: CaptureVerdict,
  input: { text: string; spaces: readonly SpaceOption[] },
  options: ValidateCaptureOptions = {},
): CaptureRouting {
  const text = input.text.trim();
  const taskThreshold = options.taskThreshold ?? TASK_BELIEF;
  const spaceThreshold = options.spaceThreshold ?? SPACE_BELIEF;
  const out = unroutedCapture(text);

  // ---- kind. Only "task" has to clear a bar; "note" is where we start.
  if (verdict.kind === "task" && verdict.kindConfidence >= taskThreshold) {
    out.kind = "task";
    out.kindConfidence = verdict.kindConfidence;
  } else if (verdict.kind === "note") {
    // Recorded so the UI can tell "the model looked and said note" apart from
    // "nothing has looked at this yet", which read identically before.
    out.kindConfidence = verdict.kindConfidence;
  }

  // ---- space. The name has to be one that was offered, matched on the folded
  // form so casing and a stray full stop do not lose a correct answer.
  const wanted = fold(verdict.spaceName);
  const match = wanted ? input.spaces.find((s) => fold(s.name) === wanted) : undefined;
  if (
    match
    && verdict.spaceConfidence >= spaceThreshold
    && fold(verdict.spaceEvidence).length >= MIN_EVIDENCE
    && wordsAppearIn(verdict.spaceEvidence, text)
  ) {
    out.spaceId = match.id;
    out.spaceConfidence = verdict.spaceConfidence;
    out.spaceEvidence = verdict.spaceEvidence.trim();
  }

  // ---- title. A tidier label is worth having, but only in the person's words.
  const title = verdict.title.trim();
  if (title && title.length <= 120 && wordsAppearIn(title, text)) out.title = title;

  return out;
}

/* --------------------------------------------------- a meeting's own space */

/**
 * The same question, asked of a meeting.
 *
 * A meeting arrives with far more to go on than a thought does — a title, the
 * summary, who was in the room — so it gets its own prompt rather than being
 * squeezed into the capture one. What it does *not* get is its own validator:
 * the space rules are identical, and two copies of "never invent a space" is
 * how one of them ends up not being true.
 */
export const MEETING_SPACE_SYSTEM =
  "You file one meeting into one of a person's spaces.\n\n" +
  "Rules:\n" +
  "- Choose the name of ONE of the spaces listed, copied exactly.\n" +
  "- Never invent a space. If none of them fit, use \"\" (empty string). Leaving a " +
  "meeting unfiled is a good answer — most meetings do not belong to a project.\n" +
  "- `space_evidence` must be an EXACT copy of words from the meeting below that " +
  "made you choose — character for character, never words it does not contain.\n" +
  "- `space_confidence` is your belief from 0 to 1: about 0.9 when the meeting is " +
  "plainly about that space, about 0.7 when it is likely, below 0.5 when guessing.\n\n" +
  "Reply with ONLY a JSON object of this exact shape, and nothing else:\n" +
  '{"space": "Acme", "space_confidence": 0.85, "space_evidence": "the Acme renewal call"}';

/** What a meeting offers the filing decision. Deliberately not the transcript:
 *  the title, what it concluded and who was there decide this, and sending an
 *  hour of speech to place one meeting is minutes of CPU for no better answer. */
export interface MeetingDigest {
  title: string;
  summary?: readonly string[];
  decisions?: readonly string[];
  people?: readonly string[];
}

/** The text a meeting is judged on. Also what its evidence must appear in, so
 *  the two can never disagree about what the model was shown. */
export function meetingDigestText(m: MeetingDigest): string {
  return [
    m.title,
    ...(m.people?.length ? [`In the room: ${m.people.join(", ")}`] : []),
    ...(m.summary ?? []),
    ...(m.decisions ?? []),
  ].filter((l) => l && l.trim()).join("\n");
}

export function buildMeetingSpaceMessages(
  m: MeetingDigest,
  spaces: readonly SpaceOption[],
  options: { budget?: number } = {},
): { role: "system" | "user"; content: string }[] {
  const budget = options.budget ?? CAPTURE_BUDGET;
  const digest = meetingDigestText(m);
  const clipped = digest.length > budget ? `${digest.slice(0, budget)}…` : digest;
  const names = spaces.map((s) => s.name).filter(Boolean);
  return [
    { role: "system", content: MEETING_SPACE_SYSTEM },
    {
      role: "user",
      content:
        `Spaces to choose from: ${names.length ? names.map((n) => `"${n}"`).join(", ") : "(none — leave the space empty)"}\n\n` +
        `Meeting:\n${clipped}`,
    },
  ];
}

/**
 * Which space a meeting should go in, or null.
 *
 * Runs the capture validator over the meeting's digest, so "the model may only
 * pick a space that exists, must quote something that is actually there, and
 * must be sure" is one implementation rather than two. The kind half is
 * meaningless for a meeting and is discarded.
 */
export function validateMeetingSpace(
  verdict: CaptureVerdict,
  input: { digest: MeetingDigest; spaces: readonly SpaceOption[] },
  options: { spaceThreshold?: number } = {},
): { spaceId: string | null; confidence: number; evidence: string } {
  const routed = validateCapture(
    { ...verdict, kind: "note", kindConfidence: 0, title: "" },
    { text: meetingDigestText(input.digest), spaces: input.spaces },
    { spaceThreshold: options.spaceThreshold },
  );
  return { spaceId: routed.spaceId, confidence: routed.spaceConfidence, evidence: routed.spaceEvidence };
}
