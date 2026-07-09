# On-device AI (native engine)

Ledgeur transcribes, diarizes and reasons entirely on the user's device. The
heavy native engine is behind a Cargo feature so the base app stays fast to build.

## What runs where

| Capability | Engine | Where |
|---|---|---|
| Real-time transcription | **whisper.cpp** (`whisper-rs`) | Rust command `transcribe_chunk` |
| Speaker diarization + confidence | **sherpa-onnx** (`sherpa-rs`) | Rust command `transcribe_diarize` |
| Speaker **identification** (named voices) | **sherpa-onnx** speaker embeddings + cosine match | `enroll_voice` / `list_voice_profiles` / `delete_voice_profile`; applied inside `transcribe_diarize` |
| Copilot chat · coaching suggestions · post-meeting notes | **llama.cpp in-process** (`llama-cpp-2`) | Rust commands `llm_chat` / `llm_status` / `download_llm` — no server, no third-party app |
| RAG embeddings (Ask semantic search) | OpenAI-compatible HTTP endpoint | `VITE_LOCAL_LLM_URL` (BYO key or external llama.cpp) — optional; Ask falls back to keyword search |

### Speaker identification

Enrol a voice in **Settings → On-device AI → Voice profiles** (~10 s of clear
speech). The embedding is stored in `voices.json` in the app data dir — voice
prints never leave the device. On stop, `transcribe_diarize` embeds each
diarized speaker's audio (up to 12 s) and cosine-matches against enrolled
profiles; matches at ≥ 0.5 similarity label the transcript with the real name
and a confidence figure (`speaker_confidence`). Unmatched speakers stay
anonymous "Speaker N" — identity is never guessed.

The webview fallback (transformers.js Whisper) is used automatically when the
native engine isn't compiled/available, so the app always works.

## Build with the native engine

Requires a C/C++ toolchain + CMake (both present on macOS with Xcode + Homebrew).

```bash
# Desktop, native engine on:
pnpm --filter @ledgeur/desktop tauri:dev:ai      # dev
pnpm --filter @ledgeur/desktop tauri:build:ai    # release

# Or check just the Rust crate:
cd apps/desktop/src-tauri && cargo check --features native-ai
```

`whisper-rs` and `llama-cpp-2` compile whisper.cpp / llama.cpp via CMake (picking
up Metal on macOS, CUDA/Vulkan where the toolchain provides it); `sherpa-rs`
downloads prebuilt sherpa-onnx libs from GitHub releases (set
`UNSAFE_DISABLE_CHECKSUM_VALIDATION=1` only if a release checksum lags a new
version).

### Offline / CI build (no GitHub release download)

If the build machine can't fetch GitHub release assets, download the sherpa-onnx
lib bundle once, set `sherpa-rs`'s `default-features = false` in
`src-tauri/Cargo.toml`, and point `SHERPA_LIB_PATH` at it:

```bash
# one-off, from anywhere with network:
curl -L -o sherpa.tar.bz2 \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.9/sherpa-onnx-v1.12.9-osx-universal2-shared.tar.bz2
tar xf sherpa.tar.bz2
export SHERPA_LIB_PATH="$PWD/sherpa-onnx-v1.12.9-osx-universal2-shared"
cargo check --features native-ai   # verified compiling on macOS arm64
```

## Models (downloaded on first use)

`Integrations → On-device AI → Download models` (or the `download_models`
command) fetches into the app data dir:

Transcription/diarization models (`download_models`):

| File | Source |
|---|---|
| `ggml-base.en.bin` | huggingface.co/ggerganov/whisper.cpp |
| `pyannote-segmentation-3.0.onnx` | sherpa-onnx pyannote segmentation |
| `speaker-embedding.onnx` | sherpa-onnx 3D-Speaker embedding |

Copilot LLM (`download_llm`, one tap in **Settings → On-device AI → Download
assistant**, or the inline prompt the first time you use the copilot):

| File | Source | Size |
|---|---|---|
| `qwen2.5-1.5b-instruct-q4_k_m.gguf` | huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF | ~1.1 GB |

## Copilot LLM (in-process, no server)

Chat, coaching suggestions and post-meeting notes run **inside the app** via
`llama-cpp-2` (`src-tauri/src/ai/llm.rs`) — there is no separate process and
nothing for the user to install. The weights are downloaded once (streamed with
progress) into the app data dir and cached; the model is loaded once and reused.

- Frontend entry point: `src/lib/llm.ts` (`chatComplete`) — **native first**,
  then an OpenAI-compatible HTTP fallback (`VITE_LOCAL_LLM_URL`, for a BYO cloud
  key or an external llama.cpp), then an explicit error. Never fabricates.
- Prompt format: Qwen ChatML (`render_chatml`, unit-tested). Sampler: top-k/top-p
  + temperature. Context window 8192; over-long prompts keep the most recent
  tokens (the question is at the tail).
- Post-meeting notes: `src/lib/notes.ts` asks the model for structured JSON
  (summary / action items / decisions / questions) and falls back to the local
  heuristic extractor (`packages/core` `summarizeTranscript`) when no model is
  available — so notes are always real, never blank, never invented.

RAG embeddings still use the HTTP endpoint (point it at `nomic-embed-text`,
768-dim, matching the `embeddings.embedding vector(768)` column). Native
embeddings are a follow-up; Ask degrades to keyword search without them.

## Manual test checklist (can't be verified headless)

- [ ] `tauri:dev:ai` launches; `ai_status` reports `compiled: true`, `llm_status`
      reports `compiled: true`.
- [ ] Download models; record a short meeting → live transcript appears as chat
      bubbles; on stop, multiple `Speaker N` labels + per-segment confidence.
- [ ] First copilot message shows the one-tap **Download assistant (~1 GB)**
      prompt; after download, `llm_status.model_ready` is true.
- [ ] In a meeting, type in the bottom input → copilot answers as a gold bubble;
      quoting a transcript line prepends it to the question. Proactive suggestions
      appear when enabled (Settings → Meeting copilot).
- [ ] Stop the meeting → summary + action items are written by the model (or the
      heuristic fallback if the model isn't downloaded). With "Save copilot chat"
      off (default), the saved meeting holds only the transcript.
