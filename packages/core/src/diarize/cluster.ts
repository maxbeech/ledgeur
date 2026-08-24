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
 */
export const MERGE_SIMILARITY = 0.30;

export interface ClusterOptions {
  /** Similarity floor for merging. Defaults to {@link MERGE_SIMILARITY}. */
  threshold?: number;
  /** Stop merging at exactly this many clusters — used when the user tells us
   *  how many people were in the room. Overrides `threshold`. */
  speakers?: number;
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

  // sim[i][j] for live clusters; size[i] members; alive[i] whether i is a root.
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(-1));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosine(embeddings[i], embeddings[j]);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }
  const size = new Array<number>(n).fill(1);
  const alive = new Array<boolean>(n).fill(true);
  /** Which root each original index currently belongs to. */
  const owner = Array.from({ length: n }, (_, i) => i);
  let liveCount = n;

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

    // Merge bestJ into bestI, size-weighted (average linkage).
    const sizeI = size[bestI], sizeJ = size[bestJ];
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === bestI || k === bestJ) continue;
      const merged = (sizeI * sim[bestI][k] + sizeJ * sim[bestJ][k]) / (sizeI + sizeJ);
      sim[bestI][k] = merged;
      sim[k][bestI] = merged;
    }
    size[bestI] = sizeI + sizeJ;
    alive[bestJ] = false;
    liveCount--;
    for (let k = 0; k < n; k++) if (owner[k] === bestJ) owner[k] = bestI;
  }

  // Renumber by first appearance so "Speaker 1" is the first voice heard.
  const order = new Map<number, number>();
  return owner.map((root) => {
    let idx = order.get(root);
    if (idx === undefined) { idx = order.size; order.set(root, idx); }
    return idx;
  });
}
