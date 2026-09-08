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

/// Field names are camelCase on the wire.
///
/// They were not, and every one of these was read as `undefined` by the UI: the
/// TypeScript side (`LlmStatus` in src/lib/llm.ts) has always read `modelReady`
/// and `modelName`, so `model_ready` never reached it. `ready` was therefore
/// permanently false with the weights sitting on disk, which is three separate
/// reported bugs in one: the "download the copilot" banner never went away, its
/// button did nothing visible (the command correctly returns at once when the
/// file is already there), and `nativeChat` refused to run at all — so every
/// meeting fell back to the extractive summariser and said the assistant
/// "wasn't available". Pinned by `status_is_camel_case_on_the_wire` below.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
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

/// Render messages into ChatML turns, without the trailing assistant opener.
/// Split out from `render_chatml` so the leading system turns can be tokenised
/// on their own and protected from truncation — see `chat`.
pub fn render_chatml_turns(messages: &[ChatMsg]) -> String {
    let mut out = String::new();
    for m in messages {
        out.push_str("<|im_start|>");
        out.push_str(&m.role);
        out.push('\n');
        out.push_str(m.content.trim());
        out.push_str("<|im_end|>\n");
    }
    out
}

/// Render OpenAI-style messages into Qwen's ChatML prompt. Pure — unit-tested.
pub fn render_chatml(messages: &[ChatMsg]) -> String {
    let mut out = render_chatml_turns(messages);
    out.push_str("<|im_start|>assistant\n");
    out
}

/// How many leading messages are system messages. Those carry the instructions
/// (and, for notes, the JSON contract), so they are never what gets dropped.
pub fn system_prefix_len(messages: &[ChatMsg]) -> usize {
    messages.iter().take_while(|m| m.role == "system").count()
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
            // Worth logging: "I pressed Download and nothing happened" looks
            // identical to a failure from the outside, and this is the branch
            // that produces it once the weights are already on disk.
            log::info!("download_llm: weights already present at {}", path.display());
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
        chat_at(&path, messages, temperature, max_tokens)
    }

    /// The generation itself, against an explicit weights path. Split from
    /// `chat` so the notes prompt can be run end to end without an AppHandle:
    /// whether this model actually returns the JSON the notes parser expects is
    /// not something reading the code can answer. See `writes_parseable_notes`.
    pub(in crate::ai) fn chat_at(
        path: &std::path::Path, messages: &[ChatMsg], temperature: f32, max_tokens: u32,
    ) -> Result<String, String> {
        let engine = engine(path)?;
        let guard = engine.lock().map_err(|_| "engine lock poisoned".to_string())?;
        let model = &guard.model;
        let backend = &guard.backend;

        const N_CTX: usize = 8192;
        let max_new = max_tokens.max(16) as usize;

        // Tokenise the ChatML prompt. `str_to_token` parses the ChatML control
        // tokens (<|im_start|> etc.) as specials.
        //
        // Truncation keeps the leading system turns and trims the front of what
        // follows. This used to be a plain "keep the most recent tokens", on the
        // reasoning that the question lives at the end — true for chat, wrong for
        // everything else: for note-writing the instructions and the JSON
        // contract are at the HEAD, so any transcript long enough to overflow the
        // window silently cost the model its instructions. It then replied with
        // prose, the JSON parse failed, and the meeting quietly fell back to
        // summary bullets lifted verbatim out of the transcript.
        let split = system_prefix_len(messages);
        let head = model
            .str_to_token(&render_chatml_turns(&messages[..split]), AddBos::Never)
            .map_err(|e| format!("tokenise failed: {e}"))?;
        let mut tail = model
            .str_to_token(&render_chatml(&messages[split..]), AddBos::Never)
            .map_err(|e| format!("tokenise failed: {e}"))?;

        // Reserve the system turns and the reply; whatever is left is the budget
        // for the conversation. If the system prompt alone cannot fit, there is
        // nothing sensible to trim and the caller gets a real error rather than a
        // confidently wrong answer off a mangled prompt.
        let reserved = head.len() + max_new + 8;
        let budget = N_CTX.checked_sub(reserved).filter(|b| *b > 0).ok_or_else(|| {
            format!("Prompt is too long for the model's {N_CTX}-token window.")
        })?;
        if tail.len() > budget {
            log::warn!("llm: trimming {} prompt tokens to fit the context window", tail.len() - budget);
            tail = tail.split_off(tail.len() - budget);
        }
        let mut tokens = head;
        tokens.extend(tail);
        if tokens.is_empty() {
            return Err("Nothing to send to the model.".into());
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

    #[test]
    fn turns_render_without_the_assistant_opener() {
        let msgs = vec![ChatMsg { role: "system".into(), content: "Be terse.".into() }];
        assert_eq!(render_chatml_turns(&msgs), "<|im_start|>system\nBe terse.<|im_end|>\n");
        // The two halves must reassemble into exactly what render_chatml gives,
        // or the split-and-truncate in `chat` would change the prompt shape.
        let all = vec![
            ChatMsg { role: "system".into(), content: "Be terse.".into() },
            ChatMsg { role: "user".into(), content: "Hi".into() },
        ];
        let split = system_prefix_len(&all);
        assert_eq!(
            format!("{}{}", render_chatml_turns(&all[..split]), render_chatml(&all[split..])),
            render_chatml(&all)
        );
    }

    /// The names the UI actually reads. `LlmStatus` was serialised with Rust's
    /// snake_case field names while src/lib/llm.ts read `modelReady` and
    /// `modelName`, so readiness was permanently `undefined` — the copilot
    /// banner never cleared, its Download button looked dead, and note-writing
    /// fell back to the extractive summariser on every meeting. Asserting the
    /// wire names (not the struct) is the only thing that catches it: both
    /// sides compile perfectly either way.
    #[test]
    fn status_is_camel_case_on_the_wire() {
        let json = serde_json::to_value(LlmStatus {
            compiled: true,
            model_ready: true,
            downloading: false,
            progress: 12.5,
            model_name: LLM_MODEL_NAME.to_string(),
        })
        .expect("status serialises");
        let obj = json.as_object().expect("an object");
        for key in ["compiled", "modelReady", "downloading", "progress", "modelName"] {
            assert!(obj.contains_key(key), "missing wire field {key} in {json}");
        }
        assert_eq!(obj.len(), 5, "unexpected extra fields in {json}");
        assert_eq!(json["modelReady"], serde_json::json!(true));
    }

    #[test]
    fn system_prefix_stops_at_the_first_non_system_turn() {
        let msgs = vec![
            ChatMsg { role: "system".into(), content: "a".into() },
            ChatMsg { role: "user".into(), content: "b".into() },
            // A later system message is NOT part of the protected prefix.
            ChatMsg { role: "system".into(), content: "c".into() },
        ];
        assert_eq!(system_prefix_len(&msgs), 1);
        assert_eq!(system_prefix_len(&[]), 0);
        assert_eq!(system_prefix_len(&msgs[1..]), 0);
    }
}

/// Runs the real notes prompt through the real weights.
///
/// Ignored by default: it needs the ~1.1 GB GGUF on disk. It exists because the
/// only question that matters for post-meeting notes cannot be answered by
/// reading code or by any unit test — does THIS model, at this size, actually
/// return the JSON object the parser expects, for a transcript shaped like a
/// real one? When it does not, the app falls back to lifting sentences out of
/// the transcript, which is what "the summary makes no sense" turned out to be.
///
///   cargo test --features native-ai writes_parseable_notes -- --ignored --nocapture
#[cfg(all(test, feature = "native-ai"))]
mod notes_integration {
    use super::*;

    /// Kept in step with BASE_SYSTEM in apps/desktop/src/lib/notes.ts.
    const NOTES_SYSTEM: &str = concat!(
        "You are an expert meeting-notes writer. You are given a speech-to-text transcript ",
        "where each line is `[time] Speaker: what they said`.\n\n",
        "Rules:\n",
        "- Be faithful. Never invent facts, names, numbers or commitments that are not in the transcript.\n",
        "- Keep exact figures, prices, percentages, dates and names exactly as they were said.\n",
        "- A DECISION is something the group settled on. Write what was agreed, including the ",
        "number or date they agreed. Do not write that something was discussed or considered.\n",
        "- An ACTION ITEM is a concrete follow-up someone committed to. Name who owns it.\n",
        "- An OPEN QUESTION is something explicitly left unresolved, parked or deferred.\n",
        "- Write in the past tense, about what happened.\n\n",
        "Reply with ONLY a JSON object of this exact shape, and nothing else:\n",
        r#"{"summary": string[], "actionItems": string[], "decisions": string[], "questions": string[]}"#,
        "\n\n\"summary\" is 3-6 short bullets covering what the meeting was about and what came out ",
        "of it. Use an empty array for any section the transcript does not cover.",
    );

    /// Speaker- and time-labelled, the way the recorder now sends it.
    const TRANSCRIPT: &str = "\
[00:03] Priya: Right, the pricing page. We said we'd decide today whether the team tier goes to 29 or stays at 24.
[00:14] Sam: I still think 29 is too steep for what's in it. Churn on the small accounts is already 4 percent.
[00:26] Priya: The margin at 24 doesn't cover support though. Marco, you had the numbers.
[00:35] Marco: At 24 we're at about 61 percent gross. At 29 it's 68. Support is the whole difference.
[00:48] Sam: Okay. What if we go to 29 but add the audit log, so it's not a bare price rise?
[01:02] Priya: I like that. Let's do 29 with audit log included, from the first of next month.
[01:11] Marco: I'll update the pricing page and the Stripe products before Friday.
[01:19] Sam: And I'll write to the twelve accounts on the old plan and explain the grandfathering.
[01:30] Priya: One thing we haven't settled is whether annual gets the same treatment. Park it for now.";

    #[test]
    #[ignore = "needs the on-device model downloaded"]
    fn writes_parseable_notes() {
        let home = std::env::var("HOME").expect("HOME");
        let path = std::path::PathBuf::from(home)
            .join("Library/Application Support/com.maxbeech.ledgeur/models")
            .join(LLM_MODEL);
        if !path.exists() {
            eprintln!("skipping: no weights at {}", path.display());
            return;
        }
        let messages = vec![
            ChatMsg { role: "system".into(), content: NOTES_SYSTEM.into() },
            ChatMsg { role: "user".into(), content: format!("Transcript:\n\n{TRANSCRIPT}") },
        ];

        let started = std::time::Instant::now();
        let reply = inner::chat_at(&path, &messages, 0.2, 768).expect("the model answers");
        println!("--- {:?} ---\n{reply}\n---", started.elapsed());

        // parseAiNotes (notes.ts) takes the first {...} span and requires a
        // non-empty summary; anything else falls back to the extractor.
        let start = reply.find('{').expect("reply contains a JSON object");
        let end = reply.rfind('}').expect("reply closes the JSON object");
        let parsed: serde_json::Value =
            serde_json::from_str(&reply[start..=end]).expect("the JSON parses");
        for key in ["summary", "actionItems", "decisions", "questions"] {
            assert!(parsed.get(key).is_some_and(|v| v.is_array()), "missing array field {key}");
        }
        let summary = parsed["summary"].as_array().unwrap();
        assert!(!summary.is_empty(), "an empty summary is treated as a failure");

        // Grounded in what was actually said, not lifted from it verbatim.
        let flat = parsed.to_string().to_lowercase();
        assert!(flat.contains("29"), "the decision's actual number should survive: {flat}");
        assert!(
            !summary.iter().any(|s| TRANSCRIPT.contains(s.as_str().unwrap_or("\0"))),
            "summary bullets are copied verbatim out of the transcript",
        );
        // The whole meeting has to fit: the last line is where the open question is.
        println!("summary points: {}, actions: {}", summary.len(), parsed["actionItems"].as_array().unwrap().len());
    }
}
