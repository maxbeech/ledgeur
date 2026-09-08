// Working out who "Speaker 2" is from what was said in the room.
//
// Diarization separates voices; voice prints recognise a voice the app has been
// taught. Neither helps the first time somebody joins a call — and the first
// time is exactly when the transcript is least useful, because it reads as a
// conversation between numbers. But meetings routinely say who is present:
//
//     Speaker 1: Hi, I'm Max, I run product here.      ← self-introduction
//     Speaker 2: Thanks for joining, Max.              ← names the OTHER voice
//
// A person reading that knows both names. This module lets the on-device model
// do the same, and then — because a model that is confidently wrong is worse
// than no name at all — refuses anything it cannot prove against the transcript.
//
// ── Pure on purpose ─────────────────────────────────────────────────────────
// Prompt building, parsing, validation and application are all here and all
// pure, so the hardest part (deciding what to *reject*) is unit-tested without a
// model, a browser, or a meeting. The one impure step — sending the prompt — is
// a couple of lines in the app (apps/desktop/src/lib/speakerNames.ts).
//
// ── Nothing here guesses a name by itself ───────────────────────────────────
// There is deliberately no regex that pulls "I'm X" out of a transcript. Pattern
// matching cannot tell "I'm Max" from "I'm fine", "I'm afraid not" or "I'm
// Sarah's manager", and a wrong name on a transcript is a serious error. The
// model decides; everything below only checks its homework.

import { defaultSpeakerLabel } from "./voiceprints.ts";

/** Where a speaker's displayed name came from. Drives what the UI admits to. */
export type NameSource =
  /** A saved voice print matched. */
  | "matched"
  /** The model worked it out from what was said. Always shown as a guess. */
  | "inferred"
  /** A person typed it. Never questioned in the UI. */
  | "user";

/**
 * How sure the model must be before a name is put on the transcript.
 *
 * A name is shown as a guess, is one click to change, and never overwrites
 * anything a person typed — so the cost of being wrong is an easy correction,
 * not a corrupted record. Set against that, 0.75 is where a clear
 * self-introduction ("I'm Max") and a clear direct address ("Thanks, Max"
 * answered by one voice) land, while a third-party mention ("Max said he'd
 * look at it") does not.
 */
export const NAME_BELIEF = 0.75;

/**
 * The higher bar for *teaching* the voice.
 *
 * Labelling a transcript is undone by one click. Enrolling a voice print puts a
 * name on every future meeting until somebody notices, so it demands more: in
 * practice a self-introduction, which is the only evidence that ties a name to
 * the voice actually speaking rather than to whoever it was addressed to.
 */
export const ENROL_BELIEF = 0.85;

/** A name the model proposes for one of the meeting's unnamed voices. */
export interface NameProposal {
  /** The label being replaced — always a placeholder like "Speaker 2". */
  label: string;
  /** The proposed name, exactly as it was said. */
  name: string;
  /** 0..1, the model's own belief. */
  confidence: number;
  /** The transcript line that says so. Verified to actually exist — this is
   *  what the UI shows when it admits the name was guessed. */
  evidence: string;
}

/** The minimum a line needs to be usable as evidence. */
export interface NameableLine {
  startMs: number;
  speakerLabel: string;
  text: string;
}

/** A default label like "Speaker 2" — a voice nobody has named. */
export function isPlaceholderLabel(label: string): boolean {
  return /^speaker\s*\d+$/i.test(label.trim());
}

/* ------------------------------------------------------------------ prompt */

/**
 * Chars of transcript sent for name evidence.
 *
 * Smaller than the notes budget on purpose. Introductions cluster in the first
 * minutes, and a name that only appears an hour in is usually somebody being
 * discussed rather than somebody present. Keeping the prompt short also keeps
 * this pass cheap enough to run on every meeting without the user noticing —
 * it happens between the speaker pass and the notes, both of which are slower.
 */
export const NAME_EVIDENCE_BUDGET = 7_000;

/** Share of the budget spent on the opening of the meeting. */
const HEAD_SHARE = 0.7;

const mmss = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const renderLine = (l: NameableLine): string =>
  `[${mmss(l.startMs)}] ${l.speakerLabel || "Unattributed"}: ${l.text.trim()}`;

/**
 * The slice of transcript most likely to contain introductions: the opening,
 * and then the closing (goodbyes name people too — "thanks Max, speak Friday").
 * The middle is where names are least concentrated and is dropped first, marked
 * with an ellipsis so the model is not told a shortened meeting is the whole one.
 */
export function nameEvidenceTranscript(
  lines: readonly NameableLine[],
  budget: number = NAME_EVIDENCE_BUDGET,
): string {
  const rendered = lines.map(renderLine);
  const total = rendered.reduce((n, l) => n + l.length + 1, 0);
  if (total <= budget) return rendered.join("\n");

  const headBudget = Math.round(budget * HEAD_SHARE);
  let head = 0, used = 0;
  while (head < rendered.length && used + rendered[head].length + 1 <= headBudget) {
    used += rendered[head].length + 1;
    head++;
  }
  let tail = rendered.length;
  while (tail > head && used + rendered[tail - 1].length + 1 <= budget) {
    used += rendered[tail - 1].length + 1;
    tail--;
  }
  if (tail >= rendered.length) return rendered.slice(0, head).join("\n");
  return [...rendered.slice(0, head), "…", ...rendered.slice(tail)].join("\n");
}

/**
 * The instructions.
 *
 * Written against the failure modes a small model actually produces, each of
 * which was worth a rule of its own:
 *
 *   · naming a speaker after somebody discussed in the third person
 *     ("Max said he'd look at it" → Speaker 1 becomes Max);
 *   · attaching a greeting's name to the greeter rather than the greeted
 *     ("Thanks, Max" → the thanker becomes Max — exactly backwards);
 *   · inventing a plausible name for every voice so no speaker is left out;
 *   · answering with prose around the JSON.
 *
 * The evidence field is not decoration: it is checked against the transcript
 * (see {@link validateNameProposals}), so a model that cannot point at a line
 * has its proposal thrown away. That single rule kills every invented name.
 */
export const NAME_SYSTEM =
  "You identify who is speaking in a meeting transcript. Each line is " +
  "`[time] Speaker N: what they said`.\n\n" +
  "Work out the real first name of any speaker whose name is actually said out loud. " +
  "Use only these two kinds of evidence:\n" +
  "1. A SELF-INTRODUCTION — the speaker gives their own name (\"I'm Max\", \"Max here\", " +
  "\"this is Max speaking\"). The name belongs to the person on THAT line.\n" +
  "2. A DIRECT ADDRESS — one speaker says another's name to them (\"Thanks, Max\", " +
  "\"Max, what do you think?\", \"over to you, Max\"). The name belongs to the OTHER " +
  "speaker — usually the one who replies next, or the one who just finished. Never to " +
  "the person who said it.\n\n" +
  "Rules:\n" +
  "- Never invent a name. If nobody's name is said, return an empty array.\n" +
  "- Never name a speaker after somebody who is only talked ABOUT " +
  "(\"Max said he'd send it\", \"we should ask Max\") — that person may not be in the room.\n" +
  "- Do not guess from job titles, companies, or topics.\n" +
  "- It is correct to leave most speakers unnamed. Only name the ones the transcript proves.\n" +
  "- `evidence` must be an EXACT copy of the words from one transcript line, " +
  "not a summary — copy it character for character.\n" +
  "- `confidence` is your belief from 0 to 1: about 0.95 for a clear self-introduction, " +
  "about 0.8 for a clear direct address, below 0.5 for anything you are unsure of.\n\n" +
  "Reply with ONLY a JSON array of this exact shape, and nothing else:\n" +
  '[{"speaker": "Speaker 1", "name": "Max", "confidence": 0.95, "evidence": "Hi, I\'m Max"}]';

/** The two messages to send. Kept together so prompt and parser cannot drift. */
export function buildNameInferenceMessages(
  lines: readonly NameableLine[],
  options: { budget?: number } = {},
): { role: "system" | "user"; content: string }[] {
  const unnamed = [...new Set(lines.map((l) => l.speakerLabel).filter(isPlaceholderLabel))];
  return [
    { role: "system", content: NAME_SYSTEM },
    {
      role: "user",
      content:
        `Voices still unnamed: ${unnamed.join(", ") || "none"}\n\n` +
        `Transcript:\n${nameEvidenceTranscript(lines, options.budget)}`,
    },
  ];
}

/* ------------------------------------------------------------------ parsing */

/**
 * Pull proposals out of a model reply.
 *
 * An empty array is a valid, common and *correct* answer — most meetings never
 * say anybody's name — so unlike {@link import("../notes/suggest.ts").parseSuggestions}
 * this does not throw on "nothing found". It throws only when the reply
 * contains no JSON array at all, which means the model ignored the contract and
 * the caller should say so rather than quietly report "no names found".
 */
export function parseNameProposals(raw: string): NameProposal[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("The model did not answer with a list of speakers.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("The model's answer was not valid JSON.");
  }
  if (!Array.isArray(parsed)) throw new Error("The model's answer was not a list.");

  const out: NameProposal[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const label = typeof row.speaker === "string" ? row.speaker.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const evidence = typeof row.evidence === "string" ? row.evidence.trim() : "";
    // A missing confidence is treated as no confidence rather than as certainty:
    // the model omitting the field is not evidence in the name's favour.
    const confidence = typeof row.confidence === "number" && Number.isFinite(row.confidence)
      ? Math.min(1, Math.max(0, row.confidence))
      : 0;
    if (!label || !name) continue;
    out.push({ label, name, confidence, evidence });
  }
  return out;
}

/* --------------------------------------------------------------- validation */

/**
 * Capitalised words that are not names, however confidently a small model
 * offers them. Sentence-initial words dominate: a model that has decided
 * Speaker 2 must be called something reaches for the first capital it sees.
 *
 * Deliberately short. This is a backstop behind the grounding checks, not the
 * mechanism — the real defence is that a name must be spoken in the transcript
 * and the evidence line must exist.
 */
const NOT_NAMES = new Set([
  "speaker", "unknown", "unnamed", "anonymous", "everyone", "everybody", "all",
  "team", "guys", "folks", "people", "person", "someone", "somebody", "nobody",
  "hi", "hey", "hello", "morning", "afternoon", "evening", "thanks", "thank",
  "yes", "no", "yeah", "yep", "nope", "ok", "okay", "right", "sure", "well",
  "so", "and", "but", "the", "that", "this", "there", "here", "sorry", "great",
  "good", "cool", "perfect", "exactly", "actually", "anyway", "alright",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "today", "tomorrow",
  "me", "you", "us", "them", "him", "her", "it", "i",
]);

/**
 * Does this read as a personal name?
 *
 * One to three capitalised words of letters, hyphens and apostrophes. Anything
 * with a digit, a symbol or a lowercase first letter is not somebody's name,
 * and neither is a common word that happens to be capitalised.
 */
export function looksLikeName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 48) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 3) return false;
  for (const word of words) {
    if (!/^\p{Lu}[\p{L}'’.-]*$/u.test(word)) return false;
    if (NOT_NAMES.has(word.toLowerCase().replace(/[.'’-]/g, ""))) return false;
  }
  return true;
}

/** Fold to a form that survives punctuation and casing differences, so a quote
 *  can be found in the transcript without demanding byte equality. */
const fold = (s: string): string =>
  s.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();

/** Is `name` actually a word somebody said, rather than one the model produced?
 *  Both sides are folded, so punctuation and casing never decide it. */
export function spokenInTranscript(name: string, text: string): boolean {
  const haystack = fold(text);
  const words = fold(name).split(" ").filter(Boolean);
  if (words.length === 0 || !haystack) return false;
  // Every word of the name has to appear as a whole word. A surname the
  // transcript never contains means the model padded the name out.
  return words.every((w) => new RegExp(`(?:^| )${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$| )`).test(haystack));
}

export interface ValidateOptions {
  /** Minimum belief to keep. Defaults to {@link NAME_BELIEF}. */
  threshold?: number;
  /** Labels that must not be renamed — a matched voice print or a typed name is
   *  stronger evidence than anything said in the room. Placeholders only is the
   *  default, and is enforced regardless. */
  protectedLabels?: readonly string[];
}

/**
 * Keep only the proposals the transcript actually supports.
 *
 * In order, a proposal is dropped when:
 *
 *  1. it renames a voice that already has a real name (matched or typed);
 *  2. its label is not a voice in this meeting at all;
 *  3. the name does not read as a personal name;
 *  4. the name is never spoken in the transcript — the model made it up;
 *  5. the quoted evidence does not appear in any line — the model made *that* up,
 *     which in practice is the tell for a fabricated name that happens to be a
 *     real word;
 *  6. the quoted line does not contain the name it is offered as evidence for;
 *  7. its belief is under the threshold;
 *  8. a better-supported proposal already claimed the same name, or the same
 *     speaker. One name per voice, one voice per name: two speakers both called
 *     "Max" reads as a bug even when the audio is genuinely ambiguous.
 *
 * What this deliberately does NOT decide is *whose* name it is. Whether "thanks,
 * Max" names the speaker or the person they are answering is a judgement about
 * the conversation, and it belongs to the model (see {@link NAME_SYSTEM}),
 * guarded by {@link NAME_BELIEF} and by the fact that every inferred name is
 * shown as a guess with this quote attached. A validator that tried to settle it
 * with patterns would be the keyword-matching this module exists to avoid.
 */
export function validateNameProposals(
  proposals: readonly NameProposal[],
  lines: readonly NameableLine[],
  options: ValidateOptions = {},
): NameProposal[] {
  const threshold = options.threshold ?? NAME_BELIEF;
  const protectedLabels = new Set((options.protectedLabels ?? []).map((l) => l.trim().toLowerCase()));
  const labels = new Set(lines.map((l) => l.speakerLabel.trim()).filter(Boolean));
  const spoken = lines.map((l) => l.text).join(" ");
  const folded = lines.map((l) => fold(l.text));

  const kept: NameProposal[] = [];
  for (const p of proposals) {
    const label = p.label.trim();
    if (!labels.has(label)) continue;
    if (!isPlaceholderLabel(label)) continue;
    if (protectedLabels.has(label.toLowerCase())) continue;
    if (!looksLikeName(p.name)) continue;
    // A proposal that renames "Speaker 2" to "Speaker 3" is noise.
    if (isPlaceholderLabel(p.name)) continue;
    if (!spokenInTranscript(p.name, spoken)) continue;

    const quote = fold(p.evidence);
    // A short "quote" matches anything; demand enough of it to be a real line.
    if (quote.length < 6 || !folded.some((line) => line.includes(quote))) continue;
    // The cited line has to be the line that says the name. Without this a model
    // can launder an invented name through a real quote — pick any sentence,
    // attach any name, and the grounding checks above both pass because the
    // name happens to be said somewhere else in the meeting entirely.
    if (!spokenInTranscript(p.name, p.evidence)) continue;
    if (p.confidence < threshold) continue;
    kept.push({ ...p, label, name: p.name.trim() });
  }

  // Strongest evidence wins a contested name or a contested voice.
  kept.sort((a, b) => b.confidence - a.confidence);
  const takenName = new Set<string>();
  const takenLabel = new Set<string>();
  const out: NameProposal[] = [];
  for (const p of kept) {
    const key = p.name.toLowerCase();
    if (takenName.has(key) || takenLabel.has(p.label)) continue;
    takenName.add(key);
    takenLabel.add(p.label);
    out.push(p);
  }
  return out;
}

/* -------------------------------------------------------------- application */

/** The parts of a stored segment this touches. */
export interface NameableSegment {
  speakerLabel: string;
  speakerConfidence?: number | null;
}

/** The parts of a stored speaker this touches. */
export interface NameableSpeaker {
  label: string;
  confidence: number | null;
  nameSource?: NameSource;
  /** The line that led to a guessed name — shown so a person can check it. */
  nameEvidence?: string;
}

/** A speaker after naming: whatever it was, plus where the name came from. The
 *  intersection matters because a caller's own speaker type need not declare
 *  the provenance fields — applying names is what puts them there. */
export type NamedSpeaker<Spk> = Spk & { nameSource?: NameSource; nameEvidence?: string };

export interface AppliedNames<Seg, Spk> {
  segments: Seg[];
  speakers: NamedSpeaker<Spk>[];
  /** The proposals that actually changed something. */
  applied: NameProposal[];
}

/**
 * Put the names on the transcript.
 *
 * Both halves move together — segments carry the label as a string, speakers
 * carry it too, and they are joined on it — so renaming one without the other
 * silently detaches a voice print from the lines it belongs to. The guessed
 * confidence is written onto every renamed line, which is what makes the UI
 * able to say "this is a guess" line by line rather than only in the header.
 */
export function applyNameProposals<Seg extends NameableSegment, Spk extends NameableSpeaker>(
  segments: readonly Seg[],
  speakers: readonly Spk[],
  proposals: readonly NameProposal[],
): AppliedNames<Seg, Spk> {
  const byLabel = new Map(proposals.map((p) => [p.label, p]));
  if (byLabel.size === 0) return { segments: [...segments], speakers: [...speakers], applied: [] };

  const applied = new Set<string>();
  const nextSegments = segments.map((s) => {
    const p = byLabel.get(s.speakerLabel.trim());
    if (!p) return s;
    applied.add(p.label);
    return { ...s, speakerLabel: p.name, speakerConfidence: p.confidence };
  });
  const nextSpeakers: NamedSpeaker<Spk>[] = speakers.map((s) => {
    const p = byLabel.get(s.label.trim());
    if (!p) return s;
    applied.add(p.label);
    return { ...s, label: p.name, confidence: p.confidence, nameSource: "inferred" as const, nameEvidence: p.evidence };
  });

  return {
    segments: nextSegments,
    speakers: nextSpeakers,
    applied: proposals.filter((p) => applied.has(p.label)),
  };
}

/**
 * Put a voice back to being a number.
 *
 * Needed when somebody rejects a guess without offering a name of their own —
 * "that isn't Max, and I'm not going to tell you who it is" has to be
 * expressible, or the only way out of a wrong guess is a second wrong guess.
 */
export function placeholderFor(speakerIndex: number): string {
  return defaultSpeakerLabel(speakerIndex);
}
