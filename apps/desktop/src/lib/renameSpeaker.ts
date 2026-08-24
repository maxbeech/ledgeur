// Naming a voice, from a saved meeting.
//
// The moment the product earns its keep, so it does two things at once: it
// changes the label throughout this meeting, and it saves the voice print under
// that name so the next meeting recognises the person without being asked.
//
// The app stores segments by label rather than by cluster index — it predates
// clustering — so the "speaker" being renamed is identified by its old label.
// That is why every rename must update `speakers` and `segments` together: they
// are joined on that string.

import { enrollProfileFromEmbedding } from "./voiceProfiles.ts";
import type { LocalMeeting } from "./meetingsStore.ts";

export interface RenameResult {
  meeting: LocalMeeting;
  /** Set when the label changed but the voice could not be remembered. The
   *  rename still stands — losing the memory is smaller than losing the edit. */
  rememberError: string;
}

export async function renameSpeakerInMeeting(
  meeting: LocalMeeting,
  previousLabel: string,
  name: string,
): Promise<RenameResult> {
  const label = name.trim();
  if (!label || label === previousLabel) return { meeting, rememberError: "" };

  const speaker = meeting.speakers?.find((s) => s.label === previousLabel);
  let rememberError = "";

  if (speaker?.embedding?.length) {
    try {
      await enrollProfileFromEmbedding(label, speaker.embedding);
    } catch (e) {
      rememberError = `The name was applied, but the voice print could not be saved, so ${label} will not be recognised automatically next time. (${e instanceof Error ? e.message : String(e)})`;
    }
  } else if (meeting.speakers?.length) {
    rememberError = `The name was applied to this transcript. This meeting has no stored voice print for ${previousLabel}, so it cannot teach Ledgeur that voice — enrol them under Integrations, Voice profiles.`;
  }

  return {
    meeting: {
      ...meeting,
      // A hand-typed name is not a guess, so the confidence figure goes.
      speakers: meeting.speakers?.map((s) =>
        s.label === previousLabel ? { ...s, label, confidence: null } : s),
      segments: meeting.segments.map((s) =>
        s.speakerLabel === previousLabel ? { ...s, speakerLabel: label, speakerConfidence: null } : s),
    },
    rememberError,
  };
}
