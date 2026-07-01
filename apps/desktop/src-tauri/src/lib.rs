// ParleyNotes native shell. The same entry point powers desktop (macOS/Windows)
// and mobile (iOS/Android) — Tauri wires `run()` to each platform. On-device AI
// (whisper.cpp transcription + sherpa-onnx diarization) is exposed as commands
// from the `ai` module (real when built with `--features native-ai`).

mod ai;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            ai::ai_status,
            ai::download_models,
            ai::transcribe_chunk,
            ai::transcribe_diarize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the ParleyNotes application");
}
