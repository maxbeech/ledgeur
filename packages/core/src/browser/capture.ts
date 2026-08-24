// Web Audio capture: microphone, shared meeting audio, or both mixed into one
// mono PCM stream that the recorder drains periodically.
//
// The canonical copy. The website and the app each carried their own, and they
// had already drifted — one called the shared-audio option `tab` and the other
// `system`, and only one of them stopped the video track. That is exactly the
// kind of divergence that produces "it works on the website but not in the app"
// bug reports nobody can reproduce.
//
// ── Memory ──────────────────────────────────────────────────────────────────
// Only audio not yet drained is held. A one-hour meeting is ~230 MB of Float32
// at 16 kHz, and more at a device's native 48 kHz, so nothing keeps the whole
// recording: the transcript and the diarization vectors are produced as it goes
// and the audio is discarded behind them.

import { concatFloat32 } from "../audio/pcm.ts";

/**
 * A failure whose message is already written for a person.
 *
 * Marked with a class rather than detected by ruling out `DOMException`, which
 * is what this used to do. That test was true for real browser rejections but
 * fragile in every other case: a plain `Error` from a polyfill, a shim, or
 * another realm would slip through untranslated and put something like
 * "NotReadableError: Could not start video source" in front of a user. The
 * default is now to translate, and only messages we wrote ourselves opt out.
 */
export class CaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureError";
  }
}

/**
 * Turn a getUserMedia / getDisplayMedia rejection into something a person can
 * act on.
 *
 * These reject with DOMException names — `NotAllowedError`, `NotFoundError`,
 * `NotReadableError` — and nothing else. Showing "NotAllowedError" to somebody
 * who has just clicked Block tells them nothing, and showing nothing at all
 * (which is what happened before) makes the button look broken.
 */
export function friendlyCaptureError(err: unknown, source: "mic" | "system"): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  const raw = String((err as { message?: string } | null)?.message ?? err ?? "").trim();
  const thing = source === "mic" ? "your microphone" : "the meeting audio";

  if (name === "NotAllowedError" || /permission denied|not allowed/i.test(raw)) {
    return source === "mic"
      ? "Ledgeur needs permission to use your microphone. Allow it when your browser asks — or, if you blocked it earlier, click the padlock in the address bar and re-enable the microphone for this site."
      : "You dismissed the sharing window, so nothing was captured. Start again and pick the tab or window your meeting is in — and tick “Also share tab audio”, or the other people will not be recorded.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return source === "mic"
      ? "No microphone was found. Plug one in, or choose a different input in your system's sound settings, and try again."
      : "Nothing was available to share. Make sure the meeting is open in another tab or window.";
  }
  if (name === "NotReadableError" || /could not start/i.test(raw)) {
    return `Your browser could not start ${thing} — usually because another app is already using it. Close anything else that is recording (including other meeting apps) and try again.`;
  }
  if (name === "SecurityError" || /secure context|https/i.test(raw)) {
    return "Recording needs a secure connection. Open Ledgeur over https, or on localhost.";
  }
  if (name === "AbortError") {
    return `Capturing ${thing} was interrupted before it started. Try again.`;
  }
  // Never swallow the original: an unrecognised failure still has to be
  // diagnosable from a bug report.
  return raw
    ? `Ledgeur could not start recording ${thing}.\n(${raw})`
    : `Ledgeur could not start recording ${thing}.`;
}

export interface CaptureSources {
  /** The user's own microphone. */
  mic: boolean;
  /**
   * Audio shared through the screen-share picker — a browser tab, a window, or
   * the whole system, depending on what the user chooses and what their browser
   * offers. This is how the other participants are heard without a bot joining
   * the call.
   */
  system: boolean;
}

export class AudioCapture {
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private streams: MediaStream[] = [];
  /** Audio not yet drained. Bounded: drained audio is dropped. */
  private chunks: Float32Array[] = [];
  /** Running count, kept after chunks are discarded, so elapsed time survives. */
  private totalSamples = 0;
  sampleRate = 0;
  onLevel?: (rms: number) => void;
  /** Fires when the user stops the share from the browser's own bar, which is
   *  otherwise a silent recording that captures nothing. */
  onSystemAudioEnded?: () => void;

  /** Request the chosen sources and begin accumulating PCM. */
  async start(sources: CaptureSources): Promise<void> {
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.sampleRate = ctx.sampleRate;
    const nodes: MediaStreamAudioSourceNode[] = [];

    // Which source is being opened, so a failure can name the right one.
    let opening: "mic" | "system" = "system";
    try {
      if (sources.system) {
        // `video: true` is required — Chrome will not offer audio for a
        // display capture requested without it, even though we discard it.
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        this.streams.push(display);
        if (display.getAudioTracks().length === 0) {
          throw new CaptureError(
            "No audio was shared, so the other people in the meeting would not be recorded. " +
            "Share again and tick “Also share tab audio”.",
          );
        }
        // Drop the video immediately: we only ever wanted the audio, and a live
        // video track keeps the "sharing your screen" indicator burning.
        display.getVideoTracks().forEach((t) => t.stop());
        const [track] = display.getAudioTracks();
        track.addEventListener("ended", () => this.onSystemAudioEnded?.(), { once: true });
        nodes.push(ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())));
      }
      if (sources.mic) {
        opening = "mic";
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        this.streams.push(mic);
        nodes.push(ctx.createMediaStreamSource(mic));
      }
    } catch (e) {
      // A half-opened capture holds a live microphone light and a screen-share
      // banner over a recording that will never start. Close it before
      // rethrowing.
      await this.stop();
      // Translate by default. Only a message this file wrote is passed through,
      // because only those are already written for a person.
      throw e instanceof CaptureError ? e : new CaptureError(friendlyCaptureError(e, opening));
    }

    if (nodes.length === 0) {
      await this.stop();
      throw new CaptureError("Choose your microphone, the meeting audio, or both.");
    }

    const node = ctx.createScriptProcessor(4096, 1, 1);
    this.node = node;
    node.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.chunks.push(copy);
      this.totalSamples += copy.length;
      if (this.onLevel) {
        let sum = 0;
        for (let i = 0; i < copy.length; i++) sum += copy[i] * copy[i];
        this.onLevel(Math.sqrt(sum / copy.length));
      }
    };

    // Sources sum at the node's input, mixing mic and shared audio. The output
    // goes to a muted gain so the processor keeps running without playing the
    // meeting back into the room, which would feed back.
    for (const s of nodes) s.connect(node);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    sink.connect(ctx.destination);
  }

  /**
   * How much audio is waiting to be drained, in samples.
   *
   * Needed because `drainNew` empties the buffer: checking "is there anything
   * left?" by draining it would discard exactly the audio the caller was trying
   * to make sure it kept.
   */
  pendingSamples(): number {
    let total = 0;
    for (const c of this.chunks) total += c.length;
    return total;
  }

  /** Audio captured since the previous drain. The buffer is then released. */
  drainNew(): Float32Array {
    const fresh = concatFloat32(this.chunks);
    this.chunks = [];
    return fresh;
  }

  totalSeconds(): number {
    return this.sampleRate ? this.totalSamples / this.sampleRate : 0;
  }

  async stop(): Promise<void> {
    if (this.node) {
      this.node.onaudioprocess = null;
      this.node.disconnect();
      this.node = null;
    }
    for (const s of this.streams) s.getTracks().forEach((t) => t.stop());
    this.streams = [];
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();
    this.ctx = null;
  }

  /** Decode an audio or video file to mono Float32 plus its sample rate. */
  static async decodeFile(file: File): Promise<{ audio: Float32Array; sampleRate: number }> {
    return AudioCapture.decodeArrayBuffer(await file.arrayBuffer());
  }

  /** Decode raw bytes — an uploaded file, or a fetched sample clip. */
  static async decodeArrayBuffer(bytes: ArrayBuffer): Promise<{ audio: Float32Array; sampleRate: number }> {
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    try {
      // decodeAudioData detaches the buffer it is given, so it gets a copy —
      // otherwise a retry after a failure would decode zero bytes.
      const buf = await ctx.decodeAudioData(bytes.slice(0));
      const channels: Float32Array[] = [];
      for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
      const mono = new Float32Array(buf.length);
      for (let i = 0; i < buf.length; i++) {
        let sum = 0;
        for (const ch of channels) sum += ch[i];
        mono[i] = sum / channels.length;
      }
      return { audio: mono, sampleRate: buf.sampleRate };
    } finally {
      await ctx.close();
    }
  }
}
