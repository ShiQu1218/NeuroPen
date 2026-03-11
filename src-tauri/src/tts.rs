//! TTS module — text-to-speech via Piper CLI.
//!
//! Uses the local `piper` executable to synthesize WAV audio, then plays it
//! back with `rodio`.
//!
//! Emits:
//!   `tts://start`       — playback started
//!   `tts://done`        — playback finished
//!   `tts://error(msg)`  — synthesis/playback failure

use crate::tts_models;
use futures_util::StreamExt;
use once_cell::sync::Lazy;
use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

pub use crate::tts_models::LocalTtsModel;

static TTS_PLAYING: AtomicBool = AtomicBool::new(false);
static MODEL_DOWNLOAD_ACTIVE: AtomicBool = AtomicBool::new(false);
static MODEL_DOWNLOAD_CANCEL: AtomicBool = AtomicBool::new(false);

/// Stop signal shared between playback thread and stop command.
static TTS_STOP: Lazy<Arc<AtomicBool>> = Lazy::new(|| Arc::new(AtomicBool::new(false)));

/// Default per-language Piper model lookup inside `~/.neuropen/piper/`.
const MODEL_MAP: &[(&str, &str)] = &[
    ("zh-TW", "zh-TW.onnx"),
    ("zh-CN", "zh-CN.onnx"),
    ("en-US", "en-US.onnx"),
    ("ja-JP", "ja-JP.onnx"),
    ("ko-KR", "ko-KR.onnx"),
    ("fr-FR", "fr-FR.onnx"),
    ("de-DE", "de-DE.onnx"),
    ("es-ES", "es-ES.onnx"),
    ("ru-RU", "ru-RU.onnx"),
    ("ar-SA", "ar-SA.onnx"),
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

    if hiragana_katakana > 0 {
        return "ja-JP";
    }
    if hangul > 0 {
        return "ko-KR";
    }
    if cyrillic > 0 {
        return "ru-RU";
    }
    if arabic > 0 {
        return "ar-SA";
    }

    let total = cjk + latin;
    if total == 0 {
        return "zh-TW";
    }
    if cjk as f64 / total as f64 > 0.3 {
        return "zh-TW";
    }
    "en-US"
}

fn default_model_path_for_language(lang: &str) -> Option<PathBuf> {
    let file_name = MODEL_MAP
        .iter()
        .find(|(code, _)| *code == lang)
        .map(|(_, file_name)| *file_name)?;
    let home = dirs::home_dir()?;
    Some(home.join(".neuropen").join("piper").join(file_name))
}

fn resolve_model_path(model_override: Option<String>, text: &str) -> Result<PathBuf, String> {
    if let Some(path) = model_override {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            let model_path = PathBuf::from(trimmed);
            if model_path.exists() {
                return Ok(model_path);
            }
            return Err(format!("Piper model not found: {}", model_path.display()));
        }
    }

    let lang = detect_language(text);
    if let Some(model_path) = tts_models::preferred_model_path_for_language(lang)? {
        return Ok(model_path);
    }

    if let Ok(env_path) = std::env::var("NEUROPEN_PIPER_MODEL") {
        let trimmed = env_path.trim();
        if !trimmed.is_empty() {
            let model_path = PathBuf::from(trimmed);
            if model_path.exists() {
                return Ok(model_path);
            }
            return Err(format!(
                "Piper model from NEUROPEN_PIPER_MODEL not found: {}",
                model_path.display()
            ));
        }
    }

    if let Some(model_path) = default_model_path_for_language(lang) {
        if model_path.exists() {
            return Ok(model_path);
        }
        return Err(format!(
            "No Piper model configured. Set a model path in Settings or place one at {}",
            model_path.display()
        ));
    }

    Err("No Piper model configured.".to_string())
}

fn parse_length_scale(rate: Option<&str>) -> f32 {
    let Some(rate) = rate.map(str::trim).filter(|value| !value.is_empty()) else {
        return 1.0;
    };
    let Ok(percent) = rate.trim_end_matches('%').parse::<f32>() else {
        return 1.0;
    };
    let speed_multiplier = (1.0 + percent / 100.0).clamp(0.25, 4.0);
    (1.0 / speed_multiplier).clamp(0.25, 4.0)
}

fn parse_speaker_id(value: Option<&str>) -> Result<Option<u32>, String> {
    let Some(value) = value.map(str::trim).filter(|entry| !entry.is_empty()) else {
        return Ok(None);
    };
    value
        .parse::<u32>()
        .map(Some)
        .map_err(|_| format!("Invalid Piper speaker id: {value}"))
}

pub fn is_playing() -> bool {
    TTS_PLAYING.load(Ordering::Relaxed)
}

pub fn stop_playback() {
    TTS_STOP.store(true, Ordering::SeqCst);
}

pub fn list_local_tts_models() -> Result<Vec<LocalTtsModel>, String> {
    tts_models::list_local_tts_models()
}

pub async fn install_local_tts_model(
    app: tauri::AppHandle,
    model_id: String,
) -> Result<LocalTtsModel, String> {
    let entry = tts_models::catalog_entry_by_id(&model_id)
        .ok_or_else(|| format!("Unknown local TTS model id: {model_id}"))?;
    let install_artifacts = tts_models::install_artifacts(entry)?;
    let already_installed = install_artifacts
        .iter()
        .all(|artifact| artifact.path.is_file());

    if !already_installed {
        if MODEL_DOWNLOAD_ACTIVE.swap(true, Ordering::SeqCst) {
            return Err("Another model download is in progress".to_string());
        }
        MODEL_DOWNLOAD_CANCEL.store(false, Ordering::SeqCst);
        let client = reqwest::Client::new();

        let download_result: Result<(), String> = async {
            let mut downloaded: u64 = install_artifacts
                .iter()
                .filter_map(|artifact| artifact.path.metadata().ok().map(|meta| meta.len()))
                .sum();
            let mut total_bytes: Option<u64> = None;

            let _ = app.emit(
                "tts://model-download-progress",
                serde_json::json!({
                    "modelId": model_id,
                    "status": "start",
                    "downloadedBytes": downloaded,
                    "totalBytes": total_bytes,
                    "progressPct": 0.0f64,
                }),
            );

            for artifact in &install_artifacts {
                if artifact.path.is_file() {
                    continue;
                }

                if let Some(parent) = artifact.path.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|e| format!("Failed to create TTS model directory: {e}"))?;
                }

                let response = client
                    .get(&artifact.download_url)
                    .send()
                    .await
                    .map_err(|e| format!("Failed to download TTS model artifact: {e}"))?;
                if !response.status().is_success() {
                    return Err(format!(
                        "Failed to download TTS model artifact: HTTP {}",
                        response.status()
                    ));
                }

                if let Some(content_length) = response.content_length() {
                    total_bytes = Some(total_bytes.unwrap_or(downloaded) + content_length);
                }

                let temp_path = artifact.path.with_extension("download");
                let mut file = tokio::fs::File::create(&temp_path)
                    .await
                    .map_err(|e| format!("Failed to create TTS temp file: {e}"))?;
                let mut stream = response.bytes_stream();

                while let Some(chunk) = stream.next().await {
                    if MODEL_DOWNLOAD_CANCEL.load(Ordering::SeqCst) {
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        let _ = app.emit(
                            "tts://model-download-progress",
                            serde_json::json!({
                                "modelId": model_id,
                                "status": "cancelled",
                                "downloadedBytes": downloaded,
                                "totalBytes": total_bytes,
                                "progressPct": 0.0f64,
                            }),
                        );
                        return Err("Model download cancelled".to_string());
                    }

                    let bytes =
                        chunk.map_err(|e| format!("Failed to read TTS download chunk: {e}"))?;
                    tokio::io::AsyncWriteExt::write_all(&mut file, &bytes)
                        .await
                        .map_err(|e| format!("Failed to write TTS model file: {e}"))?;
                    downloaded += bytes.len() as u64;
                    let progress_pct = total_bytes
                        .filter(|total| *total > 0)
                        .map(|total| ((downloaded as f64 / total as f64) * 100.0).min(100.0))
                        .unwrap_or(0.0);
                    let _ = app.emit(
                        "tts://model-download-progress",
                        serde_json::json!({
                            "modelId": model_id,
                            "status": "downloading",
                            "downloadedBytes": downloaded,
                            "totalBytes": total_bytes,
                            "progressPct": progress_pct,
                        }),
                    );
                }

                tokio::fs::rename(&temp_path, &artifact.path)
                    .await
                    .map_err(|e| format!("Failed to finalize TTS model file: {e}"))?;
            }

            let _ = app.emit(
                "tts://model-download-progress",
                serde_json::json!({
                    "modelId": model_id,
                    "status": "done",
                    "downloadedBytes": downloaded,
                    "totalBytes": total_bytes,
                    "progressPct": 100.0f64,
                }),
            );
            Ok(())
        }
        .await;

        MODEL_DOWNLOAD_ACTIVE.store(false, Ordering::SeqCst);
        if let Err(err) = download_result {
            let _ = app.emit(
                "tts://model-download-progress",
                serde_json::json!({
                    "modelId": model_id,
                    "status": "error",
                }),
            );
            return Err(err);
        }
    }

    tts_models::list_local_tts_models()?
        .into_iter()
        .find(|model| model.id == model_id)
        .ok_or_else(|| "Installed TTS model not found in catalog".to_string())
}

pub fn cancel_local_tts_download() -> bool {
    if MODEL_DOWNLOAD_ACTIVE.load(Ordering::SeqCst) {
        MODEL_DOWNLOAD_CANCEL.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

pub fn delete_local_tts_model(model_id: String) -> Result<(), String> {
    tts_models::delete_local_tts_model(model_id)
}

pub fn select_local_tts_model(model_id: String) -> Result<String, String> {
    tts_models::select_local_tts_model(model_id)
}

/// Synthesize and play text using Piper.
/// `voice_override` now represents the Piper model path.
/// `rate` is converted into Piper `length_scale`.
/// `pitch` is re-used as Piper `speaker_id`.
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

    TTS_STOP.store(true, Ordering::SeqCst);
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    TTS_STOP.store(false, Ordering::SeqCst);

    let model_path = resolve_model_path(voice_override, &text)?;
    let length_scale = parse_length_scale(rate.as_deref());
    let speaker_id = parse_speaker_id(pitch.as_deref())?;

    let _ = app.emit("tts://start", ());
    TTS_PLAYING.store(true, Ordering::SeqCst);

    let stop_flag = TTS_STOP.clone();
    let app_clone = app.clone();

    let result = tokio::task::spawn_blocking(move || {
        synthesize_and_play(&text, &model_path, length_scale, speaker_id, stop_flag)
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

fn synthesize_and_play(
    text: &str,
    model_path: &PathBuf,
    length_scale: f32,
    speaker_id: Option<u32>,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let tmp_dir = std::env::temp_dir().join("neuropen_tts");
    let _ = std::fs::create_dir_all(&tmp_dir);
    let tmp_file = tmp_dir.join(format!("tts_{}.wav", std::process::id()));

    let mut cmd = std::process::Command::new("piper");
    cmd.arg("--model")
        .arg(model_path)
        .arg("--output_file")
        .arg(&tmp_file)
        .arg("--length_scale")
        .arg(format!("{length_scale:.3}"))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    if let Some(speaker_id) = speaker_id {
        cmd.arg("--speaker").arg(speaker_id.to_string());
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to run Piper (is `piper` installed and on PATH?): {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("Failed to send text to Piper: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for Piper: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Piper failed: {stderr}"));
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&tmp_file);
        return Ok(());
    }

    let wav_data =
        std::fs::read(&tmp_file).map_err(|e| format!("Failed to read Piper output: {e}"))?;
    let _ = std::fs::remove_file(&tmp_file);

    if wav_data.is_empty() {
        return Err("Piper produced empty audio".to_string());
    }

    play_wav_bytes(&wav_data, stop_flag)
}

fn play_wav_bytes(data: &[u8], stop_flag: Arc<AtomicBool>) -> Result<(), String> {
    let (_stream, stream_handle) = rodio::OutputStream::try_default()
        .map_err(|e| format!("Failed to open audio output: {e}"))?;

    let cursor = Cursor::new(data.to_vec());
    let source = rodio::Decoder::new(cursor).map_err(|e| format!("Failed to decode WAV: {e}"))?;

    let sink = rodio::Sink::try_new(&stream_handle)
        .map_err(|e| format!("Failed to create audio sink: {e}"))?;
    sink.append(source);

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
