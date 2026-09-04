// Pure audio helpers used by the recorder before audio is handed to the speech
// model. Whisper expects mono Float32 PCM at 16 kHz. These functions are pure
// (no Web Audio / DOM), so they are unit-tested and reusable on any platform.

export const WHISPER_SAMPLE_RATE = 16000;

/** Average N input channels into a single mono Float32 buffer. */
export function mergeToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const len = channels[0].length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i] ?? 0;
    out[i] = sum / channels.length;
  }
  return out;
}

/** Linear-interpolation resample of mono PCM to a target sample rate. Good
 *  enough for speech recognition and dependency-free. */
export function resample(
  input: Float32Array,
  inputRate: number,
  outputRate: number = WHISPER_SAMPLE_RATE,
): Float32Array {
  if (inputRate === outputRate || input.length === 0) return input;
  const ratio = inputRate / outputRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Concatenate Float32 chunks into one buffer. */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Root-mean-square level (0..1) — used to skip transcribing near-silent
 *  chunks so we don't waste a model pass (and don't hallucinate text on
 *  silence, which Whisper is prone to). */
export function rms(buf: Float32Array): number {
  if (buf.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/** Seconds of audio represented by a buffer at a given rate. */
export function durationSeconds(samples: number, rate: number): number {
  return rate > 0 ? samples / rate : 0;
}

/**
 * Sum two mono PCM buffers sample-for-sample, e.g. a mic capture and a
 * separately-clocked native system-audio tap that both cover roughly the same
 * ~5s window. Zero-padded to the longer buffer rather than truncated, so
 * neither source's tail is silently dropped when the two aren't drained at
 * exactly the same instant. Not sample-accurate sync — the two sources can
 * drift by a few milliseconds relative to each other — but that's well within
 * what a speech model tolerates over a few seconds of audio.
 */
export function mixFloat32(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(-1, Math.min(1, (a[i] ?? 0) + (b[i] ?? 0)));
  }
  return out;
}
