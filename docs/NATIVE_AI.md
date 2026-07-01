# On-device AI (native engine)

ParleyNotes transcribes, diarizes and reasons entirely on the user's device. The
heavy native engine is behind a Cargo feature so the base app stays fast to build.

## What runs where

| Capability | Engine | Where |
|---|---|---|
| Real-time transcription | **whisper.cpp** (`whisper-rs`) | Rust command `transcribe_chunk` |
| Speaker diarization + confidence | **sherpa-onnx** (`sherpa-rs`) | Rust command `transcribe_diarize` |
| In-meeting / anytime chat + embeddings | **llama.cpp** server (OpenAI-compatible) | `http://127.0.0.1:8081/v1` |

The webview fallback (transformers.js Whisper) is used automatically when the
native engine isn't compiled/available, so the app always works.

## Build with the native engine

Requires a C/C++ toolchain + CMake (both present on macOS with Xcode + Homebrew).

```bash
# Desktop, native engine on:
pnpm --filter @parleynotes/desktop tauri:dev:ai      # dev
pnpm --filter @parleynotes/desktop tauri:build:ai    # release

# Or check just the Rust crate:
cd apps/desktop/src-tauri && cargo check --features native-ai
```

`whisper-rs` compiles whisper.cpp via CMake; `sherpa-rs` downloads prebuilt
sherpa-onnx libs from GitHub releases (set `UNSAFE_DISABLE_CHECKSUM_VALIDATION=1`
only if a release checksum lags a new version).

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

| File | Source |
|---|---|
| `ggml-base.en.bin` | huggingface.co/ggerganov/whisper.cpp |
| `pyannote-segmentation-3.0.onnx` | sherpa-onnx pyannote segmentation |
| `speaker-embedding.onnx` | sherpa-onnx 3D-Speaker embedding |

## Local chat/embeddings server (llama.cpp)

The chat + RAG features talk to an OpenAI-compatible endpoint (default
`VITE_LOCAL_LLM_URL=http://127.0.0.1:8081/v1`). Run any llama.cpp server, e.g.:

```bash
llama-server -hf ggml-org/gemma-3-4b-it-GGUF --port 8081 --embeddings
```

Point the embeddings model at `nomic-embed-text` (768-dim, matching the
`embeddings.embedding vector(768)` column). If the server isn't running, chat and
indexing show an explicit "model unavailable" error — never a fabricated answer.

## Manual test checklist (can't be verified headless)

- [ ] `tauri:dev:ai` launches; `ai_status` reports `compiled: true`.
- [ ] Download models; record a short meeting → live transcript appears; on stop,
      the transcript shows multiple `Speaker N` labels + per-segment confidence.
- [ ] Start a llama.cpp server → in-meeting chat + Ask return grounded answers.
