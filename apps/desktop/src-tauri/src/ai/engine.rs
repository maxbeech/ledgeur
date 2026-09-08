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
    pub fn reset_live_speakers() {}
    pub fn live_speaker(
        _a: &tauri::AppHandle, _s: &[f32], _r: u32,
    ) -> Option<(String, Option<f32>)> { None }
}

#[cfg(feature = "native-ai")]
mod inner {
    use super::*;
    use crate::ai::live_speakers::{speaker_label, LiveSpeakers};
    use crate::ai::voices::{best_match, VoiceProfile};
    use crate::ai::{models_dir, EMBED_MODEL, SEG_MODEL, WHISPER_MODEL};
    use std::collections::HashMap;
    use std::ffi::{c_void, CString};
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};
    use whisper_rs::{
        FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
    };
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
    pub(super) fn inference_threads() -> i32 {
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

    /// The loaded speech model and its decoding state, kept for the life of the
    /// process.
    ///
    /// This used to be built per call: `WhisperContext::new_with_params`
    /// followed by `create_state`, on every single utterance of a live
    /// recording. That is reading and preparing the 148 MB `ggml-base.en.bin`
    /// once per chunk — work that dwarfed the inference it was setting up for,
    /// and it is the bulk of why the live transcript fell minutes behind a
    /// meeting and never caught up. The model does not change while the app is
    /// running, so it is loaded once and reused.
    ///
    /// A `WhisperState` owns an `Arc` of the context rather than borrowing it,
    /// so keeping the state alone keeps the weights alive. The `Mutex` is not
    /// incidental: one decode at a time is exactly the discipline the rest of
    /// the recorder already keeps (see `pumpTranscription` in useRecorder.ts),
    /// and two concurrent passes would not go faster, they would split the same
    /// cores and make both late.
    struct Speech {
        path: PathBuf,
        state: WhisperState,
    }
    static SPEECH: OnceLock<Mutex<Option<Speech>>> = OnceLock::new();

    pub fn transcribe(app: &tauri::AppHandle, samples: &[f32], rate: u32) -> Result<Vec<TranscriptSegment>, String> {
        let model = models_dir(app).join(WHISPER_MODEL);
        if !model.exists() {
            return Err(format!("Whisper model missing at {}. Run download first.", model.display()));
        }
        transcribe_at(&model, samples, rate)
    }

    /// The transcription itself, against an explicit model path — split out so
    /// it can be measured and tested without an AppHandle, the same way
    /// `run_diarization` and `llm::chat_at` are.
    pub(super) fn transcribe_at(
        model: &Path, samples: &[f32], rate: u32,
    ) -> Result<Vec<TranscriptSegment>, String> {
        let audio = resample_16k(samples, rate);
        if audio.is_empty() {
            return Ok(Vec::new());
        }
        let cell = SPEECH.get_or_init(|| Mutex::new(None));
        let mut guard = cell.lock().map_err(|_| "speech engine lock poisoned".to_string())?;
        if guard.as_ref().map_or(true, |s| s.path != model) {
            let ctx = WhisperContext::new_with_params(
                model.to_string_lossy().as_ref(),
                // `use_gpu` defaults to whether a GPU backend was compiled in,
                // so this picks up Metal on Apple silicon and stays CPU-only
                // everywhere else without a branch here.
                WhisperContextParameters::default(),
            )
            .map_err(|e| e.to_string())?;
            let state = ctx.create_state().map_err(|e| e.to_string())?;
            *guard = Some(Speech { path: model.to_path_buf(), state });
        }
        let state = &mut guard.as_mut().expect("just loaded above").state;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        // whisper.cpp's own default is min(4, cores) regardless of the machine.
        params.set_n_threads(inference_threads());
        params.set_language(Some("en"));
        // The state is reused now, and whisper.cpp otherwise seeds each pass
        // with the previous one's tokens. Across a live recording that is not
        // continuity, it is one utterance's words being offered as context for
        // the next unrelated one — the classic way whisper starts repeating a
        // phrase forever. Each chunk is decoded on its own, exactly as it was
        // when every call got a fresh state.
        params.set_no_context(true);
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
                // Filled in by the caller when a voice can be placed — see
                // `live_speaker` below and `merge_speakers` in mod.rs. It is not
                // this function's job to guess, and it used to guess "Speaker 1"
                // for every line of every meeting.
                speaker_label: None,
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
    /// MEASURED, not chosen. `sweeps_the_clustering_threshold` over
    /// `ted_60.wav` (a 60 s interview: one long-form speaker, one asking short
    /// questions) with the CAM++ model this build downloads:
    ///
    /// ```text
    ///   threshold   0.05  0.10  0.15  0.20  0.25  0.30  0.35  0.40 … 0.70
    ///   speakers       7     4     3     2     2     2     2     1 …    1
    /// ```
    ///
    /// Two speakers hold from 0.20 to 0.35; 0.28 sits in the middle of that
    /// plateau, roughly equidistant from over-splitting and from the cliff at
    /// 0.40 where both voices collapse into one person.
    ///
    /// Every previously plausible-looking value is on the wrong side of that
    /// cliff. sherpa-onnx's own default is 0.5. The value before it, 0.70, came
    /// from `MERGE_SIMILARITY` in `packages/core/src/diarize/cluster.ts`, which
    /// was measured — but against the webview path's completely different
    /// embedding model, whose space has different geometry. Both give ONE
    /// speaker here, which is exactly the "thinks people are the same who
    /// aren't" report. Re-measure with the sweep whenever the embedding model
    /// changes; do not carry a number across models.
    pub(super) const DIARIZE_DISTANCE_THRESHOLD: f32 = 0.28;

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
        progress: impl FnMut(i32, i32),
    ) -> Result<Vec<DiarSegment>, String> {
        let seg = models_dir(app).join(SEG_MODEL);
        let emb = models_dir(app).join(EMBED_MODEL);
        if !seg.exists() || !emb.exists() {
            return Err("Diarization models missing. Run download first.".into());
        }
        run_diarization(&seg, &emb, samples, rate, DIARIZE_DISTANCE_THRESHOLD, progress)
    }

    /// The pass itself, against explicit model paths.
    ///
    /// Split from `diarize` only so it can be exercised without an AppHandle:
    /// this is hand-written FFI against a C struct, and "it compiles" says
    /// nothing about whether the layout is right. See `diarizes_two_speakers`.
    pub(super) fn run_diarization(
        seg: &std::path::Path,
        emb: &std::path::Path,
        samples: &[f32],
        rate: u32,
        threshold: f32,
        progress: impl FnMut(i32, i32),
    ) -> Result<Vec<DiarSegment>, String> {
        let audio = resample_16k(samples, rate);
        if audio.is_empty() {
            return Ok(Vec::new());
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
                threshold,
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

    /// The loaded speaker-embedding model, kept like the speech model above.
    ///
    /// `EmbeddingExtractor` is a raw sherpa-onnx pointer and so is not `Send` on
    /// its own; the `Mutex` is what makes "one caller at a time" true rather
    /// than merely assumed, and the wrapper is where that claim is written down.
    struct Embedder(EmbeddingExtractor);
    // SAFETY: the extractor is only ever reached through the Mutex below, so it
    // is used from one thread at a time, which is sherpa-onnx's requirement.
    unsafe impl Send for Embedder {}
    struct Embed {
        path: PathBuf,
        embedder: Embedder,
    }
    static EMBED: OnceLock<Mutex<Option<Embed>>> = OnceLock::new();

    /// Speaker embedding for a stretch of speech (voice enrolment + identification).
    pub fn embed_voice(app: &tauri::AppHandle, samples: &[f32], rate: u32) -> Result<Vec<f32>, String> {
        let model = models_dir(app).join(EMBED_MODEL);
        if !model.exists() {
            return Err("Speaker-embedding model missing. Run download first.".into());
        }
        embed_at(&model, samples, rate)
    }

    /// The embedding itself, against an explicit model path.
    ///
    /// Loading the 29 MB CAM++ weights was previously part of every call. That
    /// was tolerable when this ran once per speaker at the end of a meeting; it
    /// is not now that it runs once per utterance to keep live speaker labels
    /// (see `live_speakers.rs`).
    pub(super) fn embed_at(model: &Path, samples: &[f32], rate: u32) -> Result<Vec<f32>, String> {
        let audio = resample_16k(samples, rate);
        if audio.is_empty() {
            return Err("No audio to embed.".into());
        }
        let cell = EMBED.get_or_init(|| Mutex::new(None));
        let mut guard = cell.lock().map_err(|_| "speaker engine lock poisoned".to_string())?;
        if guard.as_ref().map_or(true, |e| e.path != model) {
            let extractor = EmbeddingExtractor::new(ExtractorConfig {
                model: model.to_string_lossy().to_string(),
                // ExtractorConfig::default() is 1 thread, same trap as diarization.
                num_threads: Some(inference_threads() as usize),
                ..Default::default()
            })
            .map_err(|e| e.to_string())?;
            *guard = Some(Embed { path: model.to_path_buf(), embedder: Embedder(extractor) });
        }
        let embedder = &mut guard.as_mut().expect("just loaded above").embedder;
        embedder.0.compute_speaker_embedding(audio, 16000).map_err(|e| e.to_string())
    }

    /// Cosine-distance ceiling for attributing one live utterance to a speaker
    /// already heard in this meeting.
    ///
    /// MEASURED, and emphatically not carried over from
    /// `DIARIZE_DISTANCE_THRESHOLD` — the two answer different questions over
    /// different inputs and do not transfer. `measures_speaker_separability`
    /// pools each speaker's audio from `ted_60.wav`, cuts it into windows and
    /// reports how far apart CAM++ puts two clips of the same person versus two
    /// clips of different people:
    ///
    /// ```text
    ///   window      same person    different people
    ///      1 s          0.334            0.368        indistinguishable
    ///      2 s          0.223            0.292
    ///      3 s          0.158            0.248
    ///      5 s          0.075            0.197
    /// ```
    ///
    /// 0.20 sits in the gap at 3 s and comfortably inside it at 5 s. The first
    /// attempt at this constant was a guessed 0.45, which the sweep showed
    /// collapses every voice in the clip into one speaker — the exact bug this
    /// code is here to fix, reintroduced by picking a plausible-looking number.
    /// Re-run `assignment_threshold_sweep` when the embedding model changes.
    pub(super) const LIVE_SPEAKER_DISTANCE: f32 = 0.20;

    /// Shortest utterance worth attributing to anybody.
    ///
    /// Also measured, and the more important half of the pair: the table above
    /// shows a one-second clip carries essentially no speaker identity at all
    /// (0.334 vs 0.368 — noise), so any threshold applied to one is a coin
    /// flip wearing a number. Three seconds is where the two distributions come
    /// apart. Below it `live_speaker` returns None and the line stays
    /// unattributed, which is the honest answer: an unlabelled line costs the
    /// reader nothing, and a confidently wrong name costs them the transcript.
    const MIN_EMBED_SECONDS: f32 = 3.0;

    static LIVE: OnceLock<Mutex<LiveSpeakers>> = OnceLock::new();

    fn live() -> &'static Mutex<LiveSpeakers> {
        LIVE.get_or_init(|| Mutex::new(LiveSpeakers::new()))
    }

    /// Forget the voices from the previous take. Called when a recording starts:
    /// speaker indices are only meaningful within one meeting, and carrying them
    /// over would open a new meeting already believing it knows four people.
    pub fn reset_live_speakers() {
        if let Ok(mut guard) = live().lock() {
            *guard = LiveSpeakers::new();
        }
    }

    /// Who is speaking in this utterance, for the live transcript.
    ///
    /// Returns the label and, when the voice matched somebody enrolled, that
    /// match's confidence. `None` means we genuinely do not know — too little
    /// speech, or the model is unavailable — and the caller leaves the line
    /// unattributed rather than claiming a speaker. Never fatal: a live
    /// transcript with no names on it is still a live transcript, and the pass
    /// on Stop re-labels everything from a global view anyway.
    pub fn live_speaker(
        app: &tauri::AppHandle, samples: &[f32], rate: u32,
    ) -> Option<(String, Option<f32>)> {
        if (samples.len() as f32 / rate as f32) < MIN_EMBED_SECONDS {
            return None;
        }
        let model = models_dir(app).join(EMBED_MODEL);
        if !model.exists() {
            return None;
        }
        let embedding = embed_at(&model, samples, rate)
            .map_err(|e| log::warn!("live speaker embedding failed: {e}"))
            .ok()?;
        // An enrolled voice outranks an anonymous index: if this device knows
        // who this is, saying so live is the whole point of having enrolled them.
        if let Some((profile, sim)) = best_match(&embedding, &crate::ai::voices::load_profiles(app)) {
            // Still fold it into the running centroids, so the same voice keeps
            // one identity whether or not the profile matches on a given
            // utterance.
            let _ = live().lock().ok()?.assign(&embedding, LIVE_SPEAKER_DISTANCE);
            return Some((profile.name.clone(), Some(sim)));
        }
        let index = live().lock().ok()?.assign(&embedding, LIVE_SPEAKER_DISTANCE)?;
        Some((speaker_label(index), None))
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

pub use inner::{
    diarize, download_models, embed_voice, identify_speakers, live_speaker,
    reset_live_speakers, transcribe,
};

/// Runs the real sherpa-onnx pipeline against the downloaded models.
///
/// Ignored by default: it needs the models on disk and a speech clip, neither of
/// which belongs in the repo. It exists because everything in `diarize` below
/// the Rust layer is hand-written FFI against a C struct — a wrong field order
/// there compiles perfectly and then either segfaults or silently diarizes
/// garbage, and no amount of unit testing around it would notice.
///
///   curl -sL https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/ted_60.wav -o /tmp/ted.wav
///   LEDGEUR_TEST_WAV=/tmp/ted.wav cargo test --features native-ai -- --ignored --nocapture
#[cfg(all(test, feature = "native-ai"))]
mod integration {
    use super::*;
    use crate::ai::{EMBED_MODEL, SEG_MODEL};


    fn models_dir_for_test() -> std::path::PathBuf {
        std::env::var("LEDGEUR_MODELS_DIR").map(std::path::PathBuf::from).unwrap_or_else(|_| {
            let home = std::env::var("HOME").expect("HOME");
            std::path::PathBuf::from(home).join("Library/Application Support/com.maxbeech.ledgeur/models")
        })
    }

    /// Minimal 16-bit PCM WAV reader — enough for the verification clip.
    fn read_wav(path: &str) -> (Vec<f32>, u32) {
        let bytes = std::fs::read(path).expect("read wav");
        let u16at = |o: usize| u16::from_le_bytes([bytes[o], bytes[o + 1]]);
        let u32at = |o: usize| u32::from_le_bytes([bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]]);
        let (mut channels, mut rate, mut at) = (1u16, 16000u32, 12usize);
        while at + 8 <= bytes.len() {
            let id = &bytes[at..at + 4];
            let len = u32at(at + 4) as usize;
            let body = at + 8;
            if id == b"fmt " {
                channels = u16at(body + 2);
                rate = u32at(body + 4);
            } else if id == b"data" {
                let end = (body + len).min(bytes.len());
                // Interleaved i16 to mono f32.
                let frames: Vec<f32> = bytes[body..end]
                    .chunks_exact(2)
                    .map(|s| i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0)
                    .collect();
                let mono = frames
                    .chunks(channels as usize)
                    .map(|f| f.iter().sum::<f32>() / channels as f32)
                    .collect();
                return (mono, rate);
            }
            at = body + len + (len & 1);
        }
        panic!("no data chunk in {path}");
    }


    /// How fast the speech model actually is on this machine, per pass.
    ///
    /// The numbers this exists to keep honest came out of a real recording on an
    /// M1 Pro, from the app's own log: 99 s of audio took 228 s to transcribe
    /// and 306 s to diarize. Both are worse than real time, which is the whole
    /// of "the live transcript is minutes behind" and "Stop takes five minutes".
    /// Run this before and after touching anything in the transcription path.
    ///
    ///   LEDGEUR_TEST_WAV=/tmp/ted.wav cargo test --release --features native-ai \
    ///     measures_transcription_speed -- --ignored --nocapture
    #[test]
    #[ignore = "measurement, not an assertion — run by hand when the pipeline changes"]
    fn measures_transcription_speed() {
        let Ok(wav) = std::env::var("LEDGEUR_TEST_WAV") else { return };
        let dir = models_dir_for_test();
        let (audio, rate) = read_wav(&wav);
        let seconds = audio.len() as f32 / rate as f32;
        let model = dir.join(crate::ai::WHISPER_MODEL);
        println!("{seconds:.1}s of audio at {rate} Hz, {} threads", inner::inference_threads());

        // Three passes: the first pays for loading the weights, the rest do not.
        // That gap is the point — it is what every live chunk used to pay.
        for pass in 1..=3 {
            let started = std::time::Instant::now();
            let segments = inner::transcribe_at(&model, &audio, rate).expect("transcribes");
            let elapsed = started.elapsed();
            println!(
                "  pass {pass}: {elapsed:?}  ({:.2}x real time, {} segments)",
                seconds / elapsed.as_secs_f32(),
                segments.len(),
            );
        }
    }

    /// Can the live path keep up with a meeting?
    ///
    /// The question the "Transcribing 171s behind" report actually asks. Replays
    /// a clip the way the recorder does — one utterance at a time, one model
    /// pass at a time — and reports the total model time against the length of
    /// the audio. Anything at or above 1.0x real time falls behind for the rest
    /// of the meeting and never recovers.
    ///
    ///   LEDGEUR_TEST_WAV=/tmp/ted.wav cargo test --release --features native-ai \
    ///     measures_the_live_loop -- --ignored --nocapture
    #[test]
    #[ignore = "measurement, not an assertion"]
    fn measures_the_live_loop() {
        let Ok(wav) = std::env::var("LEDGEUR_TEST_WAV") else { return };
        let dir = models_dir_for_test();
        let (audio, rate) = read_wav(&wav);
        let model = dir.join(crate::ai::WHISPER_MODEL);
        let embed_model = dir.join(EMBED_MODEL);
        let seconds = audio.len() as f32 / rate as f32;

        // 8-second utterances, about what the segmenter produces when it cuts on
        // a natural pause.
        let chunk = (8.0 * rate as f32) as usize;
        let started = std::time::Instant::now();
        let (mut transcribe_total, mut speaker_total) = (
            std::time::Duration::ZERO, std::time::Duration::ZERO,
        );
        let mut chunks = 0;
        for utterance in audio.chunks(chunk) {
            let t = std::time::Instant::now();
            inner::transcribe_at(&model, utterance, rate).expect("transcribes");
            transcribe_total += t.elapsed();
            let t = std::time::Instant::now();
            let _ = inner::embed_at(&embed_model, utterance, rate);
            speaker_total += t.elapsed();
            chunks += 1;
        }
        let total = started.elapsed();
        println!(
            "{chunks} utterances over {seconds:.0}s of audio\n\
             \x20 transcription  {transcribe_total:?}\n\
             \x20 live speakers  {speaker_total:?}\n\
             \x20 total          {total:?}  ({:.2}x real time)",
            seconds / total.as_secs_f32(),
        );
        println!(
            "  the first pass includes loading the weights; a live meeting pays that once, not per chunk",
        );
    }

    /// Whether thread QoS is what made the shipped app so much slower than this
    /// test — and whether `run_at_user_speed` fixes it.
    ///
    /// The shipped app transcribed 99 s of audio in 228 s. The same models, the
    /// same thread count and the same machine do it in about 8 s here. The one
    /// thing the app does that a test does not is run the work on a pool thread
    /// it did not create, inheriting that thread's QoS class — and on macOS a
    /// QoS class decides which cores a thread may use at all.
    ///
    ///   LEDGEUR_TEST_WAV=/tmp/ted.wav cargo test --release --features native-ai \
    ///     measures_qos_effect_on_inference -- --ignored --nocapture
    #[test]
    #[ignore = "measurement, not an assertion"]
    fn measures_qos_effect_on_inference() {
        let Ok(wav) = std::env::var("LEDGEUR_TEST_WAV") else { return };
        let dir = models_dir_for_test();
        let (audio, rate) = read_wav(&wav);
        let seconds = audio.len() as f32 / rate as f32;
        let model = dir.join(crate::ai::WHISPER_MODEL);

        // Warm the weights first, so this measures inference and not loading.
        inner::transcribe_at(&model, &audio, rate).expect("transcribes");

        let run = |label: &str, background: bool, boost: bool| {
            let (model, audio) = (model.clone(), audio.clone());
            std::thread::spawn(move || {
                #[cfg(target_os = "macos")]
                if background {
                    // What a thread inherited from a background pool looks like.
                    unsafe {
                        libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_BACKGROUND, 0);
                    }
                }
                if boost {
                    crate::ai::run_at_user_speed();
                }
                let started = std::time::Instant::now();
                inner::transcribe_at(&model, &audio, rate).expect("transcribes");
                started.elapsed()
            })
            .join()
            .map(|e| println!("  {label:<34} {e:?}  ({:.2}x real time)", seconds / e.as_secs_f32()))
            .expect("thread finishes");
        };

        run("default QoS", false, false);
        run("background QoS (the bug)", true, false);
        run("background QoS + run_at_user_speed", true, true);
    }

    /// How fast one live utterance is placed against the voices heard so far.
    ///
    ///   LEDGEUR_TEST_WAV=/tmp/ted.wav cargo test --release --features native-ai \
    ///     measures_live_speaker_speed -- --ignored --nocapture
    #[test]
    #[ignore = "measurement, not an assertion"]
    fn measures_live_speaker_speed() {
        let Ok(wav) = std::env::var("LEDGEUR_TEST_WAV") else { return };
        let dir = models_dir_for_test();
        let (audio, rate) = read_wav(&wav);
        let model = dir.join(EMBED_MODEL);
        // A five-second utterance, the sort the segmenter hands over.
        let five = &audio[..(5.0 * rate as f32) as usize];
        for pass in 1..=3 {
            let started = std::time::Instant::now();
            let embedding = inner::embed_at(&model, five, rate).expect("embeds");
            println!("  pass {pass}: {:?} ({} dims)", started.elapsed(), embedding.len());
        }
    }

    /// Can this embedding model tell these two people apart at all, and at what
    /// clip length?
    ///
    /// `assignment_threshold_sweep` said no at utterance length: over `ted_60`,
    /// same-speaker distances (min 0.04, median 0.21, max 0.38) and
    /// different-speaker distances (min 0.06, median 0.20, max 0.42) sit on top
    /// of each other, so no threshold separates them. This asks the prior
    /// question — whether that is the model failing outright, or short clips
    /// failing — by pooling each speaker's audio and cutting it into windows of
    /// several lengths. A model that discriminates will show the two halves of
    /// one speaker much closer to each other than to the other speaker.
    ///
    ///   LEDGEUR_TEST_WAV=/tmp/ted.wav cargo test --release --features native-ai \
    ///     measures_speaker_separability -- --ignored --nocapture
    #[test]
    #[ignore = "measurement, not an assertion"]
    fn measures_speaker_separability() {
        let Ok(wav) = std::env::var("LEDGEUR_TEST_WAV") else { return };
        let dir = models_dir_for_test();
        let (audio, rate) = read_wav(&wav);
        let embed_model = dir.join(EMBED_MODEL);
        let truth = inner::run_diarization(
            &dir.join(SEG_MODEL), &dir.join(EMBED_MODEL), &audio, rate,
            inner::DIARIZE_DISTANCE_THRESHOLD, |_, _| {},
        )
        .expect("diarization runs");

        // All of each speaker's audio, end to end.
        let mut pooled: std::collections::BTreeMap<i32, Vec<f32>> = Default::default();
        for t in &truth {
            let per_ms = rate as usize / 1000;
            let a = ((t.start_ms.max(0) as usize) * per_ms).min(audio.len());
            let b = ((t.end_ms.max(0) as usize) * per_ms).min(audio.len());
            if b > a {
                pooled.entry(t.speaker).or_default().extend_from_slice(&audio[a..b]);
            }
        }
        for (spk, a) in &pooled {
            println!("speaker {spk}: {:.1}s of pooled audio", a.len() as f32 / rate as f32);
        }
        let speakers: Vec<i32> = pooled.keys().copied().collect();
        if speakers.len() < 2 {
            println!("need two speakers in the clip");
            return;
        }

        println!("\nwindow   within-speaker distance   between-speaker distance");
        for window_seconds in [1.0f32, 2.0, 3.0, 5.0, 8.0] {
            let n = (window_seconds * rate as f32) as usize;
            // Embed every window of every speaker.
            let mut by_speaker: Vec<(i32, Vec<Vec<f32>>)> = Vec::new();
            for (spk, a) in &pooled {
                let mut embeddings = Vec::new();
                for chunk in a.chunks(n) {
                    if chunk.len() < n {
                        break;
                    }
                    if let Ok(e) = inner::embed_at(&embed_model, chunk, rate) {
                        embeddings.push(e);
                    }
                }
                by_speaker.push((*spk, embeddings));
            }
            let (mut within, mut between) = (Vec::new(), Vec::new());
            for (i, (_, ea)) in by_speaker.iter().enumerate() {
                for (x, a) in ea.iter().enumerate() {
                    for b in ea.iter().skip(x + 1) {
                        within.push(1.0 - crate::ai::voices::cosine(a, b));
                    }
                    for (_, eb) in by_speaker.iter().skip(i + 1) {
                        for b in eb {
                            between.push(1.0 - crate::ai::voices::cosine(a, b));
                        }
                    }
                }
            }
            let mean = |v: &[f32]| if v.is_empty() { f32::NAN } else { v.iter().sum::<f32>() / v.len() as f32 };
            println!(
                "{window_seconds:>5.0}s   mean {:.3} (n={:<4})     mean {:.3} (n={})",
                mean(&within), within.len(), mean(&between), between.len(),
            );
        }
    }

    /// Picks `LIVE_SPEAKER_DISTANCE` from data rather than from the value that
    /// happens to be next to it in the file.
    ///
    /// The full diarization pass is the ground truth: it sees the whole clip at
    /// once and is what the transcript is re-labelled with on Stop. This replays
    /// the same clip the way the live path sees it — one turn at a time, no
    /// hindsight — and reports, for each candidate threshold, how many speakers
    /// the incremental tracker ends up with and how often it agrees with the
    /// full pass about who is talking.
    ///
    /// Agreement is measured up to a renaming of the speakers, because the two
    /// passes have no reason to number people in the same order: the live
    /// tracker names people in the order they first speak. The score is the
    /// share of turns covered by the best one-to-one pairing of live speaker to
    /// true speaker.
    ///
    ///   LEDGEUR_TEST_WAV=/tmp/ted.wav cargo test --release --features native-ai \
    ///     assignment_threshold_sweep -- --ignored --nocapture
    #[test]
    #[ignore = "measurement, not an assertion — re-run when the embedding model changes"]
    fn assignment_threshold_sweep() {
        use crate::ai::live_speakers::LiveSpeakers;
        use std::collections::BTreeMap;

        let Ok(wav) = std::env::var("LEDGEUR_TEST_WAV") else { return };
        let dir = models_dir_for_test();
        let (audio, rate) = read_wav(&wav);

        // Ground truth, and also the turn boundaries: the segmenter cuts on
        // silence, which is close enough to a turn for this purpose and means
        // the sweep is not also measuring a hand-rolled chunker.
        let truth = inner::run_diarization(
            &dir.join(SEG_MODEL), &dir.join(EMBED_MODEL), &audio, rate,
            inner::DIARIZE_DISTANCE_THRESHOLD, |_, _| {},
        )
        .expect("diarization runs");
        let true_speakers: std::collections::BTreeSet<i32> = truth.iter().map(|t| t.speaker).collect();
        println!("ground truth: {} turns, {} speakers", truth.len(), true_speakers.len());

        // Embed each turn once; the sweep then costs nothing per threshold.
        let embed_model = dir.join(EMBED_MODEL);
        let mut turns: Vec<(i32, Vec<f32>)> = Vec::new();
        for t in &truth {
            let a = ((t.start_ms.max(0) as usize) * (rate as usize / 1000)).min(audio.len());
            let b = ((t.end_ms.max(0) as usize) * (rate as usize / 1000)).min(audio.len());
            // Match what the live path will actually attempt, so the sweep
            // measures the decision the app makes rather than a different one.
            if b <= a || ((b - a) as f32 / rate as f32) < 3.0 {
                continue;
            }
            match inner::embed_at(&embed_model, &audio[a..b], rate) {
                Ok(e) => turns.push((t.speaker, e)),
                Err(e) => println!("  (skipped a turn: {e})"),
            }
        }
        println!("{} turns of at least a second to place\n", turns.len());

        // The raw distances first: same-speaker pairs must sit closer than
        // different-speaker pairs, or no threshold can separate them and the
        // problem is the embedding, not the number.
        let (mut same, mut different) = (Vec::new(), Vec::new());
        for (i, (a_spk, a)) in turns.iter().enumerate() {
            for (b_spk, b) in turns.iter().skip(i + 1) {
                let d = 1.0 - crate::ai::voices::cosine(a, b);
                if a_spk == b_spk { same.push(d) } else { different.push(d) }
            }
        }
        let stats = |v: &mut Vec<f32>| {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            (v[0], v[v.len() / 2], v[v.len() - 1])
        };
        let (s_min, s_med, s_max) = stats(&mut same);
        let (d_min, d_med, d_max) = stats(&mut different);
        println!("same speaker    distance min {s_min:.2}  median {s_med:.2}  max {s_max:.2}");
        println!("different       distance min {d_min:.2}  median {d_med:.2}  max {d_max:.2}\n");

        println!("distance  live speakers  agreement  assignment vs truth");
        for step in 1..=20 {
            let threshold = step as f32 * 0.025;
            let mut live = LiveSpeakers::new();
            // pairing[(live index, true speaker)] = how many turns
            let mut pairing: BTreeMap<(usize, i32), usize> = BTreeMap::new();
            for (speaker, embedding) in &turns {
                if let Some(i) = live.assign(embedding, threshold) {
                    *pairing.entry((i, *speaker)).or_default() += 1;
                }
            }
            // Greedy best one-to-one pairing: take the biggest cell, strike out
            // its row and column, repeat. Optimal enough at these sizes.
            // Replayed a second time only to print the sequence; the tracker is
            // cheap once the embeddings exist.
            let mut replay = LiveSpeakers::new();
            let shown: String = turns
                .iter()
                .map(|(spk, e)| match replay.assign(e, threshold) {
                    Some(i) => format!("{}{} ", (b'A' + (i as u8 % 26)) as char, spk),
                    None => "?? ".to_string(),
                })
                .collect();
            let mut cells: Vec<((usize, i32), usize)> = pairing.into_iter().collect();
            cells.sort_by(|a, b| b.1.cmp(&a.1));
            let (mut used_live, mut used_true) = (Vec::new(), Vec::new());
            let mut agreed = 0usize;
            for ((l, t), n) in cells {
                if used_live.contains(&l) || used_true.contains(&t) {
                    continue;
                }
                used_live.push(l);
                used_true.push(t);
                agreed += n;
            }
            println!(
                "{threshold:>8.3}  {:>13}  {:>8.0}%  {shown}",
                live.len(),
                100.0 * agreed as f32 / turns.len().max(1) as f32,
            );
        }
    }

    /// Sweeps the clustering threshold over a known two-speaker clip and prints
    /// what each value produces. This is how `DIARIZE_DISTANCE_THRESHOLD` was
    /// chosen: sherpa-onnx's own default (0.5) merged the interviewer and the
    /// guest into one speaker on this clip, which is the exact symptom being
    /// fixed, so the value had to be measured rather than inherited.
    ///
    ///   LEDGEUR_TEST_WAV=/tmp/ted.wav cargo test --features native-ai \
    ///     sweeps_the_clustering_threshold -- --ignored --nocapture
    #[test]
    #[ignore = "measurement, not an assertion — run by hand when the model changes"]
    fn sweeps_the_clustering_threshold() {
        let Ok(wav) = std::env::var("LEDGEUR_TEST_WAV") else { return };
        let dir = models_dir_for_test();
        let (audio, rate) = read_wav(&wav);
        println!("threshold  speakers  segments  time");
        for step in 1..=14 {
            let threshold = step as f32 * 0.05;
            let started = std::time::Instant::now();
            let segments = inner::run_diarization(
                &dir.join(SEG_MODEL), &dir.join(EMBED_MODEL), &audio, rate, threshold, |_, _| {},
            )
            .expect("diarization runs");
            let speakers: std::collections::BTreeSet<i32> = segments.iter().map(|s| s.speaker).collect();
            println!(
                "{threshold:>9.2}  {:>8}  {:>8}  {:?}",
                speakers.len(), segments.len(), started.elapsed(),
            );
        }
    }

    #[test]
    #[ignore = "needs downloaded models and LEDGEUR_TEST_WAV"]
    fn diarizes_two_speakers() {
        let Ok(wav) = std::env::var("LEDGEUR_TEST_WAV") else { return };
        let dir = models_dir_for_test();
        let (audio, rate) = read_wav(&wav);
        println!("audio: {:.1}s at {rate} Hz", audio.len() as f32 / rate as f32);

        let mut ticks = 0;
        let started = std::time::Instant::now();
        let segments = inner::run_diarization(
            &dir.join(SEG_MODEL),
            &dir.join(EMBED_MODEL),
            &audio,
            rate,
            inner::DIARIZE_DISTANCE_THRESHOLD,
            |_done, _total| ticks += 1,
        )
        .expect("diarization runs");
        let elapsed = started.elapsed();

        let speakers: std::collections::BTreeSet<i32> = segments.iter().map(|s| s.speaker).collect();
        println!(
            "{} segments, {} speakers, in {elapsed:?} ({} progress callbacks, {} threads)",
            segments.len(), speakers.len(), ticks, inner::inference_threads(),
        );
        for s in segments.iter().take(12) {
            println!("  speaker {} {:>6}ms → {:>6}ms", s.speaker, s.start_ms, s.end_ms);
        }

        // The FFI is sound: a wrong struct layout gives a null diarizer or a
        // crash, and neither reaches here.
        assert!(!segments.is_empty(), "no speaker turns found at all");
        assert!(ticks > 0, "progress callback never fired");
        // ted_60.wav is an interview: an interviewer and a guest. The point of
        // the fix is that it stops being forced to exactly 4 clusters, and stops
        // collapsing distinct voices into one.
        assert!(
            (2..=4).contains(&speakers.len()),
            "expected roughly two speakers in the interview clip, got {}", speakers.len(),
        );
        assert!(segments.windows(2).all(|w| w[0].start_ms <= w[1].start_ms), "segments must be time-ordered");
        // Real-time factor: this used to be far slower than the audio itself.
        let audio_seconds = audio.len() as f32 / rate as f32;
        assert!(
            elapsed.as_secs_f32() < audio_seconds,
            "diarization took {elapsed:?} for {audio_seconds:.0}s of audio — slower than real time",
        );
    }
}
