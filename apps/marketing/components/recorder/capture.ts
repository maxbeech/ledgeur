// Web Audio capture controller. Mixes the user's microphone with the shared
// meeting-tab audio (getDisplayMedia) into one mono PCM stream and accumulates
// it so the recorder can drain new audio periodically for live transcription.
// Browser-only; kept out of React for clarity.

import { concatFloat32 } from "@/lib/audio";

export interface CaptureResult {
  sampleRate: number;
}

export class AudioCapture {
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private streams: MediaStream[] = [];
  private chunks: Float32Array[] = []; // only audio NOT yet drained (bounded memory)
  private totalSamples = 0; // running count for elapsed time (chunks are discarded)
  sampleRate = 0;
  onLevel?: (rms: number) => void;

  /** Request mic and/or tab audio and begin accumulating PCM. */
  async start(opts: { mic: boolean; tab: boolean }): Promise<void> {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.sampleRate = ctx.sampleRate;
    const sources: MediaStreamAudioSourceNode[] = [];

    if (opts.tab) {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      this.streams.push(display);
      if (display.getAudioTracks().length === 0) {
        throw new Error("No tab audio was shared. Re-share and tick 'Share tab audio'.");
      }
      // Drop the video track immediately — we only need the audio.
      display.getVideoTracks().forEach((t) => t.stop());
      sources.push(ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())));
    }
    if (opts.mic) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.streams.push(mic);
      sources.push(ctx.createMediaStreamSource(mic));
    }
    if (sources.length === 0) throw new Error("Choose microphone and/or meeting audio.");

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
    // Sources sum at the node input (mic + tab mixed). Route to a muted gain so
    // the processor runs without playing audio back (no echo/feedback).
    for (const s of sources) s.connect(node);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    sink.connect(ctx.destination);
  }

  /** Float32 of audio captured since the previous drain, then discarded so
   *  memory stays bounded to ~one chunk window even for long meetings. */
  drainNew(): Float32Array {
    const fresh = concatFloat32(this.chunks);
    this.chunks = [];
    return fresh;
  }

  totalSeconds(): number {
    return this.sampleRate ? this.totalSamples / this.sampleRate : 0;
  }

  async stop(): Promise<void> {
    this.node?.disconnect();
    this.node = null;
    for (const s of this.streams) s.getTracks().forEach((t) => t.stop());
    this.streams = [];
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();
    this.ctx = null;
  }

  /** Decode an uploaded audio file to mono Float32 + its sample rate. */
  static async decodeFile(file: File): Promise<{ audio: Float32Array; sampleRate: number }> {
    return AudioCapture.decodeArrayBuffer(await file.arrayBuffer());
  }

  /** Decode raw audio bytes (file or fetched sample) to mono Float32 + rate. */
  static async decodeArrayBuffer(bytes: ArrayBuffer): Promise<{ audio: Float32Array; sampleRate: number }> {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(bytes.slice(0));
    const channels: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
    const len = buf.length;
    const mono = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let sum = 0;
      for (const ch of channels) sum += ch[i];
      mono[i] = sum / channels.length;
    }
    const sampleRate = buf.sampleRate;
    await ctx.close();
    return { audio: mono, sampleRate };
  }
}
