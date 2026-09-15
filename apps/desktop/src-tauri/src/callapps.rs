// Detects whether a native call app that is known to duck its own microphone
// underneath a concurrent recording is currently running — so the Record
// screen can tell somebody about it before they discover it the way v0.3.7's
// bug report happened: mid-call, from the other side going quiet.
//
// Why this exists despite v0.3.7's fix: that release made Ledgeur's own mic
// and system-audio capture fully passive (see packages/core/src/browser/
// capture.ts's `MIC_PROCESSING`), and repeated CoreAudio-level testing since
// (property-change listeners on both the mic and speaker devices, including
// with real audio actively playing) found zero hardware-level disturbance
// from Ledgeur's own code. What's left is on the other side: Zoom ships its
// own microphone auto-gain-control ("Automatically adjust microphone
// volume", on by default, separate from its noise-suppression/"enhancement"
// toggles) that is independently documented — Zoom's own community forum,
// Apple's discussion forums — to reset mic input to a low level and fluctuate
// it. Ledgeur has no way to read or change another app's preferences, so the
// only thing left to fix in-product is making sure a person hears about the
// one setting to check, at the moment it's relevant, instead of needing to
// already know to go looking for it.
//
// Deliberately narrow: only apps this has actually been confirmed on. A
// browser-based call (Meet, in Chrome) isn't here — its AGC didn't show the
// same behaviour in testing, and guessing at other native apps' settings
// menus would risk sending someone hunting for a checkbox that doesn't exist.

/// (process name as `ps -o comm=` reports it, what to call it in the UI).
const KNOWN: &[(&str, &str)] = &[("zoom.us", "Zoom")];

/// Pure matching, separated from the `ps` call so it's testable without a
/// real process list.
fn match_running(running: &[&str]) -> Option<String> {
    KNOWN
        .iter()
        .find(|(process_name, _)| running.contains(process_name))
        .map(|(_, display_name)| display_name.to_string())
}

#[cfg(target_os = "macos")]
mod inner {
    use super::match_running;
    use std::process::Command;

    pub fn detect() -> Option<String> {
        let output = Command::new("ps").args(["-axc", "-o", "comm="]).output().ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        let running: Vec<&str> = text.lines().map(str::trim).collect();
        match_running(&running)
    }
}

#[cfg(not(target_os = "macos"))]
mod inner {
    pub fn detect() -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::match_running;

    #[test]
    fn finds_zoom_among_other_processes() {
        let running = ["Finder", "zoom.us", "Dock"];
        assert_eq!(match_running(&running), Some("Zoom".to_string()));
    }

    #[test]
    fn none_when_nothing_known_is_running() {
        let running = ["Finder", "Dock", "Safari"];
        assert_eq!(match_running(&running), None);
    }

    #[test]
    fn does_not_match_on_partial_or_case_different_names() {
        // `ps -o comm=` reports exact executable names — a prefix match would
        // also catch unrelated helper processes like ZoomChat or ZoomClips.
        let running = ["ZoomChat", "us.zoom.ZoomAutoUpdater", "Zoom.us"];
        assert_eq!(match_running(&running), None);
    }
}

/// The display name of a known call app if one is currently running (e.g.
/// `"Zoom"`), else `None`. Checked from the Record screen, not continuously —
/// see `apps/desktop/src/lib/callApps.ts`.
#[tauri::command]
pub fn detect_running_call_app() -> Option<String> {
    inner::detect()
}
