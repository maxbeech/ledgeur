// Ledgeur native shell. The same entry point powers desktop (macOS/Windows)
// and mobile (iOS/Android) — Tauri wires `run()` to each platform. On-device AI
// (whisper.cpp transcription + sherpa-onnx diarization) is exposed as commands
// from the `ai` module (real when built with `--features native-ai`).

mod ai;

/// Crash/error reporting for the native layer. Reads SENTRY_DSN, baked in at
/// compile time from apps/desktop/.env by build.rs; disabled (returns None)
/// when unset, so local dev with no DSN configured never touches the network.
/// The guard must stay alive for the app's lifetime to flush events on exit.
fn init_sentry() -> Option<sentry::ClientInitGuard> {
    let dsn = option_env!("SENTRY_DSN").unwrap_or("");
    if dsn.is_empty() {
        return None;
    }
    Some(sentry::init((
        dsn,
        sentry::ClientOptions {
            release: sentry::release_name!(),
            ..Default::default()
        },
    )))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _sentry_guard = init_sentry();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .invoke_handler(tauri::generate_handler![
            ai::ai_status,
            ai::download_models,
            ai::llm_status,
            ai::download_llm,
            ai::llm_chat,
            ai::transcribe_chunk,
            ai::transcribe_diarize,
            ai::voices::list_voice_profiles,
            ai::voices::enroll_voice,
            ai::voices::delete_voice_profile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Ledgeur application");
}
