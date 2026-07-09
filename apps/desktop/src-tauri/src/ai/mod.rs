// On-device AI: transcription (whisper.cpp via whisper-rs), speaker diarization
// (sherpa-onnx via sherpa-rs) and model management. The heavy engine lives in
// `engine.rs` behind the `native-ai` feature; when it's not compiled, commands
// return an explicit error (never fake results).

use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;

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
pub const EMBED_MODEL: &str = "speaker-embedding.onnx";

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

#[tauri::command]
pub fn download_models(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("download_models: starting");
    engine::download_models(&app).inspect_err(|e| log::error!("download_models failed: {e}"))
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

#[tauri::command]
pub fn transcribe_chunk(app: tauri::AppHandle, samples: Vec<f32>, sample_rate: u32) -> Result<Vec<TranscriptSegment>, String> {
    engine::transcribe(&app, &samples, sample_rate).inspect_err(|e| log::error!("transcribe_chunk failed: {e}"))
}

/// Full pass, run on stop: transcribe + diarize + identify enrolled voices +
/// merge speaker labels (with identity confidence where a voice matched).
#[tauri::command]
pub fn transcribe_diarize(app: tauri::AppHandle, samples: Vec<f32>, sample_rate: u32) -> Result<Vec<TranscriptSegment>, String> {
    log::info!("transcribe_diarize: starting full pass ({} samples)", samples.len());
    let transcript = engine::transcribe(&app, &samples, sample_rate).inspect_err(|e| log::error!("transcribe_diarize: transcribe step failed: {e}"))?;
    let diar = engine::diarize(&app, &samples, sample_rate).inspect_err(|e| log::error!("transcribe_diarize: diarize step failed: {e}"))?;
    let profiles = voices::load_profiles(&app);
    let identities = engine::identify_speakers(&app, &samples, sample_rate, &diar, &profiles);
    Ok(merge_speakers(transcript, &diar, &identities))
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
