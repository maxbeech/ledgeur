// Main-thread controller around the Whisper Web Worker. Serialises requests so
// only one transcription runs at a time (the worker shares one pipeline). Lives
// outside React so the component stays small.

type Handlers = {
  onDevice?: (device: string) => void;
  onProgress?: (file: string, progress: number) => void;
  onReady?: () => void;
};

let counter = 0;

export class TranscriberController {
  private worker: Worker | null = null;
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  private handlers: Handlers;

  constructor(handlers: Handlers = {}) {
    this.handlers = handlers;
  }

  init() {
    if (this.worker) return;
    this.worker = new Worker("/transcribe.worker.js", { type: "module" });
    this.worker.addEventListener("message", (e: MessageEvent) => {
      const d = e.data || {};
      switch (d.status) {
        case "device":
          this.handlers.onDevice?.(d.device);
          break;
        case "progress":
          this.handlers.onProgress?.(d.file, d.progress);
          break;
        case "ready":
          this.handlers.onReady?.();
          break;
        case "result": {
          const p = this.pending.get(d.id);
          if (p) { this.pending.delete(d.id); p.resolve(d.text || ""); }
          break;
        }
        case "error": {
          if (d.id != null && this.pending.has(d.id)) {
            const p = this.pending.get(d.id)!;
            this.pending.delete(d.id);
            p.reject(new Error(d.message));
          }
          break;
        }
      }
    });
  }

  /** Begin downloading + warming the model. lang: "en" | "multi". */
  preload(lang: string = "en") {
    this.init();
    this.worker!.postMessage({ type: "load", lang });
  }

  /** Transcribe a 16 kHz mono Float32 buffer; resolves with the text. */
  transcribe(audio: Float32Array, lang: string = "en"): Promise<string> {
    this.init();
    const id = ++counter;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Transfer the buffer to avoid a copy.
      this.worker!.postMessage({ type: "transcribe", id, audio, lang }, [audio.buffer]);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
