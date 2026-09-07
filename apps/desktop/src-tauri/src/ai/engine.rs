// The on-device AI engine. Real implementations require the `native-ai` feature
// (whisper.cpp + sherpa-onnx). Without it, every entry point returns an explicit
// error so the UI shows a truthful "native engine not available" state.

use super::{DiarSegment, TranscriptSegment};

#[cfg(not(feature = "native-ai"))]
mod inner {
    use super::*;
    use crate::ai::voices::VoiceProfile;
    use std::collections::HashMap;
    const MSG: &str =
        "On-device AI is not compiled into this build. Rebuild with `--features native-ai` (see docs/NATIVE_AI.md).";
    pub fn transcribe(_a: &tauri::AppHandle, _s: &[f32], _r: u32) -> Result<Vec<TranscriptSegment>, String> { Err(MSG.into()) }
    pub fn diarize(
        _a: &tauri::AppHandle, _s: &[f32], _r: u32, _p: impl FnMut(i32, i32),
    ) -> Result<Vec<DiarSegment>, String> { Err(MSG.into()) }
    pub fn download_models(_a: &tauri::AppHandle) -> Result<(), String> { Err(MSG.into()) }
    pub fn embed_voice(_a: &tauri::AppHandle, _s: &[f32], _r: u32) -> Result<Vec<f32>, String> { Err(MSG.into()) }
    pub fn identify_speakers(
        _a: &tauri::AppHandle, _s: &[f32], _r: u32, _d: &[DiarSegment], _p: &[VoiceProfile],
    ) -> HashMap<i32, (String, f32)> { HashMap::new() }
}

#[cfg(feature = "native-ai")]
mod inner {
    use super::*;
    use crate::ai::voices::{best_match, VoiceProfile};
    use crate::ai::{models_dir, EMBED_MODEL, SEG_MODEL, WHISPER_MODEL};
    use std::collections::HashMap;
    use std::ffi::{c_void, CString};
    use std::fs;
    use std::io::Write;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
    use sherpa_rs::sherpa_rs_sys;
    use sherpa_rs::speaker_id::{EmbeddingExtractor, ExtractorConfig};

    /// Threads to give the ONNX/whisper inference sessions.
    ///
    /// This is not a micro-optimisation. `sherpa_rs::diarize::Diarize` hardcodes
    /// `num_threads: 1` for both the segmentation and the embedding model and
    /// offers no way to change it, which is why writing up a ten-minute meeting
    /// took the better part of an hour: sampling a stuck build showed 99% of the
    /// time inside `SpeakerEmbeddingExtractorGeneralImpl::Compute`, on one core.
    /// Building the sherpa config against the C API directly (see `diarize`) is
    /// done purely so this number is ours to set.
    ///
    /// Capped at 8 rather than taken as-is: past the performance-core count the
    /// extra threads contend more than they help, and the headroom keeps audio
    /// capture and the UI responsive while a meeting is still being written up.
    fn inference_threads() -> i32 {
        std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8) as i32
    }

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
        // whisper.cpp's own default is min(4, cores) regardless of the machine.
        params.set_n_threads(inference_threads());
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

    /// Cosine-distance ceiling below which two speaker clusters are merged.
    /// sherpa-onnx's fast clustering runs on `1 - cosine_similarity` (see
    /// `fast-clustering.cc` in the vendored source), so a LOWER number splits
    /// speakers apart more readily and a higher one merges them.
    ///
    /// 0.5 is sherpa-onnx's own default, tuned against the embedding models it
    /// publishes — including the CAM++ one we download. The previous value
    /// (0.70) was carried over from `MERGE_SIMILARITY` in
    /// `packages/core/src/diarize/cluster.ts`, which was measured against the
    /// webview path's entirely different embedding model; at that distance two
    /// different people comfortably landed in one cluster, which is exactly the
    /// "thinks people are the same who aren't" symptom. If real recordings still
    /// split wrongly, sweep this the way `packages/asr/verify/diarize.mjs` did
    /// and record the measured value here.
    const DIARIZE_DISTANCE_THRESHOLD: f32 = 0.5;

    /// Owns the C-side diarizer so it is destroyed on every path, error included.
    struct Diarizer(*const sherpa_rs_sys::SherpaOnnxOfflineSpeakerDiarization);

    impl Drop for Diarizer {
        fn drop(&mut self) {
            unsafe { sherpa_rs_sys::SherpaOnnxDestroyOfflineSpeakerDiarization(self.0) }
        }
    }

    /// Trampoline for sherpa-onnx's progress callback; `arg` is the boxed closure.
    unsafe extern "C" fn on_progress(processed: i32, total: i32, arg: *mut c_void) -> i32 {
        if !arg.is_null() {
            (*(arg as *mut Box<dyn FnMut(i32, i32)>))(processed, total);
        }
        0 // non-zero would ask sherpa-onnx to stop; we always want the full pass
    }

    /// Split the audio into speaker turns. `progress` is called with
    /// (chunks done, chunks total) as the pass runs — a ten-minute meeting is
    /// minutes of work, and without it the app is indistinguishable from hung.
    pub fn diarize(
        app: &tauri::AppHandle,
        samples: &[f32],
        rate: u32,
        mut progress: impl FnMut(i32, i32),
    ) -> Result<Vec<DiarSegment>, String> {
        let audio = resample_16k(samples, rate);
        if audio.is_empty() {
            return Ok(Vec::new());
        }
        let seg = models_dir(app).join(SEG_MODEL);
        let emb = models_dir(app).join(EMBED_MODEL);
        if !seg.exists() || !emb.exists() {
            return Err("Diarization models missing. Run download first.".into());
        }
        // These must outlive the config: it borrows the pointers, not the data.
        let seg_c = CString::new(seg.to_string_lossy().as_ref()).map_err(|e| e.to_string())?;
        let emb_c = CString::new(emb.to_string_lossy().as_ref()).map_err(|e| e.to_string())?;
        let provider = CString::new("cpu").map_err(|e| e.to_string())?;
        let threads = inference_threads();

        let config = sherpa_rs_sys::SherpaOnnxOfflineSpeakerDiarizationConfig {
            segmentation: sherpa_rs_sys::SherpaOnnxOfflineSpeakerSegmentationModelConfig {
                pyannote: sherpa_rs_sys::SherpaOnnxOfflineSpeakerSegmentationPyannoteModelConfig {
                    model: seg_c.as_ptr(),
                },
                num_threads: threads,
                debug: 0,
                provider: provider.as_ptr(),
            },
            embedding: sherpa_rs_sys::SherpaOnnxSpeakerEmbeddingExtractorConfig {
                model: emb_c.as_ptr(),
                num_threads: threads,
                debug: 0,
                provider: provider.as_ptr(),
            },
            // A negative cluster count means "as many as the threshold implies".
            // `sherpa_rs`'s own DiarizeConfig::default() puts 4 here, and a fixed
            // count takes priority over the threshold in the clustering call, so
            // every meeting — one speaker or ten — came out as exactly four.
            clustering: sherpa_rs_sys::SherpaOnnxFastClusteringConfig {
                num_clusters: -1,
                threshold: DIARIZE_DISTANCE_THRESHOLD,
            },
            min_duration_on: 0.0,
            min_duration_off: 0.0,
        };

        let sd = unsafe { sherpa_rs_sys::SherpaOnnxCreateOfflineSpeakerDiarization(&config) };
        if sd.is_null() {
            return Err("Could not start speaker diarization (check the downloaded models).".into());
        }
        let sd = Diarizer(sd);

        // Boxed as a trait object so the C side has one stable pointer to call
        // through. The elided lifetime is inferred here (not `'static`), so the
        // caller's closure is free to borrow — which it does, to emit events.
        let mut cb: Box<dyn FnMut(i32, i32)> = Box::new(progress);
        unsafe {
            let result = sherpa_rs_sys::SherpaOnnxOfflineSpeakerDiarizationProcessWithCallback(
                sd.0,
                audio.as_ptr(),
                audio.len() as i32,
                Some(on_progress),
                &mut cb as *mut Box<dyn FnMut(i32, i32)> as *mut c_void,
            );
            if result.is_null() {
                return Err("Speaker diarization produced no result.".into());
            }
            let n = sherpa_rs_sys::SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments(result);
            let ptr = sherpa_rs_sys::SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime(result);
            let mut out = Vec::new();
            // No segments is a legitimate outcome (silence, or one very short
            // utterance) — the caller labels everything "Speaker 1" and moves on.
            if !ptr.is_null() && n > 0 {
                for s in std::slice::from_raw_parts(ptr, n as usize) {
                    out.push(DiarSegment {
                        start_ms: (s.start * 1000.0) as i64,
                        end_ms: (s.end * 1000.0) as i64,
                        speaker: s.speaker,
                    });
                }
                sherpa_rs_sys::SherpaOnnxOfflineSpeakerDiarizationDestroySegment(ptr);
            }
            sherpa_rs_sys::SherpaOnnxOfflineSpeakerDiarizationDestroyResult(result);
            Ok(out)
        }
    }

    /// Speaker embedding for a stretch of speech (voice enrolment + identification).
    pub fn embed_voice(app: &tauri::AppHandle, samples: &[f32], rate: u32) -> Result<Vec<f32>, String> {
        let audio = resample_16k(samples, rate);
        let model = models_dir(app).join(EMBED_MODEL);
        if !model.exists() {
            return Err("Speaker-embedding model missing. Run download first.".into());
        }
        let mut extractor = EmbeddingExtractor::new(ExtractorConfig {
            model: model.to_string_lossy().to_string(),
            // ExtractorConfig::default() is 1 thread, same trap as diarization.
            num_threads: Some(inference_threads() as usize),
            ..Default::default()
        })
        .map_err(|e| e.to_string())?;
        extractor.compute_speaker_embedding(audio, 16000).map_err(|e| e.to_string())
    }

    /// Match each diarized speaker against enrolled voice profiles. Collects up
    /// to ~12 s of that speaker's audio, embeds it, and keeps matches at/above
    /// the cosine threshold. Failures degrade to anonymous "Speaker N" labels.
    pub fn identify_speakers(
        app: &tauri::AppHandle,
        samples: &[f32],
        rate: u32,
        diar: &[DiarSegment],
        profiles: &[VoiceProfile],
    ) -> HashMap<i32, (String, f32)> {
        let mut out = HashMap::new();
        if profiles.is_empty() || diar.is_empty() {
            return out;
        }
        let audio = resample_16k(samples, rate);
        let max_samples = 12 * 16000usize;
        let min_samples = 16000usize; // need ≥1 s of speech to identify
        let mut speakers: Vec<i32> = diar.iter().map(|d| d.speaker).collect();
        speakers.sort_unstable();
        speakers.dedup();
        for spk in speakers {
            let mut clip: Vec<f32> = Vec::new();
            for d in diar.iter().filter(|d| d.speaker == spk) {
                let a = ((d.start_ms.max(0) as usize) * 16).min(audio.len());
                let b = ((d.end_ms.max(0) as usize) * 16).min(audio.len());
                if b > a {
                    clip.extend_from_slice(&audio[a..b]);
                }
                if clip.len() >= max_samples {
                    clip.truncate(max_samples);
                    break;
                }
            }
            if clip.len() < min_samples {
                continue;
            }
            match embed_voice(app, &clip, 16000) {
                Ok(embedding) => {
                    if let Some((profile, sim)) = best_match(&embedding, profiles) {
                        out.insert(spk, (profile.name.clone(), sim));
                    }
                }
                Err(e) => eprintln!("voice identification failed for speaker {spk}: {e}"),
            }
        }
        out
    }

    // Direct single-file model downloads (documented in docs/NATIVE_AI.md).
    //
    // The speaker-embedding model is WeSpeaker's CAM++ trained on VoxCeleb. The
    // previous one — `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k` —
    // was trained on Mandarin (`zh-cn`) and was being asked to tell English
    // speakers apart, which it does poorly: voices that are obviously different
    // to a listener land close together in its embedding space, so the clusterer
    // merges them. CAM++ is also several times cheaper to run, which matters
    // because this model is evaluated once per diarization window.
    const DOWNLOADS: &[(&str, &str)] = &[
        (WHISPER_MODEL, "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"),
        (SEG_MODEL, "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx"),
        (EMBED_MODEL, "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/wespeaker_en_voxceleb_CAM%2B%2B.onnx"),
    ];

    /// Model files earlier versions downloaded and no longer use. Removed on the
    /// next download so a machine that has been through an upgrade isn't left
    /// carrying dead weights forever.
    const SUPERSEDED: &[&str] = &["speaker-embedding.onnx"];

    pub fn download_models(app: &tauri::AppHandle) -> Result<(), String> {
        let dir = models_dir(app);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        for stale in SUPERSEDED {
            let path = dir.join(stale);
            if path.exists() {
                match fs::remove_file(&path) {
                    Ok(()) => log::info!("removed superseded model {stale}"),
                    // Not fatal: it only costs disk space.
                    Err(e) => log::warn!("could not remove superseded model {stale}: {e}"),
                }
            }
        }
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

pub use inner::{diarize, download_models, embed_voice, identify_speakers, transcribe};
