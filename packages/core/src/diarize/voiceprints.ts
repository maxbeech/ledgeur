// Remembering a voice between meetings.
//
// Diarization alone gives you "Speaker 1" and "Speaker 2" — useful once, and
// then useless, because next Tuesday's Speaker 1 is a different person. What
// makes it a product is that naming a voice *once* is enough: the mean
// embedding of that speaker's turns is stored, and every later meeting is
// matched against it before the transcript is ever shown.
//
// Pure functions over plain data. Where profiles are persisted (IndexedDB in
// the browser, voices.json in the native app) is the caller's business.

import { centroid, cosine } from "./cluster.ts";
import type { SpeakerSummary, VoiceProfile } from "./types.ts";

/**
 * Cosine similarity at or above which a clip's speaker is taken to be a known
 * person.
 *
 * Higher than {@link import("./cluster.ts").MERGE_SIMILARITY} on purpose:
 * merging two turns wrongly is a local mistake, but putting a colleague's name
 * on a stranger's words is a serious one, so identification demands more
 * evidence than clustering does.
 *
 * ── Where this number came from ─────────────────────────────────────────────
 * Identification compares a *centroid* — the mean of a speaker's turns — against
 * a stored profile centroid. Centroids are far steadier than individual turns,
 * so this cannot be reasoned about from turn-to-turn similarity, which has a
 * median around 0.19–0.39 depending on recording quality.
 *
 * Measured by splitting each real speaker's turns in half and treating one half
 * as "last week's profile":
 *
 *   same speaker, two halves    0.647, 0.819, 0.843, 0.872
 *   different speakers          0.027, 0.121
 *
 * The gap is enormous, which is the whole reason speaker identification works
 * at all. This was first set to 0.62, which is safe but sits barely below the
 * worst same-speaker case (0.647, from a reverberant 1963 recording) — so a
 * person on a poor microphone would silently stop being recognised.
 *
 * 0.50 keeps roughly a fourfold margin over the worst *different*-speaker case
 * while leaving real headroom for bad audio. {@link IDENTIFY_MARGIN} is the
 * second guard: even above this threshold, two candidates too close together
 * are refused rather than guessed between.
 */
export const IDENTIFY_SIMILARITY = 0.50;

/** How much better than the runner-up the best match must be before we trust
 *  it. Two profiles within this margin means "these two voices are too alike to
 *  tell apart", and we would rather say Speaker 2 than guess. */
export const IDENTIFY_MARGIN = 0.05;

export interface ProfileMatch {
  profile: VoiceProfile;
  similarity: number;
}

/**
 * Best profile for an embedding, or null when nothing is close enough — or
 * when the top two candidates are too close to each other to separate.
 */
export function matchProfile(
  embedding: readonly number[],
  profiles: readonly VoiceProfile[],
  options: { threshold?: number; margin?: number } = {},
): ProfileMatch | null {
  const threshold = options.threshold ?? IDENTIFY_SIMILARITY;
  const margin = options.margin ?? IDENTIFY_MARGIN;
  if (embedding.length === 0 || profiles.length === 0) return null;

  const scored = profiles
    .map((profile) => ({ profile, similarity: cosine(embedding, profile.embedding) }))
    .sort((a, b) => b.similarity - a.similarity);

  const best = scored[0];
  if (!best || best.similarity < threshold) return null;
  const runnerUp = scored[1];
  if (runnerUp && best.similarity - runnerUp.similarity < margin) return null;
  return best;
}

/** "Speaker 1", "Speaker 2", … — 1-based, because nobody counts people from zero. */
export function defaultSpeakerLabel(index: number): string {
  return `Speaker ${index + 1}`;
}

/**
 * Name each speaker in a clip: a matched profile's name where we are confident,
 * "Speaker N" where we are not.
 *
 * One profile can only claim one speaker per clip. Without that rule a meeting
 * where somebody's voice is recorded twice (a phone on speaker, say) can end up
 * with two different speakers both labelled "Priya", which reads as a bug even
 * when the audio really is ambiguous. The stronger match keeps the name.
 */
export function identifySpeakers(
  speakers: readonly { speaker: number; embedding: number[]; speakingSeconds: number }[],
  profiles: readonly VoiceProfile[],
  options: { threshold?: number; margin?: number } = {},
): SpeakerSummary[] {
  const candidates = speakers.map((s) => ({ s, match: matchProfile(s.embedding, profiles, options) }));

  // Resolve contested profiles in favour of the higher similarity.
  const winner = new Map<string, { speaker: number; similarity: number }>();
  for (const { s, match } of candidates) {
    if (!match) continue;
    const held = winner.get(match.profile.id);
    if (!held || match.similarity > held.similarity) {
      winner.set(match.profile.id, { speaker: s.speaker, similarity: match.similarity });
    }
  }

  return candidates.map(({ s, match }) => {
    const claimed = match && winner.get(match.profile.id)?.speaker === s.speaker;
    return {
      speaker: s.speaker,
      label: claimed ? match.profile.name : defaultSpeakerLabel(s.speaker),
      profileId: claimed ? match.profile.id : null,
      confidence: claimed ? match.similarity : null,
      embedding: s.embedding,
      speakingSeconds: s.speakingSeconds,
    };
  });
}

/** Stable-ish id for a new profile. Callers may supply their own. */
function newId(name: string, now: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "voice";
  return `vp_${slug}_${now.toString(36)}`;
}

/**
 * Fold a newly-named speaker into the profile set.
 *
 * Naming an existing person updates their voice print as a running mean rather
 * than replacing it, weighted by how many recordings have contributed. A voice
 * heard in ten meetings should not be redefined by an eleventh recorded through
 * a bad headset — but it should still learn from it.
 *
 * Returns a new array; the input is never mutated.
 */
export function rememberVoice(
  profiles: readonly VoiceProfile[],
  input: { name: string; embedding: readonly number[]; profileId?: string | null; now?: number },
): VoiceProfile[] {
  const name = input.name.trim();
  if (!name) return [...profiles];
  const embedding = input.embedding;
  const now = input.now ?? Date.now();
  const iso = new Date(now).toISOString();

  // Prefer an explicit id, else an existing person with the same name — typing
  // a name that already exists means "this is them", not "make a second Priya".
  const existing = profiles.find((p) =>
    input.profileId ? p.id === input.profileId : p.name.toLowerCase() === name.toLowerCase());

  if (!existing) {
    if (embedding.length === 0) return [...profiles];
    return [...profiles, {
      id: newId(name, now),
      name,
      embedding: centroid([embedding]),
      samples: 1,
      createdAt: iso,
      updatedAt: iso,
    }];
  }

  // A rename with no usable embedding is still a rename.
  if (embedding.length === 0 || embedding.length !== existing.embedding.length) {
    return profiles.map((p) => (p.id === existing.id ? { ...p, name, updatedAt: iso } : p));
  }

  const weight = Math.max(1, existing.samples);
  const blended = existing.embedding.map((x, i) => (x * weight + embedding[i]) / (weight + 1));
  return profiles.map((p) => (p.id === existing.id
    ? { ...p, name, embedding: centroid([blended]), samples: weight + 1, updatedAt: iso }
    : p));
}

/** Remove a remembered voice. */
export function forgetVoice(profiles: readonly VoiceProfile[], id: string): VoiceProfile[] {
  return profiles.filter((p) => p.id !== id);
}
