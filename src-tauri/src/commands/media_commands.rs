use crate::{screenshot, tts};

#[tauri::command]
pub async fn tts_speak(
    app: tauri::AppHandle,
    text: String,
    voice: Option<String>,
    rate: Option<String>,
    pitch: Option<String>,
) -> Result<(), String> {
    tts::speak(app, text, voice, rate, pitch).await
}

#[tauri::command]
pub fn tts_stop() {
    tts::stop_playback();
}

#[tauri::command]
pub fn tts_is_playing() -> bool {
    tts::is_playing()
}

#[tauri::command]
pub fn take_screenshot() -> Result<screenshot::ScreenshotResult, String> {
    screenshot::capture_full_screen()
}

#[tauri::command]
pub fn take_screenshot_region(x: i32, y: i32, w: u32, h: u32) -> Result<screenshot::ScreenshotResult, String> {
    screenshot::capture_region(x, y, w, h)
}
