// Naming a voice, and correcting a name.
//
// Diarization alone gives you "Speaker 1" and "Speaker 2" — useful once, and
// then useless, because next Tuesday's Speaker 1 is a different person. What
// makes it a product is that naming a voice *once* is enough: the voice is
// stored under that name, and every later meeting is matched against it before
// the transcript is ever shown.
//
// The app stores segments by label rather than by cluster index — it predates
// clustering — so the "speaker" being renamed is identified by its old label.
// That is why every rename must update `speakers` and `segments` together: they
// are joined on that string.
//
// ── Correcting a guess is not the same as naming a voice ────────────────────
// Since names can now be inferred from the conversation (speakerNames.ts), a
// label may be something the app decided rather than something a person typed.
// Correcting one of those has to undo what the guess taught: an auto-enrolled
// voice print that survives its own correction goes on applying the wrong name
// to every future meeting, and the correction achieves nothing but a tidier
// transcript for one afternoon.

import { forgetAutoEnrolment, rememberSpeaker } from "./speakerNames.ts";
import { defaultSpeakerLabel } from "@ledgeur/core";
import type { LocalMeeting, LocalSpeaker } from "./meetingsStore.ts";

export interface RenameResult {
  meeting: LocalMeeting;
  /** Set when the label changed but the voice could not be remembered. The
   *  rename still stands — losing the memory is smaller than losing the edit. */
  rememberError: string;
}

/** Was this name the app's idea rather than a person's? */
export const isGuessedSpeaker = (s: LocalSpeaker | undefined): boolean =>
  s?.nameSource === "inferred";

/**
 * Name a voice throughout a meeting, and teach the app that voice.
 *
 * When the previous name was a guess, its voice print is removed first, so the
 * correction replaces what the guess taught rather than sitting alongside it.
 */
export async function renameSpeakerInMeeting(
  meeting: LocalMeeting,
  previousLabel: string,
  name: string,
): Promise<RenameResult> {
  const label = name.trim();
  if (!label || label === previousLabel) return { meeting, rememberError: "" };

  const speaker = meeting.speakers?.find((s) => s.label === previousLabel);
  let rememberError = "";
  let profileId: string | undefined;

  // Un-teach a wrong guess before teaching the right answer.
  if (speaker?.profileId && isGuessedSpeaker(speaker)) await forgetAutoEnrolment(speaker.profileId);

  if (speaker?.voiceSample || speaker?.embedding?.length) {
    try {
      profileId = await rememberSpeaker(speaker, label);
    } catch (e) {
      rememberError = `The name was applied, but the voice print could not be saved, so ${label} will not be recognised automatically next time. (${e instanceof Error ? e.message : String(e)})`;
    }
  } else if (meeting.speakers?.length) {
    rememberError = `The name was applied to this transcript. This meeting kept no voice sample for ${previousLabel}, so it cannot teach Ledgeur that voice — enrol them under Integrations, Voice profiles.`;
  }

  return {
    meeting: {
      ...meeting,
      // A hand-typed name is not a guess, so the confidence figure and the
      // evidence behind the guess both go.
      speakers: meeting.speakers?.map((s) =>
        s.label === previousLabel
          ? {
            ...s, label, confidence: null, nameSource: "user" as const,
            nameEvidence: undefined,
            ...(profileId ? { profileId } : { profileId: undefined }),
          }
          : s),
      segments: meeting.segments.map((s) =>
        s.speakerLabel === previousLabel ? { ...s, speakerLabel: label, speakerConfidence: null } : s),
    },
    rememberError,
  };
}

/**
 * Reject a guessed name without offering one of your own.
 *
 * "That is not Max, and I am not going to tell you who it is" has to be
 * expressible, or the only way out of a wrong guess is a second guess. The
 * voice goes back to being a number and the print the guess taught is removed.
 */
export async function rejectSpeakerGuess(
  meeting: LocalMeeting,
  label: string,
): Promise<LocalMeeting> {
  const speaker = meeting.speakers?.find((s) => s.label === label);
  if (speaker?.profileId && isGuessedSpeaker(speaker)) await forgetAutoEnrolment(speaker.profileId);

  // Back to the lowest number not already taken by another voice in this
  // meeting, so two rejected guesses do not both become "Speaker 1".
  const taken = new Set((meeting.speakers ?? []).filter((s) => s.label !== label).map((s) => s.label));
  let index = 0;
  while (taken.has(defaultSpeakerLabel(index))) index++;
  const placeholder = defaultSpeakerLabel(index);

  return {
    ...meeting,
    speakers: meeting.speakers?.map((s) =>
      s.label === label
        ? { ...s, label: placeholder, confidence: null, nameSource: undefined, nameEvidence: undefined, profileId: undefined }
        : s),
    segments: meeting.segments.map((s) =>
      s.speakerLabel === label ? { ...s, speakerLabel: placeholder, speakerConfidence: null } : s),
  };
}

/**
 * Move one line to a different speaker.
 *
 * Separate from renaming because it fixes a different mistake: the name is
 * right, but this particular sentence was attributed to the wrong person —
 * which happens at every hand-over, where two voices overlap for a second. It
 * must not touch the voice store: one misattributed line is no evidence at all
 * about what anybody sounds like, and folding it into a print would make the
 * next meeting worse.
 *
 * Speaking time moves with the line, because the directory counts it.
 */
export function reassignSegmentSpeaker(
  meeting: LocalMeeting,
  segmentId: string,
  toLabel: string,
): LocalMeeting {
  const label = toLabel.trim();
  const segment = meeting.segments.find((s) => s.id === segmentId);
  if (!label || !segment || segment.speakerLabel === label) return meeting;
  const seconds = Math.max(0, segment.endMs - segment.startMs) / 1000;
  const from = segment.speakerLabel;

  const speakers = (meeting.speakers ?? []).map((s) => {
    if (s.label === from) return { ...s, speakingSeconds: Math.max(0, s.speakingSeconds - seconds) };
    if (s.label === label) return { ...s, speakingSeconds: s.speakingSeconds + seconds };
    return s;
  });
  // Moving a line to somebody this meeting has no record of — a name typed on
  // the spot — still has to produce a speaker, or the name appears in the
  // transcript and nowhere else, and the header stops matching the lines.
  if (label && !speakers.some((s) => s.label === label)) {
    speakers.push({ label, confidence: null, speakingSeconds: seconds, nameSource: "user" });
  }

  return {
    ...meeting,
    speakers: speakers.length ? speakers : meeting.speakers,
    segments: meeting.segments.map((s) =>
      // A person moved this line by hand, so it is no longer a guess.
      s.id === segmentId ? { ...s, speakerLabel: label, speakerConfidence: null } : s),
  };
}

/**
 * Accept a guessed name as correct.
 *
 * One click, and the name stops being shown as a guess. If the guess was not
 * confident enough to have been enrolled at the time, confirming it enrols the
 * voice now — which is the whole point of confirming rather than ignoring it.
 */
export async function confirmSpeakerGuess(
  meeting: LocalMeeting,
  label: string,
): Promise<RenameResult> {
  const speaker = meeting.speakers?.find((s) => s.label === label);
  if (!speaker) return { meeting, rememberError: "" };

  let rememberError = "";
  let profileId = speaker.profileId;
  if (!profileId && (speaker.voiceSample || speaker.embedding?.length)) {
    try {
      profileId = await rememberSpeaker(speaker, label);
    } catch (e) {
      rememberError = `${label} was confirmed on this transcript, but the voice print could not be saved, so they will not be recognised automatically next time. (${e instanceof Error ? e.message : String(e)})`;
    }
  }

  return {
    meeting: {
      ...meeting,
      speakers: meeting.speakers?.map((s) =>
        s.label === label
          ? { ...s, confidence: null, nameSource: "user" as const, nameEvidence: undefined, ...(profileId ? { profileId } : {}) }
          : s),
      segments: meeting.segments.map((s) =>
        s.speakerLabel === label ? { ...s, speakerConfidence: null } : s),
    },
    rememberError,
  };
}
