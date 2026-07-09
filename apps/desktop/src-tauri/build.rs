fn main() {
    // Forward SENTRY_DSN from apps/desktop/.env (same file the frontend reads
    // VITE_SENTRY_DSN from) so there's one place to configure error tracking.
    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env");
    println!("cargo:rerun-if-changed={}", env_path.display());
    if let Ok(iter) = dotenvy::from_path_iter(&env_path) {
        for (key, value) in iter.flatten() {
            if key == "SENTRY_DSN" {
                println!("cargo:rustc-env=SENTRY_DSN={value}");
            }
        }
    }
    tauri_build::build()
}
