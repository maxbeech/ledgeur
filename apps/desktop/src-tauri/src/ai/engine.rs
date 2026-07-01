// The on-device AI engine. Real implementations require the `native-ai` feature
// (whisper.cpp + sherpa-onnx). Without it, every entry point returns an explicit
// error so the UI shows a truthful "native engine not available" state.

use super::{DiarSegment, TranscriptSegment};

#[cfg(not(feature = "native-ai"))]
mod inner {
    use super::*;
    const MSG: &str =
        "On-device AI is not compiled into this build. Rebuild with `--features native-ai` (see docs/NATIVE_AI.md).";
    pub fn transcribe(_a: &tauri::AppHandle, _s: &[f32], _r: u32) -> Result<Vec<TranscriptSegment>, String> { Err(MSG.into()) }
    pub fn diarize(_a: &tauri::AppHandle, _s: &[f32], _r: u32) -> Result<Vec<DiarSegment>, String> { Err(MSG.into()) }
    pub fn download_models(_a: &tauri::AppHandle) -> Result<(), String> { Err(MSG.into()) }
}

#[cfg(feature = "native-ai")]
mod inner {
    use super::*;
    use crate::ai::{models_dir, EMBED_MODEL, SEG_MODEL, WHISPER_MODEL};
    use std::fs;
    use std::io::Write;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
    use sherpa_rs::diarize::{Diarize, DiarizeConfig};

    /// Linear resample to 16 kHz mono (whisper/sherpa require 16 kHz).
    fn resample_16k(samples: &[f32], rate: u32) -> Vec<f32> {
        if rate == 16000 || samples.is_empty() {
            return samples.to_vec();
        }
        let ratio = rate as f32 / 16000.0;
        let out_len = ((samples.len() as f32) / ratio).floor().max(1.0) as usize;
        let mut out = vec![0f32; out_len];
        for i in 0..out_len {
            let pos = i as f32 * ratio;
            let i0 = pos.floor() as usize;
            let i1 = (i0 + 1).min(samples.len() - 1);
            let frac = pos - i0 as f32;
            out[i] = samples[i0] * (1.0 - frac) + samples[i1] * frac;
        }
        out
    }

    pub fn transcribe(app: &tauri::AppHandle, samples: &[f32], rate: u32) -> Result<Vec<TranscriptSegment>, String> {
        let audio = resample_16k(samples, rate);
        let model = models_dir(app).join(WHISPER_MODEL);
        if !model.exists() {
            return Err(format!("Whisper model missing at {}. Run download first.", model.display()));
        }
        let ctx = WhisperContext::new_with_params(model.to_string_lossy().as_ref(), WhisperContextParameters::default())
            .map_err(|e| e.to_string())?;
        let mut state = ctx.create_state().map_err(|e| e.to_string())?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        state.full(params, &audio).map_err(|e| e.to_string())?;

        let n = state.full_n_segments(); // c_int in whisper-rs 0.16
        let mut out = Vec::new();
        for i in 0..n {
            let Some(seg) = state.get_segment(i) else { continue };
            let text = seg.to_str().unwrap_or("").trim().to_string();
            if text.is_empty() {
                continue;
            }
            let t0 = seg.start_timestamp(); // centiseconds
            let t1 = seg.end_timestamp();
            // Confidence = mean token probability for the segment.
            let nt = seg.n_tokens();
            let (mut sum, mut cnt) = (0f32, 0f32);
            for j in 0..nt {
                if let Some(tok) = seg.get_token(j) {
                    sum += tok.token_probability();
                    cnt += 1.0;
                }
            }
            out.push(TranscriptSegment {
                start_ms: t0 * 10,
                end_ms: t1 * 10,
                text,
                confidence: if cnt > 0.0 { sum / cnt } else { 0.0 },
                speaker_label: "Speaker 1".into(),
                speaker_confidence: None,
            });
        }
        Ok(out)
    }

    pub fn diarize(app: &tauri::AppHandle, samples: &[f32], rate: u32) -> Result<Vec<DiarSegment>, String> {
        let audio = resample_16k(samples, rate);
        let seg = models_dir(app).join(SEG_MODEL);
        let emb = models_dir(app).join(EMBED_MODEL);
        if !seg.exists() || !emb.exists() {
            return Err("Diarization models missing. Run download first.".into());
        }
        let mut sd = Diarize::new(seg.to_string_lossy().as_ref(), emb.to_string_lossy().as_ref(), DiarizeConfig::default())
            .map_err(|e| e.to_string())?;
        let segments = sd.compute(audio, None).map_err(|e| e.to_string())?;
        Ok(segments
            .into_iter()
            .map(|s| DiarSegment { start_ms: (s.start * 1000.0) as i64, end_ms: (s.end * 1000.0) as i64, speaker: s.speaker as i32 })
            .collect())
    }

    // Direct single-file model downloads (documented in docs/NATIVE_AI.md).
    const DOWNLOADS: &[(&str, &str)] = &[
        (WHISPER_MODEL, "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"),
        (SEG_MODEL, "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx"),
        (EMBED_MODEL, "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"),
    ];

    pub fn download_models(app: &tauri::AppHandle) -> Result<(), String> {
        let dir = models_dir(app);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(3600))
            .build()
            .map_err(|e| e.to_string())?;
        for (name, url) in DOWNLOADS {
            let path = dir.join(name);
            if path.exists() {
                continue;
            }
            let resp = client.get(*url).send().map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!("Download failed for {} ({}).", name, resp.status()));
            }
            let bytes = resp.bytes().map_err(|e| e.to_string())?;
            let tmp = dir.join(format!("{}.part", name));
            let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
            f.write_all(&bytes).map_err(|e| e.to_string())?;
            fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

pub use inner::{diarize, download_models, transcribe};
