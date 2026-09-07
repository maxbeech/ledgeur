// On-device AI: transcription (whisper.cpp via whisper-rs), speaker diarization
// (sherpa-onnx via sherpa-rs) and model management. The heavy engine lives in
// `engine.rs` behind the `native-ai` feature; when it's not compiled, commands
// return an explicit error (never fake results).

use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

pub mod engine;
pub mod llm;
pub mod voices;

#[derive(Serialize, Clone, Debug)]
pub struct TranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub confidence: f32,
    pub speaker_label: String,
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

fn feature_compiled() -> bool {
    cfg!(feature = "native-ai")
}

/// The diarized speaker with the greatest temporal overlap for a segment.
/// Pure — unit-tested. Returns None if no diarization segment overlaps.
pub fn best_overlap_speaker(seg_start: i64, seg_end: i64, diar: &[DiarSegment]) -> Option<i32> {
    let mut best: Option<(i64, i32)> = None;
    for d in diar {
        let overlap = seg_end.min(d.end_ms) - seg_start.max(d.start_ms);
        if overlap > 0 && best.map_or(true, |(bo, _)| overlap > bo) {
            best = Some((overlap, d.speaker));
        }
    }
    best.map(|(_, s)| s)
}

/// Merge a transcript with diarization: label each segment by its dominant
/// speaker, using the enrolled identity (name + confidence) where one matched
/// and an anonymous "Speaker N" otherwise. Pure — unit-tested.
pub fn merge_speakers(
    mut transcript: Vec<TranscriptSegment>,
    diar: &[DiarSegment],
    identities: &HashMap<i32, (String, f32)>,
) -> Vec<TranscriptSegment> {
    for seg in transcript.iter_mut() {
        if let Some(spk) = best_overlap_speaker(seg.start_ms, seg.end_ms, diar) {
            if let Some((name, sim)) = identities.get(&spk) {
                seg.speaker_label = name.clone();
                seg.speaker_confidence = Some(*sim);
            } else {
                seg.speaker_label = format!("Speaker {}", spk + 1);
            }
        }
    }
    transcript
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
    tauri::async_runtime::spawn_blocking(move || llm::chat(&app, &messages, temperature, max_tokens))
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
    if bytes.len() % 4 != 0 {
        return Err("Audio payload is not a whole number of 32-bit samples.".into());
    }
    // Every platform we ship a webview on is little-endian.
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
    tauri::async_runtime::spawn_blocking(move || engine::transcribe(&app, &samples, IPC_SAMPLE_RATE))
        .await
        .map_err(|e| e.to_string())?
        .inspect_err(|e| log::error!("transcribe_chunk failed: {e}"))
}

/// Full pass, run on stop: transcribe + diarize + identify enrolled voices +
/// merge speaker labels (with identity confidence where a voice matched).
///
/// Runs on a blocking thread — see `transcribe_chunk` above. This one matters
/// even more: it re-transcribes and diarizes the *entire* meeting, so on the
/// main thread it froze the app for the whole duration of that pass with no
/// way to tell it apart from a genuine hang.
///
/// It also reports progress (`DIARIZE_PROGRESS_EVENT`) and logs how long each
/// step took. Both exist because "is it working or has it hung?" was previously
/// unanswerable from either side of the window.
#[tauri::command]
pub async fn transcribe_diarize(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Vec<TranscriptSegment>, String> {
    let samples = samples_from_request(&request)?;
    let seconds = samples.len() as f32 / IPC_SAMPLE_RATE as f32;
    log::info!("transcribe_diarize: starting full pass ({seconds:.0}s of audio)");

    tauri::async_runtime::spawn_blocking(move || {
        let emit = |percent: u32, phase: &'static str| {
            let _ = app.emit(DIARIZE_PROGRESS_EVENT, DiarizeProgress { percent, phase });
        };

        emit(0, "transcribing");
        let t0 = std::time::Instant::now();
        let transcript = engine::transcribe(&app, &samples, IPC_SAMPLE_RATE)
            .inspect_err(|e| log::error!("transcribe_diarize: transcribe step failed: {e}"))?;
        log::info!("transcribe_diarize: transcribed in {:?}", t0.elapsed());

        // Only re-emit on a whole-percent change: sherpa-onnx calls back per
        // window, which is thousands of times on a long meeting, and every event
        // is a hop to the main thread.
        let t1 = std::time::Instant::now();
        let mut last = u32::MAX;
        let diar = engine::diarize(&app, &samples, IPC_SAMPLE_RATE, |done, total| {
            let percent = if total > 0 { (done.max(0) as u32 * 100) / total as u32 } else { 0 };
            if percent != last {
                last = percent;
                emit(percent, "separating speakers");
            }
        })
        .inspect_err(|e| log::error!("transcribe_diarize: diarize step failed: {e}"))?;
        log::info!(
            "transcribe_diarize: diarized in {:?} ({} segments, {} speakers)",
            t1.elapsed(),
            diar.len(),
            diar.iter().map(|d| d.speaker).collect::<std::collections::BTreeSet<_>>().len(),
        );

        emit(100, "matching voices");
        let profiles = voices::load_profiles(&app);
        let identities = engine::identify_speakers(&app, &samples, IPC_SAMPLE_RATE, &diar, &profiles);
        Ok(merge_speakers(transcript, &diar, &identities))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn seg(start_ms: i64, end_ms: i64) -> TranscriptSegment {
        TranscriptSegment { start_ms, end_ms, text: "x".into(), confidence: 0.9, speaker_label: "Speaker 1".into(), speaker_confidence: None }
    }
    #[test]
    fn picks_greatest_overlap() {
        let diar = vec![
            DiarSegment { start_ms: 0, end_ms: 1000, speaker: 0 },
            DiarSegment { start_ms: 1000, end_ms: 3000, speaker: 1 },
        ];
        assert_eq!(best_overlap_speaker(1200, 2800, &diar), Some(1));
        assert_eq!(best_overlap_speaker(0, 400, &diar), Some(0));
        assert_eq!(best_overlap_speaker(5000, 6000, &diar), None);
    }
    #[test]
    fn merge_labels_by_speaker() {
        let diar = vec![DiarSegment { start_ms: 0, end_ms: 5000, speaker: 2 }];
        let out = merge_speakers(vec![seg(100, 900)], &diar, &HashMap::new());
        assert_eq!(out[0].speaker_label, "Speaker 3");
        assert_eq!(out[0].speaker_confidence, None);
    }
    #[test]
    fn merge_uses_identified_name_and_confidence() {
        let diar = vec![
            DiarSegment { start_ms: 0, end_ms: 1000, speaker: 0 },
            DiarSegment { start_ms: 1000, end_ms: 3000, speaker: 1 },
        ];
        let mut ids = HashMap::new();
        ids.insert(1, ("Max Beech".to_string(), 0.87f32));
        let out = merge_speakers(vec![seg(100, 900), seg(1200, 2800)], &diar, &ids);
        assert_eq!(out[0].speaker_label, "Speaker 1");
        assert_eq!(out[1].speaker_label, "Max Beech");
        assert_eq!(out[1].speaker_confidence, Some(0.87));
    }
}
