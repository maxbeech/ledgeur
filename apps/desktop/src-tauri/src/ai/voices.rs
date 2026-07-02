// Voice-print profiles for speaker identification. Enrolment computes a speaker
// embedding (sherpa-onnx, native feature); profiles persist in the app data dir
// as voices.json. Matching is plain cosine similarity — pure and unit-tested.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// A match is accepted at or above this cosine similarity (sherpa-onnx default).
pub const SIMILARITY_THRESHOLD: f32 = 0.5;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VoiceProfile {
    pub id: String,
    pub name: String,
    /// Unix seconds — formatted by the UI.
    pub created_at: u64,
    pub embedding: Vec<f32>,
}

/// The shape sent to the UI (embeddings stay on disk).
#[derive(Serialize, Clone, Debug)]
pub struct VoiceProfileMeta {
    pub id: String,
    pub name: String,
    pub created_at: u64,
}

impl From<&VoiceProfile> for VoiceProfileMeta {
    fn from(p: &VoiceProfile) -> Self {
        Self { id: p.id.clone(), name: p.name.clone(), created_at: p.created_at }
    }
}

pub fn voices_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("voices.json")
}

pub fn load_profiles(app: &tauri::AppHandle) -> Vec<VoiceProfile> {
    let path = voices_path(app);
    let Ok(raw) = fs::read_to_string(&path) else { return Vec::new() };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn save_profiles(app: &tauri::AppHandle, profiles: &[VoiceProfile]) -> Result<(), String> {
    let path = voices_path(app);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string(profiles).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}

/// Cosine similarity in [-1, 1]. Pure — unit-tested.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || a.len() != b.len() {
        return -1.0;
    }
    let (mut dot, mut na, mut nb) = (0f32, 0f32, 0f32);
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        return -1.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

/// Best profile match for an embedding, or None below the threshold. Pure.
pub fn best_match<'a>(embedding: &[f32], profiles: &'a [VoiceProfile]) -> Option<(&'a VoiceProfile, f32)> {
    let mut best: Option<(&VoiceProfile, f32)> = None;
    for p in profiles {
        let sim = cosine(embedding, &p.embedding);
        if sim >= SIMILARITY_THRESHOLD && best.map_or(true, |(_, b)| sim > b) {
            best = Some((p, sim));
        }
    }
    best
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------- Tauri commands (listing/deleting work in every build) ----------

#[tauri::command]
pub fn list_voice_profiles(app: tauri::AppHandle) -> Vec<VoiceProfileMeta> {
    load_profiles(&app).iter().map(VoiceProfileMeta::from).collect()
}

#[tauri::command]
pub fn delete_voice_profile(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut profiles = load_profiles(&app);
    let before = profiles.len();
    profiles.retain(|p| p.id != id);
    if profiles.len() == before {
        return Err("No such voice profile.".into());
    }
    save_profiles(&app, &profiles)
}

/// Enroll a voice from ~5–15 s of clear speech. Requires the native engine +
/// downloaded models; otherwise returns an explicit error.
#[tauri::command]
pub fn enroll_voice(
    app: tauri::AppHandle,
    name: String,
    samples: Vec<f32>,
    sample_rate: u32,
) -> Result<VoiceProfileMeta, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Give the voice a name.".into());
    }
    if (samples.len() as f32) < sample_rate as f32 * 3.0 {
        return Err("Record at least 3 seconds of clear speech.".into());
    }
    let embedding = crate::ai::engine::embed_voice(&app, &samples, sample_rate)?;
    let mut profiles = load_profiles(&app);
    let profile = VoiceProfile {
        id: format!("vp-{}-{}", now_unix(), profiles.len() + 1),
        name,
        created_at: now_unix(),
        embedding,
    };
    let meta = VoiceProfileMeta::from(&profile);
    profiles.push(profile);
    save_profiles(&app, &profiles)?;
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(name: &str, embedding: Vec<f32>) -> VoiceProfile {
        VoiceProfile { id: name.into(), name: name.into(), created_at: 0, embedding }
    }

    #[test]
    fn cosine_basics() {
        assert!((cosine(&[1.0, 0.0], &[1.0, 0.0]) - 1.0).abs() < 1e-6);
        assert!(cosine(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
        assert!((cosine(&[1.0, 0.0], &[-1.0, 0.0]) + 1.0).abs() < 1e-6);
        assert_eq!(cosine(&[], &[]), -1.0);
        assert_eq!(cosine(&[1.0], &[1.0, 2.0]), -1.0);
    }

    #[test]
    fn best_match_respects_threshold() {
        let profiles = vec![profile("close", vec![1.0, 0.1]), profile("far", vec![0.0, 1.0])];
        let (p, sim) = best_match(&[1.0, 0.0], &profiles).expect("match");
        assert_eq!(p.name, "close");
        assert!(sim > 0.9);
        assert!(best_match(&[-1.0, 0.0], &profiles).is_none());
    }
}
