// Proof that the diarization pipeline works on real audio.
//
// The unit tests cover the logic exhaustively, but they cannot tell you that
// `post_process_speaker_diarization` returns the shape this code reads, that the
// embedding model's output tensor is where we look for it, or that the
// clustering threshold is anywhere near right. This runs the actual models over
// actual speech and prints what comes out.
//
// Deliberately NOT part of `pnpm test`: it needs the network and downloads
// ~40 MB of weights. Run it when the models, the thresholds or the worker's
// message shapes change.
//
//   node packages/asr/verify/diarize.mjs <repo-root> <file.wav>
//
// A 16-bit PCM WAV, any sample rate, mono or stereo. For example:
//   curl -sL https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/ted_60.wav -o /tmp/ted.wav
//
// It needs @huggingface/transformers on the path; the apps load it from a CDN in
// the browser, so install it wherever you run this:
//   npm i @huggingface/transformers@3.8.1
//
// ── What it produced when the thresholds were last tuned ────────────────────
//   ted_60.wav (60 s, an interview — one long-form speaker, one asking short
//   questions):
//
//     8 windows → 38 raw turns → 24 embedded (256-d vectors) → 2 speakers
//     Speaker 1: 6 turns, 48.6 s      Speaker 2: 5 turns, 11.6 s
//     0.0–1.7 S1 · 1.7–3.4 S2 · 3.4–10.8 S1 · 10.8–14.8 S2 · 14.8–22.1 S1 …
//     ~3 s of compute after a 14 s model load.
//
//   Sweeping MERGE_SIMILARITY over the same embeddings:
//     0.15–0.35 → 2 speakers   0.40–0.45 → 4   0.50 → 6   0.60 → 12
//
//   which is why the threshold is 0.30 and not the 0.42 first guessed: 0.42 sat
//   on the cliff and returned four speakers for this clip. The alternating
//   pattern above is the check that matters — a plausible speaker *count* with
//   the turns attributed wrongly would look identical in a summary.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const WAV = process.argv[3];

const { planWindows, SEGMENTATION_MODEL, EMBEDDING_MODEL, MIN_EMBED_SECONDS, MAX_EMBED_SECONDS } =
  await import(pathToFileURL(`${ROOT}/packages/asr/diarize-plan.js`).href);
const { clusterEmbeddings } = await import(pathToFileURL(`${ROOT}/packages/core/src/diarize/cluster.ts`).href);
const { applyClusters, mergeAdjacentTurns } = await import(pathToFileURL(`${ROOT}/packages/core/src/diarize/turns.ts`).href);

/** Decode a 16-bit PCM WAV to mono Float32 at its own rate. */
function readWav(path) {
  const buf = readFileSync(path);
  let offset = 12;
  let fmt = null, dataStart = 0, dataLen = 0;
  while (offset < buf.length - 8) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      fmt = { channels: buf.readUInt16LE(offset + 10), rate: buf.readUInt32LE(offset + 12), bits: buf.readUInt16LE(offset + 22) };
    } else if (id === "data") {
      dataStart = offset + 8; dataLen = size; break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || fmt.bits !== 16) throw new Error("expected 16-bit PCM");
  const samples = dataLen / 2;
  const frames = samples / fmt.channels;
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) sum += buf.readInt16LE(dataStart + (i * fmt.channels + c) * 2) / 32768;
    mono[i] = sum / fmt.channels;
  }
  return { audio: mono, rate: fmt.rate };
}

/** Linear resample — the same approach as packages/core/src/audio/pcm.ts. */
function resample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] * (1 - (pos - i0)) + input[i1] * (pos - i0);
  }
  return out;
}

const t0 = Date.now();
const { audio: raw, rate } = readWav(WAV);
const audio = resample(raw, rate, 16000);
console.log(`audio: ${(audio.length / 16000).toFixed(1)}s at 16 kHz (from ${rate} Hz)`);

const { AutoProcessor, AutoModelForAudioFrameClassification, AutoModel, env } =
  await import("@huggingface/transformers");
env.allowLocalModels = false;

console.log(`loading ${SEGMENTATION_MODEL} …`);
const processor = await AutoProcessor.from_pretrained(SEGMENTATION_MODEL);
const segmenter = await AutoModelForAudioFrameClassification.from_pretrained(SEGMENTATION_MODEL, { dtype: "fp32" });
console.log(`loading ${EMBEDDING_MODEL} …`);
const embedProcessor = await AutoProcessor.from_pretrained(EMBEDDING_MODEL);
const embedder = await AutoModel.from_pretrained(EMBEDDING_MODEL, { dtype: "fp32" });
console.log(`models ready in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ---- exactly what diarize.worker.js does ----
const windows = planWindows(audio.length, 16000);
console.log(`planned ${windows.length} windows`);
const turns = [];
for (let w = 0; w < windows.length; w++) {
  const win = windows[w];
  const slice = audio.subarray(win.start, win.end);
  const inputs = await processor(slice);
  const { logits } = await segmenter(inputs);
  const [local] = processor.post_process_speaker_diarization(logits, slice.length);
  for (const t of local ?? []) {
    if (!(t.end > t.start)) continue;
    turns.push({ start: t.start + win.offsetSeconds, end: t.end + win.offsetSeconds, speaker: w * 8 + t.id, confidence: t.confidence ?? 0 });
  }
}
console.log(`segmentation produced ${turns.length} raw turns`);

function firstFloatTensor(output) {
  if (!output) return null;
  if (output.data instanceof Float32Array) return output;
  for (const v of Object.values(output)) if (v && v.data instanceof Float32Array) return v;
  return null;
}

const embeddings = [], embeddedIndices = [];
for (let i = 0; i < turns.length; i++) {
  const t = turns[i];
  if (t.end - t.start < MIN_EMBED_SECONDS) continue;
  const from = Math.max(0, Math.round(t.start * 16000));
  const span = Math.min(Math.round((t.end - t.start) * 16000), Math.round(MAX_EMBED_SECONDS * 16000));
  const inputs = await embedProcessor(audio.subarray(from, Math.min(audio.length, from + span)));
  const tensor = firstFloatTensor(await embedder(inputs));
  if (tensor) { embeddings.push(Array.from(tensor.data)); embeddedIndices.push(i); }
}
console.log(`embedded ${embeddings.length} turns, dimension ${embeddings[0]?.length ?? 0}`);

const assignments = clusterEmbeddings(embeddings);
const withSpeakers = applyClusters(turns, embeddedIndices, assignments);
const merged = mergeAdjacentTurns(withSpeakers);
const speakers = new Set(merged.map((t) => t.speaker));

console.log("");
console.log(`RESULT: ${speakers.size} distinct speaker(s) across ${merged.length} turns`);
for (const s of [...speakers].sort()) {
  const mine = merged.filter((t) => t.speaker === s);
  const secs = mine.reduce((sum, t) => sum + (t.end - t.start), 0);
  console.log(`  Speaker ${s + 1}: ${mine.length} turns, ${secs.toFixed(1)}s`);
}
console.log("");
console.log("first 8 turns:");
for (const t of merged.slice(0, 8)) {
  console.log(`  ${t.start.toFixed(1).padStart(6)}s → ${t.end.toFixed(1).padStart(6)}s  Speaker ${t.speaker + 1}  (conf ${t.confidence.toFixed(2)})`);
}
console.log(`\ntotal ${((Date.now() - t0) / 1000).toFixed(0)}s`);
