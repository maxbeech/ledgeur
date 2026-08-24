// A meeting, and the pure operations on one: naming it, searching it, renaming
// a speaker, turning it into Markdown.
//
// No storage and no DOM — storage lives in ../browser/library.ts, which is a
// thin IndexedDB shell around these shapes. Keeping the logic here means every
// rule below is unit-tested without a browser.

import type { AttributedSegment } from "../diarize/types.ts";
import type { MeetingNotes } from "../notes/summarize.ts";
import { formatOffset } from "../diarize/turns.ts";
import { defaultSpeakerLabel } from "../diarize/voiceprints.ts";

/** A named voice inside one meeting. `profileId` links to a remembered voice,
 *  which is what makes the name reappear in the next meeting. */
export interface StoredSpeaker {
  /** Cluster index within this meeting — what `AttributedSegment.speaker` holds. */
  speaker: number;
  label: string;
  profileId: string | null;
  /** 0..1 similarity when the label came from a match; null when the user typed
   *  it or it is still "Speaker N". A number means "we guessed". */
  confidence: number | null;
  speakingSeconds: number;
  /**
   * This voice's mean vector for this meeting.
   *
   * Kept so that naming a speaker *later* — a week after the recording, from
   * the library — can still save a voice print. Without it, "who is this?"
   * would only be answerable while the audio was still in memory, which is the
   * one moment the user is least likely to care.
   *
   * NEVER synced. `toRemoteSpeaker` in the sync layer drops it, and a test
   * asserts that: a voice print identifies a person even after the transcript
   * is deleted, so it stays on the device that heard the voice.
   */
  embedding?: number[];
}

export type MeetingSource = "recording" | "import";

export interface LocalMeeting {
  id: string;
  title: string;
  /** ISO-8601. */
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  lang: string;
  source: MeetingSource;
  /** Original filename for an imported recording, so the library says where it
   *  came from rather than pretending it was recorded in the app. */
  sourceName: string | null;
  segments: AttributedSegment[];
  speakers: StoredSpeaker[];
  notes: MeetingNotes | null;
  /** Whatever the user typed themselves. Never overwritten by a generated
   *  summary — their words outrank ours. */
  manualNotes: string;
  /** The Supabase row id once synced, else null. */
  remoteId: string | null;
  updatedAt: string;
}

/** Plain text of a whole meeting — what the summariser and search read. */
export function transcriptText(meeting: Pick<LocalMeeting, "segments">): string {
  return meeting.segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
}

/** Transcript with names and timings, for reading and for export. */
export function transcriptWithSpeakers(meeting: Pick<LocalMeeting, "segments" | "speakers">): string {
  const names = new Map(meeting.speakers.map((s) => [s.speaker, s.label]));
  return meeting.segments
    .map((s) => {
      const who = s.speaker == null ? "" : `${names.get(s.speaker) ?? defaultSpeakerLabel(s.speaker)}: `;
      return `[${formatOffset(s.startMs)}] ${who}${s.text}`;
    })
    .join("\n");
}

/**
 * A title for a meeting nobody has named.
 *
 * The first thing actually said beats a timestamp: "Right, so the pricing
 * page…" tells you what the meeting was; "Meeting 14:32" does not. Falls back
 * to the date when there are no words at all.
 */
export function deriveTitle(
  meeting: Pick<LocalMeeting, "segments" | "startedAt" | "sourceName">,
  maxLength = 60,
): string {
  const first = meeting.segments.find((s) => s.text.trim().length > 0)?.text.trim();
  if (first) {
    const clean = first.replace(/\s+/g, " ");
    if (clean.length <= maxLength) return clean;
    // Cut on a word boundary rather than mid-word.
    const cut = clean.slice(0, maxLength);
    const space = cut.lastIndexOf(" ");
    return `${(space > maxLength * 0.5 ? cut.slice(0, space) : cut).trim()}…`;
  }
  if (meeting.sourceName) return meeting.sourceName.replace(/\.[a-z0-9]+$/i, "");
  const when = new Date(meeting.startedAt);
  return Number.isNaN(when.getTime())
    ? "Untitled meeting"
    : `Meeting — ${when.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

/**
 * Rename one speaker throughout a meeting.
 *
 * Setting a name by hand clears the confidence score: the label is no longer a
 * guess, and showing "Priya · 71%" next to a name the user typed themselves
 * reads as the product doubting them.
 */
export function renameSpeaker(
  meeting: LocalMeeting,
  speaker: number,
  label: string,
  profileId: string | null = null,
): LocalMeeting {
  const name = label.trim();
  if (!name) return meeting;
  const existing = meeting.speakers.some((s) => s.speaker === speaker);
  const speakers = existing
    ? meeting.speakers.map((s) => (s.speaker === speaker ? { ...s, label: name, profileId, confidence: null } : s))
    : [...meeting.speakers, { speaker, label: name, profileId, confidence: null, speakingSeconds: 0 }];
  return { ...meeting, speakers: speakers.sort((a, b) => a.speaker - b.speaker) };
}

/**
 * Fold two speakers into one — the fix for diarization splitting one person in
 * two, which is the failure mode the clustering threshold deliberately favours.
 */
export function mergeSpeakers(meeting: LocalMeeting, from: number, into: number): LocalMeeting {
  if (from === into) return meeting;
  const source = meeting.speakers.find((s) => s.speaker === from);
  const segments = meeting.segments.map((s) => (s.speaker === from ? { ...s, speaker: into } : s));
  const speakers = meeting.speakers
    .filter((s) => s.speaker !== from)
    .map((s) => (s.speaker === into
      ? { ...s, speakingSeconds: s.speakingSeconds + (source?.speakingSeconds ?? 0) }
      : s));
  // A merge target that was never in the list (all its turns were unlabelled)
  // still needs an entry, or the transcript points at a speaker that is gone.
  if (!speakers.some((s) => s.speaker === into)) {
    speakers.push({
      speaker: into,
      label: defaultSpeakerLabel(into),
      profileId: null,
      confidence: null,
      speakingSeconds: source?.speakingSeconds ?? 0,
    });
  }
  return { ...meeting, segments, speakers: speakers.sort((a, b) => a.speaker - b.speaker) };
}

/** The label to show for a segment's speaker. */
export function speakerLabel(meeting: Pick<LocalMeeting, "speakers">, speaker: number | null): string | null {
  if (speaker == null) return null;
  return meeting.speakers.find((s) => s.speaker === speaker)?.label ?? defaultSpeakerLabel(speaker);
}

/** Where a search term appears in a meeting, with enough text around it to read. */
export interface SearchHit {
  meetingId: string;
  title: string;
  startedAt: string;
  /** Millisecond offset of the matching segment, for a "jump to" link. */
  startMs: number;
  speaker: string | null;
  /** The matching text with a little context either side. */
  excerpt: string;
}

/**
 * Search the local library, in memory.
 *
 * Distinct from `searchMeetings` in ../data/repository.ts, which asks Supabase
 * about the org's shared meetings. This one never leaves the device.
 *
 * Plain case-insensitive substring matching over segment text, titles and
 * speaker names. Deliberately not fuzzy: a meeting search that returns
 * near-misses makes the user doubt whether the exact thing they remember was
 * ever said, which is the opposite of what a record is for.
 */
export function searchLibrary(
  meetings: readonly LocalMeeting[],
  query: string,
  options: { limit?: number; contextChars?: number } = {},
): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const limit = options.limit ?? 50;
  const context = options.contextChars ?? 60;
  const hits: SearchHit[] = [];

  for (const meeting of meetings) {
    const titleMatch = meeting.title.toLowerCase().includes(needle);
    let found = false;

    for (const segment of meeting.segments) {
      const at = segment.text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      found = true;
      const from = Math.max(0, at - context);
      const to = Math.min(segment.text.length, at + needle.length + context);
      hits.push({
        meetingId: meeting.id,
        title: meeting.title,
        startedAt: meeting.startedAt,
        startMs: segment.startMs,
        speaker: speakerLabel(meeting, segment.speaker),
        excerpt: `${from > 0 ? "…" : ""}${segment.text.slice(from, to)}${to < segment.text.length ? "…" : ""}`,
      });
      if (hits.length >= limit) return hits;
    }

    // A title-only match is still a result — the user may be looking for the
    // meeting, not for a phrase inside it.
    if (titleMatch && !found) {
      hits.push({
        meetingId: meeting.id,
        title: meeting.title,
        startedAt: meeting.startedAt,
        startMs: 0,
        speaker: null,
        excerpt: meeting.segments[0]?.text.slice(0, context * 2) ?? "",
      });
      if (hits.length >= limit) return hits;
    }
  }

  return hits;
}

/** Who talked, and for how long — the one meeting statistic people act on. */
export function speakingShare(meeting: Pick<LocalMeeting, "speakers">): { label: string; seconds: number; share: number }[] {
  const total = meeting.speakers.reduce((sum, s) => sum + s.speakingSeconds, 0);
  if (total <= 0) return [];
  return [...meeting.speakers]
    .sort((a, b) => b.speakingSeconds - a.speakingSeconds)
    .map((s) => ({ label: s.label, seconds: s.speakingSeconds, share: s.speakingSeconds / total }));
}

/** The whole meeting as a Markdown document — the export everything else
 *  (clipboard, .md file, Notion) is built from. */
export function meetingToMarkdown(meeting: LocalMeeting): string {
  const when = new Date(meeting.startedAt);
  const date = Number.isNaN(when.getTime()) ? "" : when.toLocaleString();
  const parts = [`# ${meeting.title}`, ""];
  if (date) parts.push(`_${date} · ${formatOffset(meeting.durationSec * 1000)}_`, "");

  if (meeting.speakers.length > 0) {
    parts.push("## Speakers", "");
    for (const s of speakingShare(meeting)) {
      parts.push(`- **${s.label}** — ${formatOffset(s.seconds * 1000)} (${Math.round(s.share * 100)}%)`);
    }
    parts.push("");
  }

  if (meeting.manualNotes.trim()) {
    parts.push("## Your notes", "", meeting.manualNotes.trim(), "");
  }

  const notes = meeting.notes;
  if (notes) {
    const section = (title: string, items: readonly string[]) => {
      if (items.length === 0) return;
      parts.push(`## ${title}`, "");
      for (const item of items) parts.push(`- ${item}`);
      parts.push("");
    };
    section("Summary", notes.summary);
    section("Decisions", notes.decisions);
    section("Action items", notes.actionItems);
    section("Open questions", notes.questions);
  }

  parts.push("## Transcript", "", transcriptWithSpeakers(meeting), "");
  return parts.join("\n");
}

/** A filesystem-safe name for an export. */
export function exportFilename(meeting: Pick<LocalMeeting, "title" | "startedAt">, extension: string): string {
  const when = new Date(meeting.startedAt);
  const date = Number.isNaN(when.getTime()) ? "" : `${when.toISOString().slice(0, 10)}-`;
  const slug = meeting.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "meeting";
  return `${date}${slug}.${extension}`;
}
