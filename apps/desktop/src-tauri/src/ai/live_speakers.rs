// Stable speaker labels while the meeting is still running.
//
// The pass that runs on Stop diarizes the whole recording at once, so it can
// cluster globally and knows how many people were in the room before it has to
// name any of them. Live, the only thing in hand is the utterance that just
// finished — so speakers are tracked incrementally instead: each utterance is
// embedded once and matched against the running centroid of every speaker heard
// so far. A match extends that speaker and pulls its centroid slightly towards
// the new sample; no match starts a new speaker. An index, once handed out,
// belongs to that voice for the rest of the take, which is what makes the label
// on screen stable rather than re-shuffling every few seconds.
//
// Per utterance, not per fixed window: the segmenter already cuts on ~750 ms of
// silence (see `UtteranceSegmenter` in packages/core), so an utterance is nearly
// always one person talking, and one CAM++ evaluation per utterance is cheap
// enough to keep up with a live meeting where a full pyannote pass is not. Two
// people talking inside a single utterance is the case this cannot see; the full
// pass on Stop re-labels the transcript and fixes it.
//
// Everything here is pure — no models, no audio — so the part that decides who
// is who is testable on its own, and the threshold that governs it is measured
// rather than guessed (see `assignment_threshold_sweep` in engine.rs).

use crate::ai::voices::cosine;

/// A speaker heard so far in this take: the running mean of the embeddings
/// attributed to them, kept as a sum plus a count so the mean is exact.
#[derive(Clone, Debug)]
struct Centroid {
    sum: Vec<f32>,
    count: u32,
}

impl Centroid {
    fn mean(&self) -> Vec<f32> {
        self.sum.iter().map(|v| v / self.count as f32).collect()
    }
}

/// The speakers heard so far in one recording. Reset between takes.
#[derive(Default, Debug)]
pub struct LiveSpeakers {
    centroids: Vec<Centroid>,
}

impl LiveSpeakers {
    pub fn new() -> Self {
        Self::default()
    }

    /// How many distinct voices have been heard so far.
    pub fn len(&self) -> usize {
        self.centroids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.centroids.is_empty()
    }

    /// Attribute one utterance to a speaker, and return their 0-based index.
    ///
    /// `max_distance` is a cosine *distance* (`1 - similarity`), matching the
    /// units `DIARIZE_DISTANCE_THRESHOLD` is measured in, so both thresholds can
    /// be reasoned about — and re-measured — the same way.
    ///
    /// An empty embedding is not attributed to anybody: silently folding a
    /// failed embedding into whichever speaker happens to be nearest is how a
    /// transcript ends up confidently wrong about who said what.
    pub fn assign(&mut self, embedding: &[f32], max_distance: f32) -> Option<usize> {
        if embedding.is_empty() {
            return None;
        }
        let mut best: Option<(usize, f32)> = None;
        for (i, c) in self.centroids.iter().enumerate() {
            let distance = 1.0 - cosine(embedding, &c.mean());
            if distance <= max_distance && best.map_or(true, |(_, b)| distance < b) {
                best = Some((i, distance));
            }
        }
        match best {
            Some((i, _)) => {
                let c = &mut self.centroids[i];
                for (acc, v) in c.sum.iter_mut().zip(embedding) {
                    *acc += v;
                }
                c.count += 1;
                Some(i)
            }
            None => {
                self.centroids.push(Centroid { sum: embedding.to_vec(), count: 1 });
                Some(self.centroids.len() - 1)
            }
        }
    }
}

/// The anonymous label for a 0-based speaker index — the one place the
/// "Speaker N" wording is produced, so the live transcript and the full pass on
/// Stop cannot drift into numbering people differently.
pub fn speaker_label(index: usize) -> String {
    format!("Speaker {}", index + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A unit vector pointing mostly along one axis, standing in for a voice.
    fn voice(axis: usize, jitter: f32) -> Vec<f32> {
        let mut v = vec![jitter; 8];
        v[axis] = 1.0;
        v
    }

    #[test]
    fn the_same_voice_keeps_its_index() {
        let mut live = LiveSpeakers::new();
        assert_eq!(live.assign(&voice(0, 0.01), 0.3), Some(0));
        assert_eq!(live.assign(&voice(0, 0.05), 0.3), Some(0));
        assert_eq!(live.assign(&voice(0, 0.02), 0.3), Some(0));
        assert_eq!(live.len(), 1, "one voice must not become three speakers");
    }

    #[test]
    fn a_different_voice_gets_its_own_index() {
        let mut live = LiveSpeakers::new();
        assert_eq!(live.assign(&voice(0, 0.0), 0.3), Some(0));
        assert_eq!(live.assign(&voice(1, 0.0), 0.3), Some(1));
        // Back to the first speaker: the index must be the one they already had,
        // not a third one. This is the whole point of keeping centroids.
        assert_eq!(live.assign(&voice(0, 0.01), 0.3), Some(0));
        assert_eq!(live.len(), 2);
    }

    #[test]
    fn the_nearest_speaker_wins_not_the_first_acceptable_one() {
        let mut live = LiveSpeakers::new();
        live.assign(&voice(0, 0.0), 0.9); // a permissive threshold: both match
        live.assign(&voice(1, 0.0), 0.9);
        // Closest to speaker 2, and speaker 1 is also within the threshold.
        assert_eq!(live.assign(&voice(1, 0.02), 0.9), Some(1));
        assert_eq!(live.len(), 2);
    }

    #[test]
    fn a_failed_embedding_is_not_attributed_to_anyone() {
        let mut live = LiveSpeakers::new();
        live.assign(&voice(0, 0.0), 0.3);
        assert_eq!(live.assign(&[], 0.3), None);
        assert_eq!(live.len(), 1, "an empty embedding must not create a speaker either");
    }

    #[test]
    fn the_centroid_is_the_mean_of_what_it_has_seen() {
        let mut live = LiveSpeakers::new();
        live.assign(&[1.0, 0.0], 0.3);
        live.assign(&[1.0, 1.0], 0.3); // 45° away — merged at this threshold? no:
        // distance is 1 - cos(45°) ≈ 0.293, just inside 0.3, so it merges and the
        // centroid moves halfway.
        assert_eq!(live.len(), 1);
        assert_eq!(live.centroids[0].mean(), vec![1.0, 0.5]);
    }

    #[test]
    fn labels_are_one_based() {
        assert_eq!(speaker_label(0), "Speaker 1");
        assert_eq!(speaker_label(3), "Speaker 4");
    }
}
