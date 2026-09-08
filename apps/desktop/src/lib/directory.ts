// The people directory, as a pure function over meetings.
//
// Derived, never entered. Ledgeur already knows who spoke in every meeting
// (speaker labels, taught by naming a voice once), so a directory is a view
// over that rather than a second thing to maintain: every entry is a person
// this device has genuinely heard, and the numbers are counted from real
// recordings. There is no "add a person" — a person appears by being in a
// meeting, which is the only definition that cannot go stale.
//
// ── What counts as a person ─────────────────────────────────────────────────
// A named speaker. "Speaker 1" is an unnamed voice, not a person: listing them
// would fill the directory with dozens of numbered strangers who are mostly the
// same handful of people the app hasn't been taught yet. Those are counted
// separately and surfaced as the prompt they are — name them and they become
// people.
//
// Separate from people.ts, which reaches the voice store and IndexedDB, so the
// counting can be tested on its own.

import type { LocalMeeting } from "./meetingsStore.ts";

export interface Person {
  /** The speaker label, which is the name — it is what the transcript says. */
  name: string;
  meetingCount: number;
  /** Total seconds this person spoke across every meeting on this device. */
  speakingSeconds: number;
  wordCount: number;
  /** ISO timestamp of the most recent meeting they were in. */
  lastSeen: string;
  /** Meetings they appear in, newest first. */
  meetings: { id: string; title: string; createdAt: string }[];
  /** True when this device has a voice print for them, so the next meeting
   *  recognises them without being asked. */
  enrolled: boolean;
  /** True when this name has only ever been worked out by the app and never
   *  confirmed by a person.
   *
   *  A directory is a list of people you know, so a name nobody has checked
   *  cannot sit in it looking the same as one somebody typed. It stops being a
   *  guess the moment any meeting has it confirmed — a person who said "yes,
   *  that is Priya" once has answered the question for good. */
  guessed: boolean;
}

export interface Directory {
  people: Person[];
  /** Voices heard but never named, across all meetings. Each is a person the
   *  directory cannot show until somebody names them once. */
  unnamedVoices: number;
  /** Meetings with speaker labels at all — the denominator that makes the
   *  unnamed count mean something. */
  meetingsWithSpeakers: number;
}

/** A default label like "Speaker 2" — an unnamed voice, not a person. */
const isUnnamed = (label: string) => /^speaker\s*\d+$/i.test(label.trim());

/** Build the directory from real meetings. Pure, so it is testable without
 *  IndexedDB or an enrolled voice store. */
export function buildDirectory(meetings: readonly LocalMeeting[], enrolledNames: readonly string[]): Directory {
  const enrolled = new Set(enrolledNames.map((n) => n.trim().toLowerCase()));
  const byName = new Map<string, Person>();
  let unnamed = new Set<string>();
  let meetingsWithSpeakers = 0;

  for (const m of meetings) {
    const labels = new Set(m.segments.map((s) => s.speakerLabel));
    if (labels.size > 0) meetingsWithSpeakers++;

    for (const label of labels) {
      if (isUnnamed(label)) {
        // Namespaced by meeting: "Speaker 1" in two meetings is two different
        // people as far as anything here can tell.
        unnamed.add(`${m.id}#${label}`);
        continue;
      }
      const segments = m.segments.filter((s) => s.speakerLabel === label);
      const words = segments.reduce((n, s) => n + s.text.trim().split(/\s+/).filter(Boolean).length, 0);
      const seconds = m.speakers?.find((s) => s.label === label)?.speakingSeconds
        // Fall back to the segment spans when the meeting predates speaker
        // records — a real number from real data either way.
        ?? segments.reduce((n, s) => n + Math.max(0, s.endMs - s.startMs) / 1000, 0);

      const guessedHere = m.speakers?.find((s) => s.label === label)?.nameSource === "inferred";

      const existing = byName.get(label);
      if (existing) {
        existing.meetingCount++;
        existing.speakingSeconds += seconds;
        existing.wordCount += words;
        existing.meetings.push({ id: m.id, title: m.title, createdAt: m.createdAt });
        if (m.createdAt > existing.lastSeen) existing.lastSeen = m.createdAt;
        // One confirmed sighting settles it for every other.
        if (!guessedHere) existing.guessed = false;
      } else {
        byName.set(label, {
          name: label,
          meetingCount: 1,
          speakingSeconds: seconds,
          wordCount: words,
          lastSeen: m.createdAt,
          meetings: [{ id: m.id, title: m.title, createdAt: m.createdAt }],
          enrolled: enrolled.has(label.trim().toLowerCase()),
          guessed: guessedHere,
        });
      }
    }
  }

  const people = [...byName.values()]
    .map((p) => ({ ...p, meetings: p.meetings.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) }))
    .sort((a, b) => (b.meetingCount !== a.meetingCount ? b.meetingCount - a.meetingCount : (a.lastSeen < b.lastSeen ? 1 : -1)));

  return { people, unnamedVoices: unnamed.size, meetingsWithSpeakers };
}
