// Tokenising and lexical relevance — the shared primitives underneath the
// heuristic summariser, the live-meeting context builder and note provenance.
//
// These used to be three private copies of "lowercase, split on word chars,
// drop stopwords". They now agree by construction, which matters more than it
// sounds: provenance links a note line back to the transcript line it came
// from, and it can only do that if it scores words the same way the summariser
// that produced the note did.
//
// Pure and dependency-free, so every consumer (browser, worker, Node tests,
// the MCP server) can use it.

/**
 * Words carrying no topical signal. Deliberately includes spoken-English filler
 * ("um", "yeah", "basically") — this corpus is speech-to-text output, where
 * filler is a large fraction of every transcript and would otherwise dominate
 * any frequency count.
 */
export const STOPWORDS: ReadonlySet<string> = new Set(
  ("a an the and or but so to of in on at for with as is are was were be been being " +
    "i you he she it we they me him her us them my your our their this that these those " +
    "do does did have has had will would can could should may might must just like yeah " +
    "okay ok um uh kind sort really very actually basically gonna wanna got get gets " +
    "about into over than then there here what which who whom how when where why not no yes " +
    "if because while from by up down out off again once also too more most some any all")
    .split(" "),
);

/** Lowercase word tokens, apostrophes kept ("we'll" stays one token). */
export function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/** Tokens that carry topic: not a stopword, at least three characters. */
export function contentTokens(s: string): string[] {
  return tokenize(s).filter((w) => !STOPWORDS.has(w) && w.length >= 3);
}

/**
 * How well `text` answers `query`, in 0..1.
 *
 * Coverage of the *query's* terms, not of the text's — otherwise a one-word
 * line that happens to repeat a query term outscores a paragraph that actually
 * answers the question. Rare terms count for more: a match on "onboarding"
 * says far more than a match on "meeting", so each query term is weighted by
 * 1/log(1 + how many candidates contain it). Callers that have a corpus pass
 * `documentFrequency`; without one every term weighs the same.
 */
export function relevance(
  query: string,
  text: string,
  documentFrequency?: ReadonlyMap<string, number>,
  corpusSize = 0,
): number {
  const q = new Set(contentTokens(query));
  if (q.size === 0) return 0;
  const present = new Set(contentTokens(text));
  let hit = 0;
  let total = 0;
  for (const term of q) {
    const df = documentFrequency?.get(term) ?? 0;
    // +2 keeps the weight finite and positive for a term in every document.
    const weight = corpusSize > 0 ? Math.log((corpusSize + 1) / (df + 1)) + 0.5 : 1;
    total += weight;
    if (present.has(term)) hit += weight;
  }
  return total === 0 ? 0 : hit / total;
}

/** How many of `texts` contain each content token. Feeds `relevance`. */
export function documentFrequency(texts: readonly string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const t of texts) {
    for (const term of new Set(contentTokens(t))) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return df;
}

/**
 * Jaccard similarity of two texts' content-token sets, in 0..1.
 *
 * Set overlap rather than sequence comparison on purpose: "the team decided
 * to focus on X and automate Y" and "the team decided to automate Y and focus
 * on X" are the same fact in a different order, and a model reducing several
 * passes into one is prone to producing exactly that — a reworded repeat, not
 * a copy. Order-sensitive comparison would miss it.
 */
export function textSimilarity(a: string, b: string): number {
  const setA = new Set(contentTokens(a));
  const setB = new Set(contentTokens(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Drop items that restate one already kept, however differently worded.
 *
 * A safety net behind note generation, not a replacement for asking the model
 * not to repeat itself: exact-string dedupe (see `dedupe` below) catches a
 * verbatim repeat, but not the far commoner case of a small model saying the
 * same decision twice with its clauses swapped. Order-preserving — the first
 * phrasing of a fact is kept, later restatements of it are dropped.
 */
export function dedupeSimilar(items: readonly string[], threshold = 0.6): string[] {
  const kept: string[] = [];
  for (const raw of items) {
    const item = raw.trim();
    if (!item) continue;
    if (kept.some((k) => textSimilarity(k, item) >= threshold)) continue;
    kept.push(item);
  }
  return kept;
}
