//! TTS module — text-to-speech via edge-tts (Microsoft Edge TTS).
//!
//! Uses the `msedge-tts` crate to connect to Microsoft's Edge TTS WebSocket API.
//! Audio is played back locally via `rodio`.
//!
//! Emits:
//!   `tts://start`       — playback started
//!   `tts://done`        — playback finished
//!   `tts://error(msg)`  — synthesis/playback failure

use once_cell::sync::Lazy;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

static TTS_PLAYING: AtomicBool = AtomicBool::new(false);

/// Stop signal shared between playback thread and stop command.
static TTS_STOP: Lazy<Arc<AtomicBool>> = Lazy::new(|| Arc::new(AtomicBool::new(false)));

/// Multi-language voice map (language code → Edge TTS voice name).
const VOICE_MAP: &[(&str, &str)] = &[
    ("zh-TW", "zh-TW-HsiaoChenNeural"),
    ("zh-CN", "zh-CN-XiaoxiaoNeural"),
    ("en-US", "en-US-JennyNeural"),
    ("ja-JP", "ja-JP-NanamiNeural"),
    ("ko-KR", "ko-KR-SunHiNeural"),
    ("fr-FR", "fr-FR-DeniseNeural"),
    ("de-DE", "de-DE-KatjaNeural"),
    ("es-ES", "es-ES-ElviraNeural"),
    ("ru-RU", "ru-RU-SvetlanaNeural"),
    ("ar-SA", "ar-SA-ZariyahNeural"),
];

/// Simple language detection based on character analysis.
fn detect_language(text: &str) -> &'static str {
    let mut cjk = 0u32;
    let mut hiragana_katakana = 0u32;
    let mut hangul = 0u32;
    let mut cyrillic = 0u32;
    let mut arabic = 0u32;
    let mut latin = 0u32;

    for ch in text.chars() {
        match ch {
            '\u{3040}'..='\u{309F}' | '\u{30A0}'..='\u{30FF}' => hiragana_katakana += 1,
            '\u{AC00}'..='\u{D7AF}' | '\u{1100}'..='\u{11FF}' => hangul += 1,
            '\u{4E00}'..='\u{9FFF}' | '\u{3400}'..='\u{4DBF}' => cjk += 1,
            '\u{0400}'..='\u{04FF}' => cyrillic += 1,
            '\u{0600}'..='\u{06FF}' => arabic += 1,
            'a'..='z' | 'A'..='Z' | '\u{00C0}'..='\u{00FF}' => latin += 1,
            _ => {}
        }
    }

    if hiragana_katakana > 0 { return "ja-JP"; }
    if hangul > 0 { return "ko-KR"; }
    if cyrillic > 0 { return "ru-RU"; }
    if arabic > 0 { return "ar-SA"; }

    let total = cjk + latin;
    if total == 0 { return "zh-TW"; }
    if cjk as f64 / total as f64 > 0.3 { return "zh-TW"; }
    "en-US"
}

/// Get the Edge TTS voice name for a language code.
fn voice_for_language(lang: &str) -> &'static str {
    VOICE_MAP
        .iter()
        .find(|(code, _)| *code == lang)
        .map(|(_, voice)| *voice)
        .unwrap_or("zh-TW-HsiaoChenNeural")
}

pub fn is_playing() -> bool {
    TTS_PLAYING.load(Ordering::Relaxed)
}

pub fn stop_playback() {
    TTS_STOP.store(true, Ordering::SeqCst);
}

/// Synthesize and play text using edge-tts.
/// `voice_override`: if provided, use this voice instead of auto-detecting.
pub async fn speak(
    app: tauri::AppHandle,
    text: String,
    voice_override: Option<String>,
    rate: Option<String>,
    pitch: Option<String>,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }

    // Stop any existing playback
    TTS_STOP.store(true, Ordering::SeqCst);
    // Brief pause to let previous playback stop
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    TTS_STOP.store(false, Ordering::SeqCst);

    let voice = voice_override.unwrap_or_else(|| {
        let lang = detect_language(&text);
        voice_for_language(lang).to_string()
    });

    let rate_str = rate.unwrap_or_else(|| "+0%".to_string());
    let pitch_str = pitch.unwrap_or_else(|| "+0Hz".to_string());

    let _ = app.emit("tts://start", ());
    TTS_PLAYING.store(true, Ordering::SeqCst);

    let stop_flag = TTS_STOP.clone();
    let app_clone = app.clone();

    // Run TTS synthesis in a blocking task
    let result = tokio::task::spawn_blocking(move || {
        synthesize_and_play(&text, &voice, &rate_str, &pitch_str, stop_flag)
    })
    .await
    .map_err(|e| format!("TTS task panicked: {e}"))?;

    TTS_PLAYING.store(false, Ordering::SeqCst);

    match result {
        Ok(()) => {
            let _ = app_clone.emit("tts://done", ());
            Ok(())
        }
        Err(e) => {
            let _ = app_clone.emit("tts://error", serde_json::json!({ "message": e }));
            Err(e)
        }
    }
}

/// Synchronous synthesis + playback (runs in spawn_blocking).
fn synthesize_and_play(
    text: &str,
    voice: &str,
    rate: &str,
    pitch: &str,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    // Use edge-tts CLI via subprocess (Python package).
    // This is the most reliable approach as edge-tts handles the WebSocket protocol.
    let tmp_dir = std::env::temp_dir().join("neuropen_tts");
    let _ = std::fs::create_dir_all(&tmp_dir);
    let tmp_file = tmp_dir.join(format!("tts_{}.mp3", std::process::id()));

    let mut cmd = std::process::Command::new("edge-tts");
    cmd.arg("--voice").arg(voice)
        .arg("--rate").arg(rate)
        .arg("--pitch").arg(pitch)
        .arg("--text").arg(text)
        .arg("--write-media").arg(&tmp_file);

    let output = cmd.output().map_err(|e| {
        format!("Failed to run edge-tts (is it installed? `pip install edge-tts`): {e}")
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("edge-tts failed: {stderr}"));
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&tmp_file);
        return Ok(());
    }

    // Read the MP3 file and play via rodio
    let mp3_data = std::fs::read(&tmp_file)
        .map_err(|e| format!("Failed to read TTS output: {e}"))?;
    let _ = std::fs::remove_file(&tmp_file);

    if mp3_data.is_empty() {
        return Err("edge-tts produced empty audio".to_string());
    }

    play_mp3_bytes(&mp3_data, stop_flag)
}

/// Play MP3 bytes using rodio.
fn play_mp3_bytes(data: &[u8], stop_flag: Arc<AtomicBool>) -> Result<(), String> {
    let (_stream, stream_handle) = rodio::OutputStream::try_default()
        .map_err(|e| format!("Failed to open audio output: {e}"))?;

    let cursor = Cursor::new(data.to_vec());
    let source = rodio::Decoder::new(cursor)
        .map_err(|e| format!("Failed to decode MP3: {e}"))?;

    let sink = rodio::Sink::try_new(&stream_handle)
        .map_err(|e| format!("Failed to create audio sink: {e}"))?;
    sink.append(source);

    // Wait for playback to finish or stop signal
    while !sink.empty() {
        if stop_flag.load(Ordering::Relaxed) {
            sink.stop();
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    sink.sleep_until_end();
    Ok(())
}
