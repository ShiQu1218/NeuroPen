use tauri::utils::config::Config;

#[test]
fn status_indicator_does_not_take_focus_from_screenshot_overlay() {
    let config: Config = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("desktop window configuration should be valid");
    let indicator = config
        .app
        .windows
        .iter()
        .find(|window| window.label == "recording-indicator")
        .expect("status indicator window should exist");

    // Screenshot startup emits a status message which shows this window.
    // Activating it blurs the screenshot overlay and cancels the selection.
    assert!(!indicator.focus, "status messages must not request focus");
    assert!(!indicator.focusable, "status messages must not take focus");

    let overlay = config
        .app
        .windows
        .iter()
        .find(|window| window.label == "screenshot-overlay")
        .expect("screenshot overlay window should exist");
    assert!(
        overlay.focusable,
        "selection must still receive keyboard input"
    );
}
