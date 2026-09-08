// Putting names to voices from what was said in the room.
//
// The pure half — the prompt, the parser, and the validator that throws out
// anything the transcript does not support — lives in @ledgeur/core
// (diarize/names.ts) and is unit-tested there. This file is the part that
// touches the world: it sends the prompt to the on-device model, cuts the voice
// sample out of the recording, and teaches the voice store when a guess is
// strong enough to be worth remembering.
//
// ── Why this runs when the meeting ends, not while it is running ────────────
// The on-device model is a single shared engine behind one mutex (see
// src-tauri/src/ai/llm.rs), and a 1.5B model on a laptop CPU takes seconds per
// pass. Running name inference mid-meeting would sit in front of whatever the
// user is actually asking the copilot, which is the one thing in a live meeting
// that cannot wait. So it runs in the finishing pass, between separating the
// speakers and writing the notes, and can be re-run by hand from the meeting
// afterwards.
//
// ── Never a keyword fallback ────────────────────────────────────────────────
// If no model can answer, this throws and the meeting keeps "Speaker 1". It
// does not fall back to pattern-matching "I'm X" out of the transcript: that
// cannot tell "I'm Max" from "I'm afraid not", and a wrong name is worse than a
// number.

import {
  ENROL_BELIEF, MAX_SNIPPET_SECONDS, WHISPER_SAMPLE_RATE, applyNameProposals,
  buildNameInferenceMessages, chooseVoiceSnippet, isPlaceholderLabel, meetingRangeToAudio,
  parseNameProposals, sensitivityReasons, validateNameProposals,
  type AudioSpan, type NameProposal, type NameableLine, type SnippetLine,
} from "@ledgeur/core";
import { chatComplete } from "./llm.ts";
import { createLogger } from "./logger.ts";
import { enrollProfile, enrollProfileFromEmbedding, deleteProfile } from "./voiceProfiles.ts";
import type { LocalSegment, LocalSpeaker, LocalVoiceSample } from "./meetingsStore.ts";

const log = createLogger("speaker-names");

/** Below this the sample is too short to carry identity — the same three
 *  seconds the speaker models need. */
const MIN_SAMPLES = 3 * WHISPER_SAMPLE_RATE;

/**
 * How long the naming pass may take before the meeting gives up on it.
 *
 * Shorter than the notes timeout (180 s) on purpose: notes are the thing the
 * user is waiting for, names are a bonus on top. A slow machine should finish
 * the recording with numbered speakers rather than sit on "identifying
 * speakers" while the notes wait behind it.
 */
const NAME_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out.`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

const toLines = (segments: readonly LocalSegment[]): NameableLine[] =>
  segments
    .filter((s) => s.text.trim())
    .map((s) => ({ startMs: s.startMs, speakerLabel: s.speakerLabel, text: s.text }));

/**
 * Ask the on-device model who the numbered voices are.
 *
 * Returns only proposals that survived validation, so every entry is a name
 * somebody actually said, quoted from a line that actually exists, above the
 * belief threshold. An empty array is the normal answer for a meeting where
 * nobody introduced themselves — it is not a failure and must not be reported
 * as one. Throws when there is no model to ask, or when the model ignored the
 * contract; both are real failures the caller should be able to say out loud.
 */
export async function inferSpeakerNames(
  segments: readonly LocalSegment[],
  options: { signal?: AbortSignal; threshold?: number } = {},
): Promise<NameProposal[]> {
  const lines = toLines(segments);
  const unnamed = new Set(lines.map((l) => l.speakerLabel).filter(isPlaceholderLabel));
  // Nothing to name: either the meeting has no speaker separation at all, or
  // every voice is already a person. Asking the model would burn seconds to be
  // told the same thing.
  if (unnamed.size === 0 || lines.length < 2) return [];

  const raw = await withTimeout(
    chatComplete(buildNameInferenceMessages(lines), {
      // Low but not zero: at zero this model tends to repeat the first plausible
      // name across every speaker rather than leave the rest unnamed.
      temperature: 0.1,
      maxTokens: 384,
      signal: options.signal,
    }),
    NAME_TIMEOUT_MS,
    "Identifying speakers",
  );

  const proposed = parseNameProposals(raw);
  const kept = validateNameProposals(proposed, lines, { threshold: options.threshold });
  if (proposed.length !== kept.length) {
    log.info("speaker names: some proposals were not supported by the transcript", {
      proposed: proposed.length, kept: kept.length,
    });
  }
  return kept;
}

/* --------------------------------------------------------- the voice sample */

/**
 * Cut a few bland seconds of each speaker out of the recording.
 *
 * `audio` is the retained buffer, which has the silences removed, so every
 * window has to be moved back off the meeting clock before it is sliced — get
 * that wrong and the sample is whoever was talking some minutes later. See
 * `meetingRangeToAudio`.
 *
 * Speakers this finds nothing for are simply absent from the result: a person
 * who only ever said "yep" has no usable sample, and a person who spent the
 * whole meeting reading out account numbers is deliberately not kept.
 */
export function voiceSamplesFor(
  segments: readonly LocalSegment[],
  audio: Float32Array,
  spans: readonly AudioSpan[],
): Map<string, LocalVoiceSample> {
  const out = new Map<string, LocalVoiceSample>();
  if (audio.length === 0) return out;

  const lines: SnippetLine[] = segments
    .filter((s) => s.speakerLabel.trim() && s.endMs > s.startMs)
    .map((s) => ({ startMs: s.startMs, endMs: s.endMs, speakerLabel: s.speakerLabel, text: s.text }));

  for (const label of new Set(lines.map((l) => l.speakerLabel))) {
    const snippet = chooseVoiceSnippet(lines, label);
    if (!snippet) {
      log.info("no voice sample kept", {
        label,
        // Named so "why was nothing kept?" has an answer that is not "a bug".
        reasons: sensitivityReasons(lines.filter((l) => l.speakerLabel === label).map((l) => l.text).join(" ")),
      });
      continue;
    }
    const pieces = meetingRangeToAudio(spans, snippet.startMs, snippet.endMs);
    const wanted = Math.round((MAX_SNIPPET_SECONDS * WHISPER_SAMPLE_RATE));
    const pcm = new Int16Array(Math.min(wanted, Math.round(((snippet.endMs - snippet.startMs) / 1000) * WHISPER_SAMPLE_RATE)));
    let written = 0;
    for (const piece of pieces) {
      const from = Math.round((piece.atMs / 1000) * WHISPER_SAMPLE_RATE);
      const to = Math.min(audio.length, from + Math.round((piece.durationMs / 1000) * WHISPER_SAMPLE_RATE));
      for (let i = from; i < to && written < pcm.length; i++) {
        // Float -1..1 to signed 16-bit, clamped: a sample that wraps round
        // sounds like a click and drags the embedding with it.
        const v = Math.max(-1, Math.min(1, audio[i]));
        pcm[written++] = Math.round(v * 32767);
      }
    }
    if (written < MIN_SAMPLES) continue;
    out.set(label, {
      sampleRate: WHISPER_SAMPLE_RATE,
      startMs: snippet.startMs,
      endMs: snippet.endMs,
      text: snippet.text,
      sensitivity: snippet.sensitivity,
      pcm: written === pcm.length ? pcm : pcm.slice(0, written),
    });
  }
  return out;
}

/** Back to the float samples both speaker engines take. */
export function samplesFromVoiceSample(sample: LocalVoiceSample): Float32Array {
  const out = new Float32Array(sample.pcm.length);
  for (let i = 0; i < sample.pcm.length; i++) out[i] = sample.pcm[i] / 32768;
  return out;
}

/* --------------------------------------------------------------- enrolment */

/**
 * Teach the voice store that this speaker is called this.
 *
 * Two stores, two kinds of evidence, and they are not interchangeable — a
 * sherpa-onnx print means nothing to WeSpeaker and vice versa — so this hands
 * over whichever the active engine can actually use: the retained audio if
 * there is any (which is also the only thing the native engine accepts), else
 * the mean voice vector the webview path keeps on the meeting.
 *
 * Returns the profile id when one is known, so a later correction can undo it.
 */
export async function rememberSpeaker(speaker: LocalSpeaker, name: string): Promise<string> {
  if (speaker.voiceSample) {
    const profile = await enrollProfile(name, samplesFromVoiceSample(speaker.voiceSample));
    return profile.id;
  }
  if (speaker.embedding?.length) {
    return await enrollProfileFromEmbedding(name, speaker.embedding);
  }
  throw new Error(
    `This meeting kept no voice sample for ${speaker.label}, so it cannot teach Ledgeur that voice. ` +
    "Enrol them under Integrations, Voice profiles.",
  );
}

/**
 * Undo an auto-enrolment.
 *
 * Only ever called on a profile this app created from a *guess*. A guessed name
 * that is corrected must take its voice print with it, or the next meeting
 * confidently applies the same wrong name and the correction achieved nothing.
 * Failure is logged and swallowed: the correction itself matters more than the
 * tidy-up, and the user is already being told the name changed.
 */
export async function forgetAutoEnrolment(profileId: string): Promise<void> {
  try {
    await deleteProfile(profileId);
  } catch (e) {
    log.warn("could not remove the voice print left by a guessed name", e);
  }
}

/* ------------------------------------------------------------ the whole job */

export interface AutoLabelResult {
  segments: LocalSegment[];
  speakers: LocalSpeaker[];
  /** The names actually applied — for the log and for what the UI announces. */
  applied: NameProposal[];
  /** Set when the pass could not run at all (no model, timeout, bad reply).
   *  The transcript is unchanged and still correct; it just has numbers on it. */
  error: string;
}

/**
 * The finishing pass: name what can be named, keep a sample of each voice, and
 * teach the store the names we are most sure of.
 *
 * Nothing here is allowed to fail the meeting. A transcript with "Speaker 1" on
 * every line is a good transcript; losing the recording because the naming pass
 * threw would not be.
 */
export async function autoLabelSpeakers(input: {
  segments: readonly LocalSegment[];
  speakers: readonly LocalSpeaker[];
  /** The retained audio and its clock mapping, when this path kept any. */
  audio?: Float32Array;
  spans?: readonly AudioSpan[];
  signal?: AbortSignal;
}): Promise<AutoLabelResult> {
  let speakers = [...input.speakers];
  let segments = [...input.segments];

  // The sample is cut first and kept whatever the model says. It is what makes
  // naming a voice *later* — from the library, next week — actually teach the
  // app anything, which is worth having even when nobody introduced themselves.
  if (input.audio?.length) {
    const samples = voiceSamplesFor(segments, input.audio, input.spans ?? []);
    speakers = speakers.map((s) => {
      const sample = samples.get(s.label);
      return sample ? { ...s, voiceSample: sample } : s;
    });
  }

  let applied: NameProposal[] = [];
  let error = "";
  try {
    const proposals = await inferSpeakerNames(segments, { signal: input.signal });
    if (proposals.length) {
      // The sample is keyed by the old label, so enrolment has to happen while
      // the speakers still carry it — after the rename it is gone.
      const enrolled = new Map<string, string>(); // new name -> profile id
      for (const p of proposals.filter((x) => x.confidence >= ENROL_BELIEF)) {
        const speaker = speakers.find((s) => s.label === p.label);
        if (!speaker) continue;
        try {
          enrolled.set(p.name, await rememberSpeaker(speaker, p.name));
        } catch (e) {
          // Not worth reporting: the name is still applied, the sample is still
          // kept, and naming them by hand later will enrol them properly.
          log.info("a guessed name was applied but not enrolled", { label: p.label, error: String(e) });
        }
      }
      const out = applyNameProposals(segments, speakers, proposals);
      segments = out.segments;
      speakers = out.speakers.map((s) => {
        const id = enrolled.get(s.label);
        return id ? { ...s, profileId: id } : s;
      });
      applied = out.applied;
      log.info("speakers named from the conversation", {
        applied: applied.map((p) => `${p.label} → ${p.name} (${Math.round(p.confidence * 100)}%)`),
      });
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    log.warn("speaker naming did not run", e);
  }

  return { segments, speakers, applied, error };
}
