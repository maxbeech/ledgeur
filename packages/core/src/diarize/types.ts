// Shapes shared by the diarization worker, the apps and the tests. Kept
// separate from the algorithms so a UI can import the types without pulling in
// clustering code.

/** A stretch of audio the segmentation model attributes to one voice.
 *  `speaker` is a *local* id — only meaningful inside the window it came from,
 *  which is exactly why clustering exists. Times are seconds from clip start. */
export interface RawTurn {
  start: number;
  end: number;
  /** Local speaker index within the segmentation window. */
  speaker: number;
  /** 0..1 model confidence for the frame run this turn was pooled from. */
  confidence: number;
}

/** A turn after global clustering: `speaker` is now stable for the whole clip. */
export interface SpeakerTurn {
  start: number;
  end: number;
  /** Stable 0-based cluster index for this clip. */
  speaker: number;
  confidence: number;
}

/** One ASR result with timing, as Whisper returns it when asked for timestamps. */
export interface AsrChunk {
  text: string;
  /** Seconds from clip start. Whisper can return a null end on the last chunk. */
  start: number;
  end: number | null;
}

/** The finished article: text with a speaker attached. Mirrors the
 *  `transcript_segments` table (start_ms / end_ms / speaker / text). */
export interface AttributedSegment {
  startMs: number;
  endMs: number;
  text: string;
  /** Stable cluster index, or null when nothing overlapped this text. */
  speaker: number | null;
  confidence: number | null;
}

/** A remembered voice. `embedding` is an L2-normalised speaker vector; `samples`
 *  counts how many meetings have contributed, so the centroid can be updated as
 *  a running mean rather than being overwritten by the newest (possibly worst)
 *  recording. */
export interface VoiceProfile {
  id: string;
  name: string;
  embedding: number[];
  samples: number;
  createdAt: string;
  updatedAt: string;
}

/** What a diarized clip knows about one of its speakers. */
export interface SpeakerSummary {
  /** Stable cluster index for this clip. */
  speaker: number;
  /** Display label — a matched profile's name, else "Speaker N". */
  label: string;
  /** Set when a saved voice profile matched. */
  profileId: string | null;
  /** 0..1 cosine similarity of the match, null when unmatched. */
  confidence: number | null;
  /** Mean embedding across this speaker's turns, L2-normalised. */
  embedding: number[];
  /** Total seconds this speaker held the floor. */
  speakingSeconds: number;
}
