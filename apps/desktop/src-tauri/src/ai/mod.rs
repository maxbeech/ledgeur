// On-device AI: transcription (whisper.cpp via whisper-rs), speaker diarization
// (sherpa-onnx via sherpa-rs) and model management. The heavy engine lives in
// `engine.rs` behind the `native-ai` feature; when it's not compiled, commands
// return an explicit error (never fake results).

use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

pub mod engine;
pub mod live_speakers;
pub mod llm;
pub mod voices;

#[derive(Serialize, Clone, Debug)]
pub struct TranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub confidence: f32,
    /// Who said it, or `None` when nobody has been worked out yet.
    ///
    /// This was a `String` that every live chunk filled in with a flat
    /// "Speaker 1", because the live path had no speaker model in it at all —
    /// so a two-person meeting was rendered, confidently, as one person talking
    /// to themselves for its whole duration. There is now a real answer for the
    /// live path (`engine::live_speaker`), and `None` for the cases where there
    /// honestly isn't one: too little speech to place, or no embedding model on
    /// disk. The UI leaves those lines unattributed rather than inventing a name.
    pub speaker_label: Option<String>,
    pub speaker_confidence: Option<f32>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DiarSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub speaker: i32,
}

#[derive(Serialize)]
pub struct AiStatus {
    pub compiled: bool,
    pub models_ready: bool,
    pub whisper_model: bool,
    pub seg_model: bool,
    pub embed_model: bool,
    pub models_dir: String,
}

pub const WHISPER_MODEL: &str = "ggml-base.en.bin";
pub const SEG_MODEL: &str = "pyannote-segmentation-3.0.onnx";
/// English CAM++ (see `DOWNLOADS` in engine.rs for why it replaced the previous
/// Mandarin-trained model). The filename carries the model so an existing
/// install re-downloads rather than silently keeping the old weights.
pub const EMBED_MODEL: &str = "speaker-embedding-en-campplus.onnx";

/// Audio reaching the native engine is always 16 kHz mono: the recorder
/// resamples on the way out (`WHISPER_SAMPLE_RATE` in the web layer) and the
/// raw-bytes IPC below has no room for a sample-rate argument.
const IPC_SAMPLE_RATE: u32 = 16_000;

/// Emitted while the post-meeting pass runs, so the UI can show real progress
/// instead of looking hung. Payload is `DiarizeProgress`.
pub const DIARIZE_PROGRESS_EVENT: &str = "ai:diarize-progress";

#[derive(Serialize, Clone)]
pub struct DiarizeProgress {
    /// 0–100. Diarization only; transcription runs first and reports 0.
    pub percent: u32,
    /// Which phase the pass is in, for the label next to the bar.
    pub phase: &'static str,
}

pub fn models_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("models")
}

/// Ask macOS to run this thread at the speed a person is waiting at.
///
/// macOS schedules by quality-of-service class, and a QoS class decides which
/// *cores* a thread is allowed on: `BACKGROUND` is confined to the efficiency
/// cores. A thread also inherits the class of whichever thread created it, so
/// CPU-bound work handed to a pool thread — which is exactly what
/// `spawn_blocking` does — can end up pinned to the two slowest cores on the
/// machine without anything in the code saying so.
///
/// That is not a theoretical worry, it is the measurement. Transcribing 99 s of
/// audio took 228 s inside the shipped app and 8 s in a test on the same
/// machine, over the same models, with the same thread count: a ~25x gap that
/// nothing in the pipeline accounted for. `measures_qos_effect_on_inference` in
/// engine.rs reproduces it from either side.
///
/// `USER_INITIATED` rather than `USER_INTERACTIVE`: the user is waiting for
/// this, but it is not the window's redraw, and it must not outrank it.
pub fn run_at_user_speed() {
    #[cfg(target_os = "macos")]
    // SAFETY: sets a scheduling hint on the calling thread; it cannot fail in a
    // way that matters, and a non-zero return only means the class was refused.
    unsafe {
        libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_USER_INITIATED, 0);
    }
}

fn feature_compiled() -> bool {
    cfg!(feature = "native-ai")
}

/// One stretch of the meeting attributed to one person — what the pass on Stop
/// returns, for the caller to lay over the transcript it already has.
#[derive(Serialize, Clone, Debug)]
pub struct SpeakerTurn {
    pub start_ms: i64,
    pub end_ms: i64,
    /// The enrolled person's name where a voice profile matched, "Speaker N"
    /// otherwise.
    pub label: String,
    /// Set only when the label came from matching an enrolled voice — a number
    /// next to a name the user typed themselves would be impertinent.
    pub confidence: Option<f32>,
}

/// Name each diarized speaker: the enrolled identity where one matched, an
/// anonymous "Speaker N" otherwise. Pure — unit-tested.
pub fn label_turns(diar: &[DiarSegment], identities: &HashMap<i32, (String, f32)>) -> Vec<SpeakerTurn> {
    diar.iter()
        .map(|d| match identities.get(&d.speaker) {
            Some((name, sim)) => SpeakerTurn {
                start_ms: d.start_ms, end_ms: d.end_ms, label: name.clone(), confidence: Some(*sim),
            },
            // One place produces the "Speaker N" wording, shared with the live
            // path, so the two cannot number people differently.
            None => SpeakerTurn {
                start_ms: d.start_ms,
                end_ms: d.end_ms,
                label: live_speakers::speaker_label(d.speaker.max(0) as usize),
                confidence: None,
            },
        })
        .collect()
}

// ---------- Tauri commands ----------

#[tauri::command]
pub fn ai_status(app: tauri::AppHandle) -> AiStatus {
    let dir = models_dir(&app);
    let has = |f: &str| dir.join(f).exists();
    let (w, s, e) = (has(WHISPER_MODEL), has(SEG_MODEL), has(EMBED_MODEL));
    AiStatus {
        compiled: feature_compiled(),
        models_ready: w && s && e,
        whisper_model: w,
        seg_model: s,
        embed_model: e,
        models_dir: dir.to_string_lossy().to_string(),
    }
}

/// Runs on a blocking thread — see the comment on `transcribe_chunk` below.
#[tauri::command]
pub async fn download_models(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("download_models: starting");
    tauri::async_runtime::spawn_blocking(move || engine::download_models(&app))
        .await
        .map_err(|e| e.to_string())?
        .inspect_err(|e| log::error!("download_models failed: {e}"))
}

// ---- On-device LLM (copilot, suggestions, notes) ----

#[tauri::command]
pub fn llm_status(app: tauri::AppHandle) -> llm::LlmStatus {
    llm::status(&app)
}

/// Download the on-device LLM weights (one-time, ~1 GB). Runs on a blocking
/// thread so the UI stays responsive; progress is polled via `llm_status`.
#[tauri::command]
pub async fn download_llm(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("download_llm: starting");
    tauri::async_runtime::spawn_blocking(move || llm::download_model(&app))
        .await
        .map_err(|e| e.to_string())?
        .inspect_err(|e| log::error!("download_llm failed: {e}"))
}

#[tauri::command]
pub async fn llm_chat(app: tauri::AppHandle, messages: Vec<llm::ChatMsg>, temperature: f32, max_tokens: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Same reason as transcription: the copilot is answering a question
        // somebody is sitting and waiting for.
        run_at_user_speed();
        llm::chat(&app, &messages, temperature, max_tokens)
    })
        .await
        .map_err(|e| e.to_string())?
        .inspect_err(|e| log::error!("llm_chat failed: {e}"))
}

/// Decode a raw IPC body into 16 kHz mono samples.
///
/// Audio arrives as the bytes of a `Float32Array`, not as JSON. The JS side used
/// to send `Array.from(samples)`, which turned a ten-minute meeting into a
/// ~10-million-element array that Tauri then serialised to a couple of hundred
/// megabytes of JSON text — built in the webview and parsed in Rust, both on the
/// main thread, before a single sample had been looked at. Tauri passes an
/// ArrayBuffer view straight through as `application/octet-stream` (see
/// `process-ipc-message-fn.js` in the tauri crate), so this is now a memcpy.
fn samples_from_request(request: &tauri::ipc::Request<'_>) -> Result<Vec<f32>, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw audio bytes, not JSON.".into());
    };
    samples_from_bytes(bytes)
}

/// The decode itself, split out so it is unit-testable: a silent endianness or
/// alignment mistake here would not fail, it would transcribe noise.
pub fn samples_from_bytes(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() % 4 != 0 {
        return Err("Audio payload is not a whole number of 32-bit samples.".into());
    }
    // Every platform we ship a webview on is little-endian, which is also the
    // byte order a JS Float32Array has in memory.
    Ok(bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect())
}

/// Runs on a blocking thread, not directly in the IPC handler: whisper.cpp
/// inference for one utterance can take longer than the utterance itself on a
/// slow CPU, and the webview's IPC callback fires on the main thread (a
/// WebKit/wry constraint, not a Tauri one). A synchronous command body runs
/// there directly — every chunk transcribed during a live recording froze the
/// whole window for its duration, and, worse, backed up every other pending
/// IPC call (including the copilot model download and its progress polling)
/// behind it. `spawn_blocking` moves the CPU-bound work off that thread; the
/// `download_llm`/`llm_chat` commands below already did this.
#[tauri::command]
pub async fn transcribe_chunk(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Vec<TranscriptSegment>, String> {
    let samples = samples_from_request(&request)?;
    tauri::async_runtime::spawn_blocking(move || {
        run_at_user_speed();
        let mut segments = engine::transcribe(&app, &samples, IPC_SAMPLE_RATE)?;
        // Who said it, worked out from this one utterance against the voices
        // heard so far in this recording. Deliberately after transcription and
        // deliberately non-fatal: `live_speaker` returns None rather than
        // erroring, and unattributed lines are a fine outcome — a wrong name is
        // not. See engine::live_speaker and ai/live_speakers.rs.
        if !segments.is_empty() {
            if let Some((label, confidence)) = engine::live_speaker(&app, &samples, IPC_SAMPLE_RATE) {
                for seg in segments.iter_mut() {
                    seg.speaker_label = Some(label.clone());
                    seg.speaker_confidence = confidence;
                }
            }
        }
        Ok(segments)
    })
    .await
    .map_err(|e| e.to_string())?
    .inspect_err(|e: &String| log::error!("transcribe_chunk failed: {e}"))
}

/// Forget the voices heard in the previous recording. Called when one starts:
/// speaker indices only mean anything within a single meeting.
#[tauri::command]
pub fn reset_live_speakers() {
    engine::reset_live_speakers();
}

/// The pass on Stop: diarize the whole recording, identify enrolled voices, and
/// return the speaker turns for the caller to lay over the transcript it
/// already has.
///
/// It used to re-transcribe the entire meeting first, and that was the single
/// most expensive thing the app did. Measured on an M1 Pro from a real
/// recording (`transcribe_diarize: starting full pass (99s of audio)` in the
/// app log): 228 s to re-transcribe 99 s of audio, then 306 s to diarize it —
/// nearly nine minutes of "Finishing up" for a meeting that lasted a minute and
/// a half. The re-transcription bought very little: it is the same model over
/// the same audio the live pass already ran, differing only in where the chunk
/// boundaries fall, and the live transcript is the one the user has been
/// watching appear. Dropping it removes that 228 s outright.
///
/// Runs on a blocking thread — see `transcribe_chunk` above. It also reports
/// progress (`DIARIZE_PROGRESS_EVENT`) and logs how long the pass took, because
/// "is it working or has it hung?" was previously unanswerable from either side
/// of the window.
#[tauri::command]
pub async fn diarize_meeting(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Vec<SpeakerTurn>, String> {
    let samples = samples_from_request(&request)?;
    let seconds = samples.len() as f32 / IPC_SAMPLE_RATE as f32;
    log::info!("diarize_meeting: starting speaker pass ({seconds:.0}s of audio)");

    tauri::async_runtime::spawn_blocking(move || {
        run_at_user_speed();
        let emit = |percent: u32, phase: &'static str| {
            let _ = app.emit(DIARIZE_PROGRESS_EVENT, DiarizeProgress { percent, phase });
        };

        // Only re-emit on a whole-percent change: sherpa-onnx calls back per
        // window, which is thousands of times on a long meeting, and every event
        // is a hop to the main thread.
        let t0 = std::time::Instant::now();
        let mut last = u32::MAX;
        emit(0, "separating speakers");
        let diar = engine::diarize(&app, &samples, IPC_SAMPLE_RATE, |done, total| {
            let percent = if total > 0 { (done.max(0) as u32 * 100) / total as u32 } else { 0 };
            if percent != last {
                last = percent;
                emit(percent, "separating speakers");
            }
        })
        .inspect_err(|e| log::error!("diarize_meeting: diarize step failed: {e}"))?;
        log::info!(
            "diarize_meeting: diarized in {:?} ({} turns, {} speakers)",
            t0.elapsed(),
            diar.len(),
            diar.iter().map(|d| d.speaker).collect::<std::collections::BTreeSet<_>>().len(),
        );

        emit(100, "matching voices");
        let profiles = voices::load_profiles(&app);
        let identities = engine::identify_speakers(&app, &samples, IPC_SAMPLE_RATE, &diar, &profiles);
        Ok(label_turns(&diar, &identities))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_a_float32array_from_its_bytes() {
        // Exactly what the webview hands over: the raw memory of a
        // Float32Array, little-endian.
        let wave: Vec<f32> = vec![0.0, 1.0, -1.0, 0.5, -0.000_123, f32::MIN_POSITIVE];
        let bytes: Vec<u8> = wave.iter().flat_map(|s| s.to_le_bytes()).collect();
        assert_eq!(samples_from_bytes(&bytes).unwrap(), wave);
        assert_eq!(samples_from_bytes(&[]).unwrap(), Vec::<f32>::new());
    }

    #[test]
    fn rejects_a_truncated_sample() {
        // A short read must be an error, not three good samples and a garbage
        // one: silently transcribing noise is worse than refusing.
        assert!(samples_from_bytes(&[0, 0, 0, 0, 1]).is_err());
        assert!(samples_from_bytes(&[1, 2, 3]).is_err());
    }

    #[test]
    fn a_known_byte_pattern_decodes_to_the_expected_value() {
        // 1.0f32 is 0x3F800000; little-endian on the wire is 00 00 80 3F. Pinned
        // as a literal so a byte-order regression cannot pass by symmetry with
        // whatever `to_le_bytes` happens to do.
        assert_eq!(samples_from_bytes(&[0x00, 0x00, 0x80, 0x3F]).unwrap(), vec![1.0f32]);
        assert_eq!(samples_from_bytes(&[0x00, 0x00, 0x80, 0xBF]).unwrap(), vec![-1.0f32]);
    }

    #[test]
    fn labels_turns_with_anonymous_speakers() {
        let diar = vec![
            DiarSegment { start_ms: 0, end_ms: 1000, speaker: 0 },
            DiarSegment { start_ms: 1000, end_ms: 3000, speaker: 2 },
        ];
        let turns = label_turns(&diar, &HashMap::new());
        assert_eq!(turns.len(), 2);
        // 1-based on screen: sherpa counts speakers from zero, people do not.
        assert_eq!(turns[0].label, "Speaker 1");
        assert_eq!(turns[1].label, "Speaker 3");
        assert!(turns.iter().all(|t| t.confidence.is_none()));
    }

    #[test]
    fn labels_turns_with_an_identified_name_and_confidence() {
        let diar = vec![
            DiarSegment { start_ms: 0, end_ms: 1000, speaker: 0 },
            DiarSegment { start_ms: 1000, end_ms: 3000, speaker: 1 },
        ];
        let mut ids = HashMap::new();
        ids.insert(1, ("Max Beech".to_string(), 0.87f32));
        let turns = label_turns(&diar, &ids);
        assert_eq!(turns[0].label, "Speaker 1");
        assert_eq!(turns[0].confidence, None);
        assert_eq!(turns[1].label, "Max Beech");
        assert_eq!(turns[1].confidence, Some(0.87));
        // Timings must survive untouched — they are what the caller matches on.
        assert_eq!((turns[1].start_ms, turns[1].end_ms), (1000, 3000));
    }
}
