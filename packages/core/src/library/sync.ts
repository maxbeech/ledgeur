// Syncing a local meeting to the cloud, and back.
//
// The mapping is pure and lives here so it can be tested exhaustively without a
// database — including the one property that a comment could not enforce:
//
//   **Voice prints are never uploaded.**
//
// A voice print identifies a person even after the transcript is deleted, so it
// is the most sensitive thing this product holds, and the privacy notice says
// plainly that it stays on the device that heard the voice. `toRemoteSpeakers`
// is the only path from a local meeting to the wire, it drops `embedding`, and a
// test asserts no serialised payload ever contains one.
//
// Cloud rows and local meetings are deliberately close in shape — the schema was
// written to model exactly what diarization produces — so this is a field-level
// copy rather than a translation layer that can drift.

import type { AttributedSegment } from "../diarize/types.ts";
import { defaultSpeakerLabel } from "../diarize/voiceprints.ts";
import type { LocalMeeting, StoredSpeaker } from "./meeting.ts";
import { transcriptText } from "./meeting.ts";

/** A `speakers` row, as inserted. No embedding — see the note above. */
export interface RemoteSpeaker {
  label: string;
  /** The name a person typed, when they typed one. "Speaker 2" is not a name. */
  identified_name: string | null;
  /** Only meaningful alongside an identified name. */
  identity_confidence: number | null;
}

/** A `transcript_segments` row, less the speaker id, which is assigned after the
 *  speaker rows come back with their generated ids. */
export interface RemoteSegment {
  /** Index into the speakers array, resolved to a uuid by the caller. */
  speakerIndex: number | null;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number | null;
}

export interface RemoteMeeting {
  title: string;
  status: "complete";
  started_at: string | null;
  ended_at: string | null;
  lang: string;
}

export interface RemoteNote {
  summary: string[];
  decisions: string[];
  questions: string[];
  markdown: string;
  generator: string;
  word_count: number;
}

/**
 * The speakers, ready to insert.
 *
 * `identified_name` is set only when a person actually named the voice. A
 * generated "Speaker 2" is a placeholder, and storing it as an identity would
 * make every meeting look like it had recognised somebody called Speaker 2.
 */
export function toRemoteSpeakers(speakers: readonly StoredSpeaker[]): RemoteSpeaker[] {
  return [...speakers]
    .sort((a, b) => a.speaker - b.speaker)
    .map((s) => {
      const named = s.label.trim() !== "" && s.label !== defaultSpeakerLabel(s.speaker);
      return {
        label: s.label,
        identified_name: named ? s.label : null,
        identity_confidence: named ? s.confidence : null,
        // `embedding` is deliberately absent. Do not add it.
      };
    });
}

/** The transcript, ready to insert once speaker ids exist. */
export function toRemoteSegments(
  segments: readonly AttributedSegment[],
  speakers: readonly StoredSpeaker[],
): RemoteSegment[] {
  // The order `toRemoteSpeakers` produced, so an index into it is stable.
  const order = [...speakers].sort((a, b) => a.speaker - b.speaker).map((s) => s.speaker);
  return segments.map((segment) => ({
    speakerIndex: segment.speaker == null ? null : (order.indexOf(segment.speaker) >= 0 ? order.indexOf(segment.speaker) : null),
    start_ms: segment.startMs,
    end_ms: segment.endMs,
    text: segment.text,
    confidence: segment.confidence,
  }));
}

export function toRemoteMeeting(meeting: LocalMeeting): RemoteMeeting {
  return {
    title: meeting.title || "Untitled meeting",
    status: "complete",
    started_at: meeting.startedAt,
    ended_at: meeting.endedAt,
    lang: meeting.lang,
  };
}

export function toRemoteNote(meeting: LocalMeeting, markdown: string): RemoteNote {
  const notes = meeting.notes;
  return {
    summary: notes?.summary ? [...notes.summary] : [],
    decisions: notes?.decisions ? [...notes.decisions] : [],
    questions: notes?.questions ? [...notes.questions] : [],
    markdown,
    generator: "local",
    word_count: notes?.wordCount ?? transcriptText(meeting).split(/\s+/).filter(Boolean).length,
  };
}

/** The action items, which are their own table. */
export function toRemoteActionItems(meeting: LocalMeeting): string[] {
  return meeting.notes?.actionItems ? [...meeting.notes.actionItems] : [];
}

/**
 * Everything a push needs, assembled in one place so a caller cannot forget a
 * table — and so the "no embeddings" property is provable by serialising this
 * one object.
 */
export interface SyncPayload {
  meeting: RemoteMeeting;
  speakers: RemoteSpeaker[];
  segments: RemoteSegment[];
  note: RemoteNote;
  actionItems: string[];
}

export function toSyncPayload(meeting: LocalMeeting, markdown: string): SyncPayload {
  return {
    meeting: toRemoteMeeting(meeting),
    speakers: toRemoteSpeakers(meeting.speakers),
    segments: toRemoteSegments(meeting.segments, meeting.speakers),
    note: toRemoteNote(meeting, markdown),
    actionItems: toRemoteActionItems(meeting),
  };
}
