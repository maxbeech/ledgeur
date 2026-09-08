// Choosing which few seconds of somebody's voice to keep.
//
// To recognise a person in a later meeting the app needs a sample of them
// speaking. The native engine cannot work backwards from a stored vector — its
// profiles are built from audio — so without a kept sample, naming a voice a
// week after the recording teaches the app nothing, and the same person is
// "Speaker 2" again next Tuesday. (See voiceProfiles.ts: that gap is the whole
// reason this exists.)
//
// The catch is that keeping audio of somebody talking is keeping *whatever they
// were talking about*. A voice print is already the most identifying thing in a
// meeting; a voice print that happens to be five seconds of a person reading out
// a card number is a different category of mistake entirely. So the sample is
// not "the first few seconds": it is the least sensitive stretch long enough to
// be usable, and if every stretch looks sensitive, nothing is kept at all.
//
// The scoring below is a filter, not a classifier. It never decides who is
// speaking or what a meeting means — it only ranks candidate windows so the
// blandest one wins, and refuses outright when the blandest is still bad.

/**
 * Shortest usable sample.
 *
 * Three seconds because that is where the speaker-embedding model starts
 * carrying identity at all — measured, not guessed; the same number gates live
 * labelling in the native engine (MIN_EMBED_SECONDS in
 * apps/desktop/src-tauri/src/ai/engine.rs). Below it the vector is noise and the
 * profile it produces would match strangers.
 */
export const MIN_SNIPPET_SECONDS = 3;

/**
 * Longest sample kept.
 *
 * Eight seconds is comfortably past the point where a longer sample stops
 * improving the embedding, and it bounds what is stored: 8 s of 16 kHz 16-bit
 * mono is 256 KB per speaker, so even a crowded meeting costs a couple of
 * megabytes on the device. Keeping more audio would also mean keeping more of
 * what was said, which is the thing this module exists to minimise.
 */
export const MAX_SNIPPET_SECONDS = 8;

/**
 * Sensitivity above which no sample is kept.
 *
 * Erring towards keeping nothing: a missing sample costs the user one manual
 * enrolment, while a kept one that contains a card number is a data-protection
 * problem sitting on disk. See {@link sensitivityScore} for the scale.
 */
export const MAX_SNIPPET_SENSITIVITY = 0.4;

/** One transcript line, as this module needs it. */
export interface SnippetLine {
  startMs: number;
  endMs: number;
  speakerLabel: string;
  text: string;
}

/** The stretch chosen, on the meeting clock. */
export interface VoiceSnippet {
  startMs: number;
  endMs: number;
  /** What is said in it — kept so the UI can show the user exactly what was
   *  stored, rather than asking them to trust a description of it. */
  text: string;
  /** 0..1, what {@link sensitivityScore} made of that text. */
  sensitivity: number;
}

/**
 * Markers of content nobody should have sitting in a voice sample, and what
 * each one costs.
 *
 * Weights are relative, not probabilities: a run of digits long enough to be a
 * card or account number is disqualifying on its own (1.0), a spoken sum of
 * money is a strong signal but a normal thing to say in a business meeting
 * (0.5), and a word from the sensitive lexicon is a hint rather than proof
 * (0.35 each). The score is the sum, capped at 1.
 */
const MARKERS: { name: string; test: RegExp; weight: number }[] = [
  // Long digit runs — card, account, passport, national insurance, phone. Also
  // catches them read out in spaced groups ("4 5 5 1 2 3 ...").
  { name: "digits", test: /(?:\d[\s-]?){7,}/, weight: 1 },
  { name: "email", test: /[\w.+-]+@[\w-]+\.[\w.-]+/, weight: 1 },
  { name: "sortcode", test: /\b\d{2}[-\s]\d{2}[-\s]\d{2}\b/, weight: 1 },
  { name: "money", test: /(?:[£$€]\s?\d|(?:\d+(?:[.,]\d+)?)\s?(?:pounds|dollars|euros|grand|k\b))/i, weight: 0.5 },
  { name: "url", test: /https?:\/\/|\bwww\.\w/i, weight: 0.4 },
  {
    name: "credential",
    test: /\b(?:password|passcode|passphrase|pin(?:\s?number)?|api\s?key|secret\s?key|access\s?token|credentials?|two[-\s]?factor|otp)\b/i,
    weight: 1,
  },
  {
    name: "identity",
    test: /\b(?:national\s?insurance|social\s?security|passport(?:\s?number)?|date\s?of\s?birth|home\s?address|post\s?code|zip\s?code|sort\s?code|account\s?number|iban|routing\s?number)\b/i,
    weight: 1,
  },
  {
    name: "personal",
    test: /\b(?:salary|salaries|compensation|equity|bonus|payslip|redundan\w+|laid\s?off|layoffs?|fired|dismissal|grievance|disciplinary|resign\w*|maternity|paternity|sick\s?leave|visa|immigration|divorce|custody)\b/i,
    weight: 0.35,
  },
  {
    name: "health",
    test: /\b(?:diagnos\w+|prescri\w+|medication|chemo\w*|therapy|therapist|psychiatr\w+|depress\w+|anxiety|hospital|surgery|cancer|illness|symptoms?)\b/i,
    weight: 0.35,
  },
  {
    name: "legal",
    test: /\b(?:lawsuit|litigation|solicitor|counsel|settlement|nda|non[-\s]?disclosure|confidential|privileged|under\s?embargo|due\s?diligence|acquisition|acquire\w*|term\s?sheet)\b/i,
    weight: 0.35,
  },
];

/**
 * How risky this text would be to keep, 0 (bland) to 1 (do not store).
 *
 * Each marker counts once however often it appears — three mentions of "salary"
 * in one window is one sensitive subject, not three — so a long window is not
 * penalised simply for being long.
 */
export function sensitivityScore(text: string): number {
  if (!text.trim()) return 0;
  let score = 0;
  for (const marker of MARKERS) if (marker.test.test(text)) score += marker.weight;
  return Math.min(1, score);
}

/** Which markers fired — for logging and for telling a person why nothing was
 *  kept, rather than leaving "no sample" looking like a bug. */
export function sensitivityReasons(text: string): string[] {
  return MARKERS.filter((m) => m.test.test(text)).map((m) => m.name);
}

export interface SnippetOptions {
  minSeconds?: number;
  maxSeconds?: number;
  maxSensitivity?: number;
}

/**
 * The blandest few seconds of one speaker.
 *
 * Candidates are runs of *consecutive* lines by that speaker — consecutive in
 * the transcript, so the audio between them is that person talking rather than
 * somebody else's turn spliced in, which would poison the voice print with two
 * people's voices. Every run is grown from each of its starting lines until it
 * is long enough, and the winner is the least sensitive; ties go to the longer
 * window, because more speech makes a steadier embedding.
 *
 * Returns null when the speaker never holds the floor for long enough, or when
 * everything they said is too sensitive to keep. Both are ordinary outcomes and
 * neither is an error.
 */
export function chooseVoiceSnippet(
  lines: readonly SnippetLine[],
  label: string,
  options: SnippetOptions = {},
): VoiceSnippet | null {
  const minMs = (options.minSeconds ?? MIN_SNIPPET_SECONDS) * 1000;
  const maxMs = (options.maxSeconds ?? MAX_SNIPPET_SECONDS) * 1000;
  const ceiling = options.maxSensitivity ?? MAX_SNIPPET_SENSITIVITY;
  const wanted = label.trim();
  if (!wanted) return null;

  // Split into runs of consecutive lines belonging to this speaker.
  const runs: SnippetLine[][] = [];
  let current: SnippetLine[] = [];
  for (const line of lines) {
    if (line.speakerLabel.trim() === wanted && line.endMs > line.startMs) {
      current.push(line);
    } else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);

  let best: VoiceSnippet | null = null;
  for (const run of runs) {
    for (let i = 0; i < run.length; i++) {
      let endMs = run[i].startMs;
      const parts: string[] = [];
      for (let j = i; j < run.length; j++) {
        // A gap inside a "run" means the speaker stopped and started again;
        // the audio in between is not theirs, so the window ends here.
        if (j > i && run[j].startMs - endMs > 2_000) break;
        endMs = run[j].endMs;
        parts.push(run[j].text.trim());
        const startMs = run[i].startMs;
        if (endMs - startMs < minMs) continue;

        // Long enough. A single very long utterance is trimmed to the cap
        // rather than discarded — the audio kept is then a prefix of the text
        // scored, so scoring the whole thing is conservative, never optimistic.
        const keptEnd = Math.min(endMs, startMs + maxMs);
        const text = parts.join(" ").trim();
        const sensitivity = sensitivityScore(text);
        if (sensitivity <= ceiling) {
          const durationMs = keptEnd - startMs;
          if (
            !best ||
            sensitivity < best.sensitivity ||
            (sensitivity === best.sensitivity && durationMs > best.endMs - best.startMs)
          ) {
            best = { startMs, endMs: keptEnd, text, sensitivity };
          }
        }
        // Growing the window from here can only add more words, and therefore
        // only more sensitivity — so this start point is done.
        break;
      }
    }
  }
  return best;
}
