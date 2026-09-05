// In-process on-device LLM (llama.cpp via the `llama-cpp-2` crate). Powers the
// meeting copilot, proactive coaching suggestions and post-meeting notes with
// NO third-party app and NO separate server process: the GGUF weights are
// auto-downloaded once into the app data dir and the model runs inside the
// Tauri core. Behind the `native-ai` feature, like the whisper/sherpa engines;
// without it every entry point returns an explicit error (never fake output).
//
// Default model: Qwen2.5-1.5B-Instruct (Q4_K_M, ~1.1 GB) — small enough to run
// on a laptop CPU, strong enough for grounded meeting Q&A and summarisation.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use super::models_dir;

pub const LLM_MODEL: &str = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
pub const LLM_MODEL_NAME: &str = "Qwen2.5 1.5B Instruct";
const LLM_URL: &str = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf";

// Download progress is shared with the UI via `llm_status`.
static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static PROGRESS: AtomicU32 = AtomicU32::new(0); // 0..=1000 (tenths of a percent)

#[derive(Serialize, Clone)]
pub struct LlmStatus {
    /// Built with `--features native-ai` (the engine is compiled in).
    pub compiled: bool,
    /// The GGUF weights are present on disk and ready to run.
    pub model_ready: bool,
    /// A download is currently in flight.
    pub downloading: bool,
    /// 0–100 while downloading.
    pub progress: f32,
    pub model_name: String,
}

#[derive(Deserialize, Clone)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

pub fn llm_model_path(app: &tauri::AppHandle) -> PathBuf {
    models_dir(app).join(LLM_MODEL)
}

/// Lifecycle status — safe to call whether or not the feature is compiled.
pub fn status(app: &tauri::AppHandle) -> LlmStatus {
    LlmStatus {
        compiled: cfg!(feature = "native-ai"),
        model_ready: llm_model_path(app).exists(),
        downloading: DOWNLOADING.load(Ordering::Relaxed),
        progress: PROGRESS.load(Ordering::Relaxed) as f32 / 10.0,
        model_name: LLM_MODEL_NAME.to_string(),
    }
}

/// Render OpenAI-style messages into Qwen's ChatML prompt. Pure — unit-tested.
pub fn render_chatml(messages: &[ChatMsg]) -> String {
    let mut out = String::new();
    for m in messages {
        out.push_str("<|im_start|>");
        out.push_str(&m.role);
        out.push('\n');
        out.push_str(m.content.trim());
        out.push_str("<|im_end|>\n");
    }
    out.push_str("<|im_start|>assistant\n");
    out
}

#[cfg(not(feature = "native-ai"))]
mod inner {
    use super::*;
    const MSG: &str =
        "On-device AI is not compiled into this build. Rebuild with `--features native-ai` (see docs/NATIVE_AI.md).";
    pub fn download_model(_app: &tauri::AppHandle) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn chat(_app: &tauri::AppHandle, _m: &[ChatMsg], _t: f32, _n: u32) -> Result<String, String> {
        Err(MSG.into())
    }
}

#[cfg(feature = "native-ai")]
mod inner {
    use super::*;
    use std::fs;
    use std::io::{Read, Write};
    use std::sync::{Mutex, OnceLock};

    use llama_cpp_2::context::params::LlamaContextParams;
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::llama_batch::LlamaBatch;
    use llama_cpp_2::model::params::LlamaModelParams;
    use llama_cpp_2::model::{AddBos, LlamaModel};
    use llama_cpp_2::sampling::LlamaSampler;

    // ggml can only be initialised once per process, and the (large) model is
    // expensive to load, so both are cached for the life of the app. A fresh
    // context is created per request (contexts borrow the model, so they can't
    // be shared across threads).
    struct Engine {
        backend: LlamaBackend,
        model: LlamaModel,
    }
    static ENGINE: OnceLock<Mutex<Engine>> = OnceLock::new();

    fn engine(path: &std::path::Path) -> Result<&'static Mutex<Engine>, String> {
        if let Some(e) = ENGINE.get() {
            return Ok(e);
        }
        let backend = LlamaBackend::init().map_err(|e| format!("llama backend init failed: {e}"))?;
        // Offload as many layers as the platform GPU allows (Metal on macOS,
        // CUDA/Vulkan where built); clamped to CPU automatically otherwise.
        let params = LlamaModelParams::default().with_n_gpu_layers(999);
        let model = LlamaModel::load_from_file(&backend, path, &params)
            .map_err(|e| format!("failed to load model: {e}"))?;
        let _ = ENGINE.set(Mutex::new(Engine { backend, model }));
        ENGINE.get().ok_or_else(|| "engine init race".to_string())
    }

    pub fn download_model(app: &tauri::AppHandle) -> Result<(), String> {
        let dir = models_dir(app);
        let path = dir.join(LLM_MODEL);
        if path.exists() {
            PROGRESS.store(1000, Ordering::Relaxed);
            return Ok(());
        }
        if DOWNLOADING.swap(true, Ordering::SeqCst) {
            return Ok(()); // a download is already running
        }
        let result = (|| -> Result<(), String> {
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            PROGRESS.store(0, Ordering::Relaxed);
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(3600))
                .build()
                .map_err(|e| e.to_string())?;
            let mut resp = client.get(LLM_URL).send().map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!("Model download failed ({}).", resp.status()));
            }
            let total = resp.content_length().unwrap_or(0);
            let tmp = dir.join(format!("{LLM_MODEL}.part"));
            let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
            let mut buf = [0u8; 1 << 20];
            let mut done: u64 = 0;
            loop {
                let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                f.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                done += n as u64;
                if total > 0 {
                    PROGRESS.store(((done * 1000) / total) as u32, Ordering::Relaxed);
                }
            }
            f.flush().map_err(|e| e.to_string())?;
            fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
            PROGRESS.store(1000, Ordering::Relaxed);
            Ok(())
        })();
        DOWNLOADING.store(false, Ordering::SeqCst);
        result
    }

    pub fn chat(app: &tauri::AppHandle, messages: &[ChatMsg], temperature: f32, max_tokens: u32) -> Result<String, String> {
        let path = llm_model_path(app);
        if !path.exists() {
            return Err("The on-device model isn't downloaded yet. Open Settings → On-device AI.".into());
        }
        let engine = engine(&path)?;
        let guard = engine.lock().map_err(|_| "engine lock poisoned".to_string())?;
        let model = &guard.model;
        let backend = &guard.backend;

        const N_CTX: usize = 8192;
        let max_new = max_tokens.max(16) as usize;

        // Tokenise the ChatML prompt. `str_to_token` parses the ChatML control
        // tokens (<|im_start|> etc.) as specials. If the prompt is too long for
        // the window, keep the most recent tokens (the question lives at the end).
        let prompt = render_chatml(messages);
        let mut tokens = model
            .str_to_token(&prompt, AddBos::Never)
            .map_err(|e| format!("tokenise failed: {e}"))?;
        let budget = N_CTX.saturating_sub(max_new + 8);
        if tokens.len() > budget {
            tokens = tokens.split_off(tokens.len() - budget);
        }

        let mut ctx = model
            .new_context(backend, LlamaContextParams::default().with_n_ctx(std::num::NonZeroU32::new(N_CTX as u32)))
            .map_err(|e| format!("context init failed: {e}"))?;

        let mut batch = LlamaBatch::new(N_CTX.max(512), 1);
        let last = tokens.len() - 1;
        for (i, tok) in tokens.iter().enumerate() {
            batch.add(*tok, i as i32, &[0], i == last).map_err(|e| e.to_string())?;
        }
        ctx.decode(&mut batch).map_err(|e| format!("decode failed: {e}"))?;

        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::top_k(40),
            LlamaSampler::top_p(0.95, 0),
            LlamaSampler::temp(temperature.max(0.0)),
            LlamaSampler::dist(1234),
        ]);

        let mut out = String::new();
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut n_cur = tokens.len() as i32;
        for _ in 0..max_new {
            let next = sampler.sample(&ctx, batch.n_tokens() - 1);
            sampler.accept(next);
            if next == model.token_eos() {
                break;
            }
            let piece = model
                .token_to_piece(next, &mut decoder, false, None)
                .map_err(|e| e.to_string())?;
            out.push_str(&piece);

            batch.clear();
            batch.add(next, n_cur, &[0], true).map_err(|e| e.to_string())?;
            n_cur += 1;
            ctx.decode(&mut batch).map_err(|e| format!("decode failed: {e}"))?;
        }
        Ok(out.trim().to_string())
    }
}

pub use inner::{chat, download_model};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_chatml() {
        let msgs = vec![
            ChatMsg { role: "system".into(), content: "Be terse.".into() },
            ChatMsg { role: "user".into(), content: "Hi".into() },
        ];
        let p = render_chatml(&msgs);
        assert_eq!(
            p,
            "<|im_start|>system\nBe terse.<|im_end|>\n<|im_start|>user\nHi<|im_end|>\n<|im_start|>assistant\n"
        );
    }
}
