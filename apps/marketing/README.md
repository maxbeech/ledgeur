# ParleyNotes

**Open-source, private AI meeting notes that run 100% in your browser.**

ParleyNotes is the open alternative to Granola, Otter and Fireflies. Record (or
upload) a meeting and get an instant transcript and structured notes —
transcribed entirely on your device with [OpenAI Whisper](https://github.com/openai/whisper)
via [transformers.js](https://github.com/huggingface/transformers.js). No bot
joins your call, no audio leaves your machine, no per-seat fee.

- 🔒 **100% on-device** — audio is transcribed in your browser; nothing is uploaded.
- 🤖 **No bot** — captures the meeting tab's audio directly; nothing in the participant list.
- 🆓 **Free for individuals** — unlimited recordings, no minute caps.
- 🧩 **Open source (MIT)** — auditable and self-hostable.
- 📝 **Smart notes** — free on-device summarizer, or bring your own AI key (OpenAI / OpenRouter / Groq).

## How it works

1. **Capture** — share your meeting tab (with audio) + your mic, upload an audio file, or
   hit **Try with a sample clip** to see it work instantly. The app detects your browser's
   capabilities and guides you if a mode isn't supported (e.g. tab audio on mobile).
2. **Transcribe** — Whisper runs in a Web Worker via WebGPU (or WASM fallback). Pick a model:
   **English · fast** (`whisper-tiny.en`, small first download — the default), **English ·
   accurate** (`whisper-base.en`), or **Multilingual**. The model streams once from the
   Hugging Face CDN and is then cached.
3. **Notes** — one click turns the transcript into a summary, decisions and action items.
   Edit the Markdown, save it locally (IndexedDB), or export it.

## Tech

- Next.js 16 (App Router) + Tailwind CSS 4
- transformers.js (Whisper `whisper-base.en` / `whisper-tiny.en`) loaded from CDN in a Web Worker
- Web Audio API for capture (`getDisplayMedia` tab audio + `getUserMedia` mic)
- IndexedDB for local storage — no backend, no database

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # pure-logic + data-integrity tests
npm run lint
```

## Pricing

Free forever for individuals. **Team** ($6/user/mo) adds a shared workspace.
A **Company license** adds a supported self-host bundle (Docker/Helm), SSO/SAML,
an admin console and an SLA. You can always self-host the open-source build for free.

## Privacy

ParleyNotes has no server-side processing of your meetings. Audio is captured and
transcribed in the browser; notes are stored in your browser's IndexedDB. If you
add your own AI key, the transcript is sent **directly** from your browser to your
chosen provider — never through a ParleyNotes server.

## Licence

MIT © ParleyNotes
