// Speaker clustering — pure maths over embedding vectors, no models, no DOM.
//
// The segmentation model tells us *when* the voice changes; it cannot tell us
// that the voice at 00:02 is the same person as the voice at 41:10, because it
// only ever sees a short window. So every turn gets a speaker embedding and
// those embeddings are clustered globally. This file is that clustering.

/** Cosine similarity in [-1, 1]. Mismatched or empty vectors score -1 rather
 *  than throwing, so one malformed embedding cannot fail a whole meeting. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Unit-length copy of a vector. Clustering and profile matching both assume
 *  normalised vectors so a mean is a meaningful "average voice". */
export function normalise(v: readonly number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n === 0) return Array.from(v);
  return Array.from(v, (x) => x / n);
}

/** Element-wise mean of vectors, re-normalised. Empty input gives []. */
export function centroid(vectors: readonly (readonly number[])[]): number[] {
  const usable = vectors.filter((v) => v.length > 0);
  if (usable.length === 0) return [];
  const dim = usable[0].length;
  const out = new Array<number>(dim).fill(0);
  let counted = 0;
  for (const v of usable) {
    if (v.length !== dim) continue; // a stray dimension must not corrupt the mean
    for (let i = 0; i < dim; i++) out[i] += v[i];
    counted++;
  }
  if (counted === 0) return [];
  for (let i = 0; i < dim; i++) out[i] /= counted;
  return normalise(out);
}

/**
 * Cosine similarity below which two clusters are considered different people.
 *
 * ── Where this number came from ─────────────────────────────────────────────
 * It was first guessed at 0.42, on the reasoning that over-splitting is
 * recoverable (the user clicks "merge") while welding two people into one
 * silently corrupts the transcript. That reasoning still holds. The number was
 * wrong.
 *
 * Measured by running the real models over real speech and sweeping the
 * threshold:
 *
 *   60 s, two speakers        0.15–0.35 → 2 speakers   0.40–0.45 → 4   0.50 → 6
 *   13 s, one speaker, 1963   0.15–0.25 → 2 speakers   0.30–0.45 → 3   0.50 → 4
 *     (a hall with heavy reverb and a crowd; within-speaker similarity has a
 *      median of 0.19 against 0.39 for the clean recording, so some splitting
 *      is unavoidable on audio this poor)
 *
 * 0.42 sat on a cliff edge in the first case — one notch lower and the answer
 * was right, one notch higher and it doubled. 0.30 sits in the middle of that
 * stable plateau, is no worse on the difficult recording, and is independently
 * the value pyannote's own speaker-diarization-3.1 pipeline tunes to over these
 * same WeSpeaker embeddings (a cosine *distance* of 0.7046, i.e. a similarity
 * of 0.295).
 *
 * Three lines of evidence agreeing is a better basis than one plausible
 * argument, so: 0.30.
 *
 * ── Revisited after real usage ───────────────────────────────────────────────
 * Users recording real meetings reported the opposite failure from the one
 * this constant was tuned against: one person coming back as two or three
 * "speakers", not two people welded into one. That is new evidence, not a
 * reason to throw out the old measurement — it says where on the *already
 * validated* plateau to sit, not that the plateau was wrong.
 *
 * Both measured cases above stayed at 2 speakers all the way down to 0.15, so
 * 0.30 was never the only value that worked — it was picked as the middle of
 * a wide stable range, with headroom on both sides. Moving to 0.24 uses some
 * of that headroom to lean toward merging without leaving the range either
 * measurement validated. It remains well above the noise floor (a threshold
 * of -1 merges everything, and 0.30 alone already sat far from that), so two
 * genuinely different voices with typical separation still split correctly.
 *
 * This is also safe to lean on precisely because over-splitting is no longer
 * a dead end: {@link MIN_SPEAKER_SECONDS} folds away the noisy-short-turn
 * splits this threshold cannot see coming, and the app now has a one-click
 * "merge into" action for whatever gets through anyway (see
 * `renameSpeaker.ts`'s `mergeSpeakerInMeeting`). Welding two real people
 * together has no equivalent one-click undo, which is why the bias still
 * stops well short of the noise floor rather than chasing it.
 */
export const MERGE_SIMILARITY = 0.24;

/**
 * Total speaking time below which a cluster is folded into its nearest
 * surviving neighbour, regardless of {@link MERGE_SIMILARITY}.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The embedding model needs real signal to place a voice accurately; a short,
 * often noisy turn ("mm-hm", a cough, a word caught mid-interruption) gives it
 * the least reliable input it ever sees, and the *primary* clustering pass has
 * no way to tell a shaky embedding from a confident one — it treats every
 * pairwise similarity as equally trustworthy. So the turns most likely to
 * produce a wrong answer are exactly the turns most likely to be short. A
 * genuine extra participant who spoke for under two seconds in an entire
 * meeting is vanishingly rare; a phantom split from a noisy interjection is
 * not. Given that asymmetry, folding tiny clusters away by default removes far
 * more false speakers than it would ever remove real ones.
 *
 * Applied only when the speaker count was not forced — a person who tells the
 * app exactly how many people were in the room is not asking for this
 * correction, and `clusterEmbeddings` already refuses to second-guess that.
 */
export const MIN_SPEAKER_SECONDS = 2.0;

export interface ClusterOptions {
  /** Similarity floor for merging. Defaults to {@link MERGE_SIMILARITY}. */
  threshold?: number;
  /** Stop merging at exactly this many clusters — used when the user tells us
   *  how many people were in the room. Overrides `threshold`. */
  speakers?: number;
  /** Per-embedding weight — typically the turn's duration in seconds — used
   *  both for average-linkage sizing (so one long, confident turn outweighs
   *  several short, noisy ones) and to decide which clusters are small enough
   *  to be folded away by {@link minClusterWeight}. Defaults to 1 per
   *  embedding, i.e. plain turn counting, when omitted. */
  weights?: readonly number[];
  /** Clusters whose total weight stays under this after the main pass are
   *  merged into their nearest surviving neighbour, however dissimilar —
   *  defaults to {@link MIN_SPEAKER_SECONDS} when `weights` are given, and to
   *  0 (disabled) otherwise, since turn counts and seconds are not the same
   *  unit. Ignored when `speakers` is set. Pass 0 to disable explicitly. */
  minClusterWeight?: number;
}

/**
 * Average-linkage agglomerative clustering over cosine similarity.
 *
 * Returns one cluster index per input embedding, renumbered so that cluster 0
 * is whoever spoke first — the order a reader expects "Speaker 1" to mean.
 *
 * Average linkage (rather than single) because single linkage chains: one
 * ambiguous turn that sits between two people merges them both. The linkage
 * update is incremental — sim(A∪B, C) is the size-weighted mean of sim(A,C)
 * and sim(B,C) — so a merge is O(n) and the whole run is O(n²) in memory.
 */
export function clusterEmbeddings(
  embeddings: readonly (readonly number[])[],
  options: ClusterOptions = {},
): number[] {
  const n = embeddings.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  const target = options.speakers && options.speakers > 0 ? Math.min(options.speakers, n) : 0;
  const threshold = options.threshold ?? MERGE_SIMILARITY;
  const weights = options.weights;
  const minClusterWeight = target ? 0 : (options.minClusterWeight ?? (weights ? MIN_SPEAKER_SECONDS : 0));

  // sim[i][j] for live clusters; size[i] members; alive[i] whether i is a root.
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(-1));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosine(embeddings[i], embeddings[j]);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }
  // Average linkage weighs each member by `size`, so passing turn durations
  // here (rather than leaving every turn worth exactly 1) makes one long,
  // confident turn outweigh several short, noisy ones when two clusters are
  // compared — the same signal `minClusterWeight` uses afterwards, applied
  // during merging rather than only after it.
  const size = weights ? weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0)) : new Array<number>(n).fill(1);
  const alive = new Array<boolean>(n).fill(true);
  /** Which root each original index currently belongs to. */
  const owner = Array.from({ length: n }, (_, i) => i);
  let liveCount = n;

  /** Fold `j` into `i`, size-weighted (average linkage). Shared by the main
   *  pass and the tiny-cluster reabsorption pass below. */
  function absorb(i: number, j: number): void {
    const sizeI = size[i], sizeJ = size[j];
    const total = sizeI + sizeJ || 1; // both weights 0 is a degenerate input, not a divide-by-zero
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === i || k === j) continue;
      const merged = (sizeI * sim[i][k] + sizeJ * sim[j][k]) / total;
      sim[i][k] = merged;
      sim[k][i] = merged;
    }
    size[i] = sizeI + sizeJ;
    alive[j] = false;
    liveCount--;
    for (let k = 0; k < n; k++) if (owner[k] === j) owner[k] = i;
  }

  for (;;) {
    if (target ? liveCount <= target : liveCount <= 1) break;

    // Closest surviving pair.
    let bestI = -1, bestJ = -1, best = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!alive[j]) continue;
        if (sim[i][j] > best) { best = sim[i][j]; bestI = i; bestJ = j; }
      }
    }
    if (bestI < 0) break;
    // Without a speaker count, similarity decides when to stop.
    if (!target && best < threshold) break;

    absorb(bestI, bestJ);
  }

  // A cluster with too little speech behind it to trust is folded into
  // whichever surviving cluster it resembles most, even weakly — see
  // `MIN_SPEAKER_SECONDS`. Runs after the main pass, not interleaved with it,
  // so a real second voice that briefly looks similar to a confident cluster
  // is never absorbed just for having spoken first and least.
  if (minClusterWeight > 0) {
    for (;;) {
      if (liveCount <= 1) break;
      let tiny = -1, tinyWeight = Infinity;
      for (let i = 0; i < n; i++) {
        if (alive[i] && size[i] < minClusterWeight && size[i] < tinyWeight) { tiny = i; tinyWeight = size[i]; }
      }
      if (tiny < 0) break;

      let nearest = -1, best = -Infinity;
      for (let k = 0; k < n; k++) {
        if (!alive[k] || k === tiny) continue;
        if (sim[tiny][k] > best) { best = sim[tiny][k]; nearest = k; }
      }
      if (nearest < 0) break;
      absorb(nearest, tiny);
    }
  }

  // Renumber by first appearance so "Speaker 1" is the first voice heard.
  const order = new Map<number, number>();
  return owner.map((root) => {
    let idx = order.get(root);
    if (idx === undefined) { idx = order.size; order.set(root, idx); }
    return idx;
  });
}
