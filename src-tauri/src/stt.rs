//! Speech-to-Text engine using OpenAI Whisper API.
//!
//! Phase 2 implementation:
//! - Open microphone via `cpal` (audio_capture module)
//! - On stop, send buffered audio to OpenAI Whisper API
//! - Emit Tauri events:
//!     `stt://start`         — recording began
//!     `stt://partial(text)` — intermediate transcript (future: chunked)
//!     `stt://final`         — final transcript ready
//!     `stt://stop`          — recording ended
//!     `stt://error`         — transcription failed

use crate::audio_capture::{self, CaptureHandle, TARGET_SAMPLE_RATE};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[cfg(feature = "local-stt")]
use std::sync::Arc;
use std::sync::Mutex;
use tauri::Emitter;

/// Which STT backend to use.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SttEngine {
    OpenAi,
    #[serde(alias = "local")]
    LocalWhisper,
    Parakeet,
    Moonshine,
}

/// Runtime capabilities — which engines are compiled in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttCapabilities {
    pub openai_available: bool,
    pub local_available: bool,
    pub parakeet_available: bool,
    pub moonshine_available: bool,
}

pub fn get_capabilities() -> SttCapabilities {
    SttCapabilities {
        openai_available: true,
        #[cfg(feature = "local-stt")]
        local_available: true,
        #[cfg(not(feature = "local-stt"))]
        local_available: false,
        parakeet_available: has_external_engine_command("TALKFLOW_PARAKEET_CMD"),
        moonshine_available: has_external_engine_command("TALKFLOW_MOONSHINE_CMD"),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSttModel {
    pub id: String,
    pub name: String,
    pub description: String,
    pub speed: u8,
    pub accuracy: u8,
    pub download_url: String,
    pub file_name: String,
    pub installed: bool,
    pub active: bool,
    pub model_path: String,
}

#[derive(Debug, Clone, Copy)]
struct LocalSttCatalogEntry {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    speed: u8,
    accuracy: u8,
    file_name: &'static str,
    download_url: &'static str,
}

const LOCAL_STT_CATALOG: [LocalSttCatalogEntry; 4] = [
    LocalSttCatalogEntry {
        id: "whisper-small",
        name: "Whisper Small",
        description: "速度快，維持良好準確性，適合日常語音輸入。",
        speed: 4,
        accuracy: 3,
        file_name: "ggml-small.bin",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    },
    LocalSttCatalogEntry {
        id: "whisper-medium",
        name: "Whisper Medium",
        description: "速度與準確性平衡，長句辨識更穩定。",
        speed: 3,
        accuracy: 4,
        file_name: "ggml-medium.bin",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    },
    LocalSttCatalogEntry {
        id: "whisper-large",
        name: "Whisper Large",
        description: "準確性高，模型較大，推論較慢。",
        speed: 2,
        accuracy: 5,
        file_name: "ggml-large-v3.bin",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
    },
    LocalSttCatalogEntry {
        id: "whisper-turbo",
        name: "Whisper Turbo",
        description: "Large Turbo 版本，兼顧速度與高準確性。",
        speed: 5,
        accuracy: 4,
        file_name: "ggml-large-v3-turbo.bin",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    },
];

/// Global recording handle — only one recording at a time.
static CAPTURE: Mutex<Option<CaptureHandle>> = Mutex::new(None);

/// In-process cache so we don't read from file on every call.
static API_KEY_CACHE: Mutex<Option<String>> = Mutex::new(None);
static STT_API_KEY_CACHE: Mutex<Option<String>> = Mutex::new(None);

// ── Streaming STT state ─────────────────────────────────────────────────
use std::sync::atomic::{AtomicBool, Ordering};
static STREAMING_ACTIVE: AtomicBool = AtomicBool::new(false);
static STREAMING_STOP: AtomicBool = AtomicBool::new(false);
/// Samples drained by stop_recording that the streaming task still needs.
static STREAMING_FINAL_SAMPLES: Mutex<Option<Vec<f32>>> = Mutex::new(None);
static MODEL_DOWNLOAD_ACTIVE: AtomicBool = AtomicBool::new(false);
static MODEL_DOWNLOAD_CANCEL: AtomicBool = AtomicBool::new(false);

#[cfg(feature = "local-stt")]
struct LocalWhisperContextCache {
    model_path: String,
    context: Arc<whisper_rs::WhisperContext>,
}

/// Cache loaded whisper context so local STT doesn't reload model every request.
#[cfg(feature = "local-stt")]
static LOCAL_WHISPER_CONTEXT: Mutex<Option<LocalWhisperContextCache>> = Mutex::new(None);

fn talkflow_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let dir = home.join(".talkflow");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create .talkflow dir: {e}"))?;
    }
    Ok(dir)
}

fn has_external_engine_command(env_key: &str) -> bool {
    std::env::var(env_key)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

/// Get the path to the API key file (~/.talkflow/api_key).
fn api_key_file_path() -> Result<PathBuf, String> {
    Ok(talkflow_dir()?.join("api_key"))
}

/// Get the path to the STT API key file (~/.talkflow/stt_api_key).
fn stt_api_key_file_path() -> Result<PathBuf, String> {
    Ok(talkflow_dir()?.join("stt_api_key"))
}

fn local_models_dir() -> Result<PathBuf, String> {
    let dir = talkflow_dir()?.join("models");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create model dir: {e}"))?;
    }
    Ok(dir)
}

fn active_model_file_path() -> Result<PathBuf, String> {
    Ok(talkflow_dir()?.join("active_local_stt_model"))
}

fn catalog_entry_by_id(model_id: &str) -> Option<&'static LocalSttCatalogEntry> {
    LOCAL_STT_CATALOG.iter().find(|entry| entry.id == model_id)
}

fn model_file_path(entry: &LocalSttCatalogEntry) -> Result<PathBuf, String> {
    Ok(local_models_dir()?.join(entry.file_name))
}

fn read_active_model_id() -> Option<String> {
    let path = active_model_file_path().ok()?;
    let content = std::fs::read_to_string(path).ok()?;
    let model_id = content.trim().to_string();
    if model_id.is_empty() {
        None
    } else {
        Some(model_id)
    }
}

fn write_active_model_id(model_id: Option<&str>) -> Result<(), String> {
    let path = active_model_file_path()?;
    match model_id {
        Some(id) if !id.is_empty() => {
            std::fs::write(path, id).map_err(|e| format!("Failed to save active model: {e}"))?
        }
        _ => {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(())
}

pub fn list_local_stt_models() -> Result<Vec<LocalSttModel>, String> {
    let active_model_id = read_active_model_id();
    LOCAL_STT_CATALOG
        .iter()
        .map(|entry| {
            let path = model_file_path(entry)?;
            let installed = path.is_file();
            Ok(LocalSttModel {
                id: entry.id.to_string(),
                name: entry.name.to_string(),
                description: entry.description.to_string(),
                speed: entry.speed,
                accuracy: entry.accuracy,
                download_url: entry.download_url.to_string(),
                file_name: entry.file_name.to_string(),
                installed,
                active: installed && active_model_id.as_deref() == Some(entry.id),
                model_path: path.to_string_lossy().to_string(),
            })
        })
        .collect()
}

pub async fn install_local_stt_model(app: tauri::AppHandle, model_id: String) -> Result<LocalSttModel, String> {
    let entry = catalog_entry_by_id(&model_id)
        .ok_or_else(|| format!("Unknown local STT model id: {model_id}"))?;
    let target_path = model_file_path(entry)?;
    if !target_path.exists() {
        if MODEL_DOWNLOAD_ACTIVE.swap(true, Ordering::SeqCst) {
            return Err("Another model download is in progress".to_string());
        }
        MODEL_DOWNLOAD_CANCEL.store(false, Ordering::SeqCst);
        let client = reqwest::Client::new();
        let temp_path = target_path.with_extension("download");
        let download_result: Result<(), String> = async {
            let response = client
                .get(entry.download_url)
                .send()
                .await
                .map_err(|e| format!("Failed to download model: {e}"))?;
            let status = response.status();
            if !status.is_success() {
                return Err(format!("Download failed with status {status}"));
            }
            let total_bytes = response.content_length();
            let _ = app.emit("stt://model-download-progress", serde_json::json!({
                "modelId": model_id,
                "status": "start",
                "downloadedBytes": 0u64,
                "totalBytes": total_bytes,
                "progressPct": 0.0f64,
            }));

            let mut file = tokio::fs::File::create(&temp_path)
                .await
                .map_err(|e| format!("Failed to create model file: {e}"))?;
            let mut downloaded: u64 = 0;
            let mut stream = response.bytes_stream();

            while let Some(chunk) = stream.next().await {
                if MODEL_DOWNLOAD_CANCEL.load(Ordering::SeqCst) {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    let _ = app.emit("stt://model-download-progress", serde_json::json!({
                        "modelId": model_id,
                        "status": "cancelled",
                        "downloadedBytes": downloaded,
                        "totalBytes": total_bytes,
                        "progressPct": 0.0f64,
                    }));
                    return Err("Model download cancelled".to_string());
                }
                let bytes = chunk.map_err(|e| format!("Failed to read download chunk: {e}"))?;
                tokio::io::AsyncWriteExt::write_all(&mut file, &bytes)
                    .await
                    .map_err(|e| format!("Failed to write model file: {e}"))?;
                downloaded += bytes.len() as u64;
                let progress_pct = total_bytes
                    .map(|total| ((downloaded as f64 / total as f64) * 100.0).min(100.0))
                    .unwrap_or(0.0);
                let _ = app.emit("stt://model-download-progress", serde_json::json!({
                    "modelId": model_id,
                    "status": "downloading",
                    "downloadedBytes": downloaded,
                    "totalBytes": total_bytes,
                    "progressPct": progress_pct,
                }));
            }

            tokio::fs::rename(&temp_path, &target_path)
                .await
                .map_err(|e| format!("Failed to finalize model file: {e}"))?;
            let _ = app.emit("stt://model-download-progress", serde_json::json!({
                "modelId": model_id,
                "status": "done",
                "downloadedBytes": total_bytes.unwrap_or(downloaded),
                "totalBytes": total_bytes,
                "progressPct": 100.0f64,
            }));
            Ok(())
        }
        .await;
        MODEL_DOWNLOAD_ACTIVE.store(false, Ordering::SeqCst);
        if let Err(err) = download_result {
            let _ = app.emit("stt://model-download-progress", serde_json::json!({
                "modelId": model_id,
                "status": "error",
            }));
            return Err(err);
        }
    }

    list_local_stt_models()?
        .into_iter()
        .find(|model| model.id == model_id)
        .ok_or_else(|| "Installed model not found in catalog".to_string())
}

pub fn cancel_local_stt_download() -> bool {
    if MODEL_DOWNLOAD_ACTIVE.load(Ordering::SeqCst) {
        MODEL_DOWNLOAD_CANCEL.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

pub fn delete_local_stt_model(model_id: String) -> Result<(), String> {
    let entry = catalog_entry_by_id(&model_id)
        .ok_or_else(|| format!("Unknown local STT model id: {model_id}"))?;
    let target_path = model_file_path(entry)?;
    if target_path.exists() {
        std::fs::remove_file(&target_path).map_err(|e| format!("Failed to delete model file: {e}"))?;
    }
    if read_active_model_id().as_deref() == Some(entry.id) {
        write_active_model_id(None)?;
    }
    Ok(())
}

pub fn select_local_stt_model(model_id: String) -> Result<String, String> {
    let entry = catalog_entry_by_id(&model_id)
        .ok_or_else(|| format!("Unknown local STT model id: {model_id}"))?;
    let target_path = model_file_path(entry)?;
    if !target_path.is_file() {
        return Err("模型尚未安裝，請先安裝後再選擇。".into());
    }
    write_active_model_id(Some(entry.id))?;
    Ok(target_path.to_string_lossy().to_string())
}

const KEYRING_SERVICE: &str = "talkflow";
const KEYRING_LLM_USER: &str = "llm-api-key";
const KEYRING_STT_USER: &str = "stt-api-key";

fn keyring_set(user: &str, key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, user)
        .map_err(|e| format!("Credential store error: {e}"))?;
    entry.set_password(key)
        .map_err(|e| format!("Failed to save key to credential store: {e}"))
}

fn keyring_get(user: &str) -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, user).ok()?;
    entry.get_password().ok().filter(|k| !k.trim().is_empty())
}

fn keyring_delete(user: &str) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, user) {
        let _ = entry.delete_credential();
    }
}

/// Migrate a plaintext key file into the credential store and delete the file.
fn migrate_key_file_to_keyring(file_path: &std::path::Path, keyring_user: &str) {
    if let Ok(contents) = std::fs::read_to_string(file_path) {
        let key = contents.trim().to_string();
        if !key.is_empty() {
            if keyring_set(keyring_user, &key).is_ok() {
                let _ = std::fs::remove_file(file_path);
            }
        }
    }
}

/// Store the LLM API key in the OS credential store and update the in-process cache.
pub fn set_api_key(key: String) -> Result<(), String> {
    if key.is_empty() {
        keyring_delete(KEYRING_LLM_USER);
        // Also remove legacy file if it exists
        if let Ok(path) = api_key_file_path() {
            let _ = std::fs::remove_file(path);
        }
        let mut cache = API_KEY_CACHE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        *cache = None;
    } else {
        keyring_set(KEYRING_LLM_USER, &key)?;
        let mut cache = API_KEY_CACHE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        *cache = Some(key);
    }
    Ok(())
}

/// Check whether an API key exists (without revealing the value).
pub fn has_api_key() -> bool {
    if let Ok(guard) = API_KEY_CACHE.lock() {
        if guard.is_some() {
            return true;
        }
    }
    get_api_key().is_ok()
}

pub fn set_stt_api_key(key: String) -> Result<(), String> {
    if key.is_empty() {
        keyring_delete(KEYRING_STT_USER);
        if let Ok(path) = stt_api_key_file_path() {
            let _ = std::fs::remove_file(path);
        }
        let mut cache = STT_API_KEY_CACHE
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        *cache = None;
    } else {
        keyring_set(KEYRING_STT_USER, &key)?;
        let mut cache = STT_API_KEY_CACHE
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        *cache = Some(key);
    }
    Ok(())
}

pub fn has_stt_api_key() -> bool {
    if let Ok(guard) = STT_API_KEY_CACHE.lock() {
        if guard.is_some() {
            return true;
        }
    }
    get_stt_api_key().is_ok()
}

pub(crate) fn get_stt_api_key() -> Result<String, String> {
    if let Ok(guard) = STT_API_KEY_CACHE.lock() {
        if let Some(ref key) = *guard {
            return Ok(key.clone());
        }
    }
    // Try credential store first
    if let Some(key) = keyring_get(KEYRING_STT_USER) {
        if let Ok(mut cache) = STT_API_KEY_CACHE.lock() {
            *cache = Some(key.clone());
        }
        return Ok(key);
    }
    // Migrate from legacy plaintext file
    if let Ok(path) = stt_api_key_file_path() {
        if path.is_file() {
            migrate_key_file_to_keyring(&path, KEYRING_STT_USER);
            if let Some(key) = keyring_get(KEYRING_STT_USER) {
                if let Ok(mut cache) = STT_API_KEY_CACHE.lock() {
                    *cache = Some(key.clone());
                }
                return Ok(key);
            }
        }
    }
    Err("未設定 Whisper STT API Key。請在設定中填入 STT API Key。".to_string())
}

/// Read the LLM API key — checks in-process cache first, then credential store.
/// Migrates legacy plaintext files to the credential store on first access.
/// Never exposed to frontend.
pub(crate) fn get_api_key() -> Result<String, String> {
    // Check cache
    if let Ok(guard) = API_KEY_CACHE.lock() {
        if let Some(ref key) = *guard {
            return Ok(key.clone());
        }
    }
    // Try credential store
    if let Some(key) = keyring_get(KEYRING_LLM_USER) {
        if let Ok(mut cache) = API_KEY_CACHE.lock() {
            *cache = Some(key.clone());
        }
        return Ok(key);
    }
    // Migrate from legacy plaintext file
    if let Ok(path) = api_key_file_path() {
        if path.is_file() {
            migrate_key_file_to_keyring(&path, KEYRING_LLM_USER);
            if let Some(key) = keyring_get(KEYRING_LLM_USER) {
                if let Ok(mut cache) = API_KEY_CACHE.lock() {
                    *cache = Some(key.clone());
                }
                return Ok(key);
            }
        }
    }
    Err("未設定 OpenAI API Key。請在設定中填入 API Key。".to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct SttResult {
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SttError {
    pub message: String,
}

/// Starts microphone capture.
/// Emits `stt://start` immediately.
pub fn start_recording(app: tauri::AppHandle) -> Result<(), String> {
    {
        let guard = CAPTURE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        if guard.is_some() {
            return Err("Already recording".into());
        }
    }

    let handle = audio_capture::start()?;

    {
        let mut guard = CAPTURE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        *guard = Some(handle);
    }

    let _ = app.emit("stt://start", ());
    println!("[stt] Recording started");
    Ok(())
}

/// Start streaming partial transcription while recording.
/// Spawns a background task that periodically drains audio chunks, transcribes,
/// and emits `stt://partial` events for real-time feedback.
pub fn start_streaming_stt(
    app: tauri::AppHandle,
    engine: SttEngine,
    model_path: String,
    stt_language: String,
) -> Result<(), String> {
    if !is_recording() {
        return Err("Not recording".into());
    }
    if STREAMING_ACTIVE.load(Ordering::SeqCst) {
        return Err("Streaming already active".into());
    }

    STREAMING_STOP.store(false, Ordering::SeqCst);
    STREAMING_ACTIVE.store(true, Ordering::SeqCst);
    {
        let mut guard = STREAMING_FINAL_SAMPLES.lock().unwrap();
        *guard = None;
    }

    let api_key = if engine == SttEngine::OpenAi {
        get_stt_api_key().ok()
    } else {
        None
    };

    tauri::async_runtime::spawn(async move {
        let mut accumulated: Vec<f32> = Vec::new();
        let interval = std::time::Duration::from_millis(2000);

        loop {
            tokio::time::sleep(interval).await;

            // Check stop signal first
            if STREAMING_STOP.load(Ordering::SeqCst) {
                break;
            }

            // Drain available audio from capture
            let mut chunk = Vec::new();
            if let Ok(guard) = CAPTURE.lock() {
                if let Some(ref handle) = *guard {
                    handle.drain_samples(&mut chunk);
                }
            }
            accumulated.extend_from_slice(&chunk);

            // Transcribe accumulated audio for partial result (need >0.5s of audio)
            let min_samples = TARGET_SAMPLE_RATE as usize / 2;
            if accumulated.len() > min_samples {
                let result = match &engine {
                    SttEngine::OpenAi => {
                        transcribe_openai(api_key.as_deref().unwrap_or(""), &accumulated, &stt_language).await
                    }
                    SttEngine::LocalWhisper => {
                        transcribe_local(&model_path, &accumulated).await
                    }
                    SttEngine::Parakeet => {
                        transcribe_external_command("Parakeet", "TALKFLOW_PARAKEET_CMD", &model_path, &accumulated).await
                    }
                    SttEngine::Moonshine => {
                        transcribe_external_command("Moonshine", "TALKFLOW_MOONSHINE_CMD", &model_path, &accumulated).await
                    }
                };
                if let Ok(raw_text) = result {
                    let text = sanitize_transcript_text(&raw_text);
                    if !text.is_empty() {
                        let _ = app.emit("stt://partial", SttResult { text });
                    }
                }
            }
        }

        // ── Finalization: pick up any remaining samples from stop_recording ──
        if let Ok(mut guard) = STREAMING_FINAL_SAMPLES.lock() {
            if let Some(final_samples) = guard.take() {
                accumulated.extend_from_slice(&final_samples);
            }
        }

        if !accumulated.is_empty() {
            let stt_start = std::time::Instant::now();
            let duration_secs = accumulated.len() as f32 / TARGET_SAMPLE_RATE as f32;
            if is_effective_silence(&accumulated) {
                println!("[stt] Effective silence detected in streaming finalization; skipping transcript");
                let _ = app.emit("stt://final", SttResult {
                    text: String::new(),
                });
                STREAMING_ACTIVE.store(false, Ordering::SeqCst);
                return;
            }
            let result = match &engine {
                SttEngine::OpenAi => {
                    transcribe_openai(api_key.as_deref().unwrap_or(""), &accumulated, &stt_language).await
                }
                SttEngine::LocalWhisper => {
                    transcribe_local(&model_path, &accumulated).await
                }
                SttEngine::Parakeet => {
                    transcribe_external_command("Parakeet", "TALKFLOW_PARAKEET_CMD", &model_path, &accumulated).await
                }
                SttEngine::Moonshine => {
                    transcribe_external_command("Moonshine", "TALKFLOW_MOONSHINE_CMD", &model_path, &accumulated).await
                }
            };
            let stt_duration_ms = stt_start.elapsed().as_millis() as u64;
            match result {
                Ok(raw_text) => {
                    let text = sanitize_transcript_text(&raw_text);
                    let _ = app.emit("stt://metrics", serde_json::json!({
                        "durationMs": stt_duration_ms,
                        "audioLengthSecs": duration_secs,
                    }));
                    let _ = app.emit("stt://final", SttResult { text });
                }
                Err(e) => {
                    eprintln!("[stt] Streaming final transcription error: {e}");
                    let _ = app.emit("stt://error", SttError { message: e });
                }
            }
        } else {
            let _ = app.emit("stt://error", SttError {
                message: "No audio captured".into(),
            });
        }

        STREAMING_ACTIVE.store(false, Ordering::SeqCst);
        println!("[stt] Streaming transcription ended");
    });

    println!("[stt] Streaming partial transcription started");
    Ok(())
}

/// Stops recording, transcribes via the selected engine, and emits the transcript.
/// Returns immediately; transcription runs in the background.
pub fn stop_recording(
    app: tauri::AppHandle,
    engine: SttEngine,
    model_path: String,
    stt_language: String,
) -> Result<(), String> {
    // Always take and stop the capture handle first, so recording is guaranteed to stop
    // even if the API key is missing or other errors occur.
    let handle = {
        let mut guard = CAPTURE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        guard.take()
    };

    let h = match handle {
        Some(h) => h,
        None => return Err("Not recording".into()),
    };

    // Drain all buffered audio before stopping the stream
    let mut samples = Vec::new();
    h.drain_samples(&mut samples);
    h.stop();

    let _ = app.emit("stt://stop", ());
    println!("[stt] Recording stopped, {} samples captured", samples.len());

    // If streaming STT is active, hand off remaining samples and signal stop
    if STREAMING_ACTIVE.load(Ordering::SeqCst) {
        {
            let mut guard = STREAMING_FINAL_SAMPLES.lock().unwrap();
            *guard = Some(samples);
        }
        STREAMING_STOP.store(true, Ordering::SeqCst);
        println!("[stt] Signaled streaming task to finalize");
        return Ok(());
    }

    // ── Non-streaming path (original behavior) ──────────────────────────
    if samples.is_empty() {
        let _ = app.emit("stt://error", SttError {
            message: "No audio captured".into(),
        });
        return Ok(());
    }

    // Check API key after stopping — recording is already stopped at this point
    let api_key = if engine == SttEngine::OpenAi {
        match get_stt_api_key() {
            Ok(k) => Some(k),
            Err(e) => {
                let _ = app.emit("stt://error", SttError { message: e });
                return Ok(());
            }
        }
    } else {
        None
    };

    let duration_secs = samples.len() as f32 / TARGET_SAMPLE_RATE as f32;
    println!("[stt] Audio duration: {:.2}s", duration_secs);
    if is_effective_silence(&samples) {
        println!("[stt] Effective silence detected; skipping transcript");
        let _ = app.emit("stt://final", SttResult {
            text: String::new(),
        });
        return Ok(());
    }

    // Spawn async task to transcribe
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let stt_start = std::time::Instant::now();
        let result = match engine {
            SttEngine::OpenAi => transcribe_openai(api_key.as_deref().unwrap_or(""), &samples, &stt_language).await,
            SttEngine::LocalWhisper => transcribe_local(&model_path, &samples).await,
            SttEngine::Parakeet => {
                transcribe_external_command("Parakeet", "TALKFLOW_PARAKEET_CMD", &model_path, &samples).await
            }
            SttEngine::Moonshine => {
                transcribe_external_command("Moonshine", "TALKFLOW_MOONSHINE_CMD", &model_path, &samples).await
            }
        };
        let stt_duration_ms = stt_start.elapsed().as_millis() as u64;
        match result {
            Ok(raw_text) => {
                #[cfg(debug_assertions)]
                println!("[stt] Raw transcript: {:?}", raw_text);
                let text = sanitize_transcript_text(&raw_text);
                #[cfg(debug_assertions)]
                if text != raw_text {
                    println!("[stt] Deduped transcript: {:?}", text);
                }
                // Feature 13: emit STT duration metric
                let _ = app_clone.emit("stt://metrics", serde_json::json!({
                    "durationMs": stt_duration_ms,
                    "audioLengthSecs": duration_secs,
                }));
                let _ = app_clone.emit("stt://final", SttResult { text });
            }
            Err(e) => {
                eprintln!("[stt] Transcription error: {e}");
                let _ = app_clone.emit("stt://error", SttError { message: e });
            }
        }
    });

    Ok(())
}

/// Returns true if currently recording.
pub fn is_recording() -> bool {
    CAPTURE
        .lock()
        .map(|g| g.as_ref().map_or(false, |h| h.is_recording()))
        .unwrap_or(false)
}

/// Drain buffered audio samples into a Vec<f32>.
pub fn drain_audio() -> Vec<f32> {
    let mut out = Vec::new();
    if let Ok(guard) = CAPTURE.lock() {
        if let Some(ref handle) = *guard {
            handle.drain_samples(&mut out);
        }
    }
    out
}

/// Validate that a user-supplied model path is safe to load.
/// Must be absolute, point to an existing `.bin` file, and resolve cleanly (no `..` tricks).
fn validate_model_path(model_path: &str) -> Result<PathBuf, String> {
    if model_path.is_empty() {
        return Err("未設定本地 Whisper 模型路徑。請在設定中填入 .bin 檔路徑。".into());
    }

    let p = std::path::Path::new(model_path);

    if !p.is_absolute() {
        return Err("模型路徑必須為絕對路徑。".into());
    }

    match p.extension().and_then(|e| e.to_str()) {
        Some("bin") => {}
        _ => return Err("模型路徑必須以 .bin 結尾。".into()),
    }

    let canonical = p
        .canonicalize()
        .map_err(|e| format!("無法解析模型路徑：{e}"))?;

    if !canonical.is_file() {
        return Err("模型路徑不指向一個有效的檔案。".into());
    }

    Ok(canonical)
}

/// Transcribe audio using local whisper.cpp via whisper-rs.
/// When compiled without `--features local-stt`, returns a friendly error immediately.
async fn transcribe_local(model_path: &str, samples: &[f32]) -> Result<String, String> {
    #[cfg(not(feature = "local-stt"))]
    {
        let _ = (model_path, samples);
        return Err(
            "本地 Whisper 未編譯。請安裝 CMake + MSVC 後以 --features local-stt 重新建置。".into(),
        );
    }

    #[cfg(feature = "local-stt")]
    {
        use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

        let canonical = validate_model_path(model_path)?;
        let model_path = canonical.to_string_lossy().to_string();
        let samples: Vec<f32> = samples.to_vec();

        tokio::task::spawn_blocking(move || {
            let build_context = |path: &str| -> Result<Arc<WhisperContext>, String> {
                #[cfg(feature = "local-stt-gpu")]
                let mut context_params = WhisperContextParameters::default();
                #[cfg(not(feature = "local-stt-gpu"))]
                let context_params = WhisperContextParameters::default();
                #[cfg(feature = "local-stt-gpu")]
                {
                    context_params.use_gpu(true);
                }
                let ctx = WhisperContext::new_with_params(path, context_params)
                    .map_err(|e| format!("Failed to load model: {e}"))?;
                Ok(Arc::new(ctx))
            };

            let ctx = {
                let mut cache = LOCAL_WHISPER_CONTEXT
                    .lock()
                    .map_err(|e| format!("Local model cache lock poisoned: {e}"))?;
                if let Some(ref cached) = *cache {
                    if cached.model_path == model_path {
                        cached.context.clone()
                    } else {
                        let loaded = build_context(&model_path)?;
                        *cache = Some(LocalWhisperContextCache {
                            model_path: model_path.clone(),
                            context: loaded.clone(),
                        });
                        loaded
                    }
                } else {
                    let loaded = build_context(&model_path)?;
                    *cache = Some(LocalWhisperContextCache {
                        model_path: model_path.clone(),
                        context: loaded.clone(),
                    });
                    loaded
                }
            };

            let mut state = ctx.create_state().map_err(|e| format!("State error: {e}"))?;
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_language(Some("zh"));
            params.set_no_context(true);
            params.set_print_realtime(false);
            params.set_print_progress(false);
            let n_threads = std::thread::available_parallelism()
                .map(|n| n.get().clamp(1, 4) as i32)
                .unwrap_or(2);
            params.set_n_threads(n_threads);
            state
                .full(params, &samples)
                .map_err(|e| format!("Transcription failed: {e}"))?;

            let n = state.full_n_segments();
            let mut result = String::new();
            for i in 0..n {
                if let Some(seg) = state.get_segment(i) {
                    if let Ok(text) = seg.to_str_lossy() {
                        result.push_str(&text);
                    }
                }
            }
            Ok(result.trim().to_string())
        })
        .await
        .map_err(|e| format!("Blocking task panicked: {e}"))?
    }
}

fn normalize_template_path(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Validate that a path contains no shell metacharacters that could enable injection.
/// Allows: alphanumeric, '.', '/', '\', '-', '_', ':', ' ' (spaces are safe when quoted).
fn validate_shell_safe_path(value: &str, field_name: &str) -> Result<(), String> {
    if value.chars().any(|c| matches!(c, '&' | '|' | ';' | '`' | '$' | '!' | '"' | '\'' | '<' | '>' | '(' | ')' | '{' | '}' | '\n' | '\r')) {
        return Err(format!("{field_name} 包含不安全的字元，請移除特殊符號。"));
    }
    Ok(())
}

async fn transcribe_external_command(
    engine_name: &str,
    env_key: &str,
    model_path: &str,
    samples: &[f32],
) -> Result<String, String> {
    let template = std::env::var(env_key).map_err(|_| {
        format!(
            "{engine_name} 引擎尚未設定。請先設定環境變數 {env_key}，例如：python run_{engine_name}.py --audio {{audio_quoted}}"
        )
    })?;
    if template.trim().is_empty() {
        return Err(format!("{engine_name} 指令為空，請重新設定 {env_key}。"));
    }

    // Validate model_path before interpolation to prevent shell injection.
    let model_raw = model_path.trim().to_string();
    if !model_raw.is_empty() {
        validate_shell_safe_path(&model_raw, "模型路徑")?;
    }

    let temp_dir = talkflow_dir()?.join("temp");
    if !temp_dir.exists() {
        std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let wav_path = temp_dir.join(format!("{}_{}.wav", engine_name.to_lowercase(), ts));
    let wav_data = encode_wav(samples);
    std::fs::write(&wav_path, wav_data).map_err(|e| format!("Failed to write temp wav: {e}"))?;

    let audio_raw = normalize_template_path(&wav_path);
    // Validate audio path too (it's generated by us, but defense in depth).
    validate_shell_safe_path(&audio_raw, "音訊路徑")?;

    let audio_quoted = format!("\"{audio_raw}\"");
    let model_quoted = if model_raw.is_empty() {
        String::new()
    } else {
        format!("\"{}\"", model_raw.replace('\\', "/"))
    };
    let cmdline = template
        .replace("{audio_quoted}", &audio_quoted)
        .replace("{audio}", &audio_raw)
        .replace("{model_quoted}", &model_quoted)
        .replace("{model}", &model_raw);

    let output = tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd").args(["/C", &cmdline]).output()
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::process::Command::new("sh").args(["-lc", &cmdline]).output()
        }
    })
    .await
    .map_err(|e| format!("{engine_name} command panicked: {e}"))?
    .map_err(|e| format!("{engine_name} command failed: {e}"))?;

    let _ = std::fs::remove_file(&wav_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("{engine_name} command exited with status {}", output.status)
        } else {
            format!("{engine_name} command error: {stderr}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Err(format!("{engine_name} command returned empty transcript."));
    }
    Ok(stdout)
}

/// Detect and remove Whisper hallucination where short text is repeated.
///
/// Handles patterns like:
///   "12341234"     → "1234"       (exact repeat)
///   "1234 1234"    → "1234"       (space-separated repeat)
///   "1234，1234"   → "1234"       (punctuation-separated repeat)
///   "1234。1234。" → "1234"       (trailing punctuation)
fn deduplicate_transcript(text: &str) -> String {
    // Strip trailing punctuation/whitespace for comparison
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // Normalize: remove common Chinese/English punctuation and whitespace for comparison
    let strip_punct = |s: &str| -> String {
        s.chars()
            .filter(|c| !c.is_whitespace() && !"，。、！？,.!?;；：:".contains(*c))
            .collect()
    };

    let clean = strip_punct(trimmed);
    let clean_chars: Vec<char> = clean.chars().collect();
    let len = clean_chars.len();

    if len < 2 {
        return trimmed.to_string();
    }

    // Check if the cleaned string is the same substring repeated 2+ times
    // Try divisors from len/2 down to 1
    for sub_len in (1..=len / 2).rev() {
        if len % sub_len != 0 {
            continue;
        }
        let repeat_count = len / sub_len;
        if repeat_count < 2 {
            continue;
        }
        let pattern: String = clean_chars[..sub_len].iter().collect();
        let mut all_match = true;
        for i in 1..repeat_count {
            let chunk: String = clean_chars[i * sub_len..(i + 1) * sub_len].iter().collect();
            if chunk != pattern {
                all_match = false;
                break;
            }
        }
        if all_match && repeat_count >= 2 {
            // Found a repeated pattern — return just the first occurrence
            // Use the original text to preserve formatting up to the first occurrence
            // Find where the first occurrence ends in the original text
            let pattern_chars: Vec<char> = pattern.chars().collect();
            let orig_chars: Vec<char> = trimmed.chars().collect();
            let mut matched = 0;
            let mut end_idx = 0;
            for (i, &c) in orig_chars.iter().enumerate() {
                if c.is_whitespace() || "，。、！？,.!?;；：:".contains(c) {
                    continue;
                }
                if c == pattern_chars[matched] {
                    matched += 1;
                    if matched == pattern_chars.len() {
                        end_idx = i + 1;
                        break;
                    }
                }
            }
            if end_idx > 0 {
                let result: String = orig_chars[..end_idx].iter().collect();
                // Trim trailing punctuation from the extracted portion
                return result.trim_end_matches(|c: char| {
                    c.is_whitespace() || "，。、！？,.!?;；：:".contains(c)
                }).to_string();
            }
            return pattern;
        }
    }

    trimmed.to_string()
}

fn estimate_audio_levels(samples: &[f32]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let mut sum_sq = 0.0f64;
    let mut peak = 0.0f32;
    for sample in samples {
        let amp = sample.abs();
        sum_sq += (amp as f64) * (amp as f64);
        if amp > peak {
            peak = amp;
        }
    }
    let rms = (sum_sq / samples.len() as f64).sqrt() as f32;
    (rms, peak)
}

fn is_effective_silence(samples: &[f32]) -> bool {
    if samples.is_empty() {
        return true;
    }
    let (rms, peak) = estimate_audio_levels(samples);
    rms < 0.006 && peak < 0.03
}

fn sanitize_transcript_text(text: &str) -> String {
    let deduped = deduplicate_transcript(text);
    let trimmed = deduped.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let normalized = trimmed
        .trim_matches(|c: char| {
            c == '[' || c == ']' || c == '(' || c == ')' || c.is_whitespace()
        })
        .trim();
    if normalized.is_empty() {
        return String::new();
    }

    if normalized.contains("字幕製作")
        || normalized.contains("字幕组")
        || normalized.contains("CC字幕")
    {
        return String::new();
    }

    if (trimmed.starts_with('[') || trimmed.starts_with('('))
        && normalized.chars().count() <= 16
        && normalized.contains("拜拜")
    {
        return String::new();
    }

    normalized.to_string()
}

/// Encode f32 PCM samples as a WAV file in memory (16kHz mono 16-bit).
fn encode_wav(samples: &[f32]) -> Vec<u8> {
    let num_samples = samples.len();
    let bits_per_sample: u16 = 16;
    let num_channels: u16 = 1;
    let sample_rate: u32 = TARGET_SAMPLE_RATE;
    let byte_rate = sample_rate * (num_channels as u32) * (bits_per_sample as u32 / 8);
    let block_align = num_channels * (bits_per_sample / 8);
    let data_size = (num_samples * 2) as u32;
    let file_size = 36 + data_size;

    let mut buf = Vec::with_capacity(44 + data_size as usize);

    // RIFF header
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&file_size.to_le_bytes());
    buf.extend_from_slice(b"WAVE");

    // fmt chunk
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes()); // chunk size
    buf.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    buf.extend_from_slice(&num_channels.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data chunk
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_size.to_le_bytes());

    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let i16_val = (clamped * i16::MAX as f32) as i16;
        buf.extend_from_slice(&i16_val.to_le_bytes());
    }

    buf
}

/// Call OpenAI Whisper API to transcribe audio samples.
fn normalize_stt_language(language: &str) -> Option<&'static str> {
    match language.trim().to_lowercase().as_str() {
        "" | "auto" => None,
        "zh" | "zh-tw" | "zh-cn" => Some("zh"),
        "en" | "en-us" | "en-gb" => Some("en"),
        "ja" | "ja-jp" => Some("ja"),
        "ko" | "ko-kr" => Some("ko"),
        "de" | "de-de" => Some("de"),
        "fr" | "fr-fr" => Some("fr"),
        "es" | "es-es" => Some("es"),
        "ru" | "ru-ru" => Some("ru"),
        "ar" | "ar-sa" => Some("ar"),
        _ => None,
    }
}

/// Call OpenAI Whisper API to transcribe audio samples.
async fn transcribe_openai(api_key: &str, samples: &[f32], stt_language: &str) -> Result<String, String> {
    let wav_data = encode_wav(samples);

    println!("[stt] Sending {} bytes of WAV to OpenAI Whisper API", wav_data.len());

    let part = reqwest::multipart::Part::bytes(wav_data)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Failed to create multipart: {e}"))?;

    let mut form = reqwest::multipart::Form::new()
        .text("model", "whisper-1")
        .text("response_format", "verbose_json")
        .text("temperature", "0")
        .part("file", part);
    if let Some(language) = normalize_stt_language(stt_language) {
        form = form.text("language", language.to_string());
    }

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {api_key}"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Whisper API request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    if !status.is_success() {
        return Err(format!("Whisper API error ({}): {}", status, body));
    }

    #[cfg(debug_assertions)]
    println!("[stt] Whisper API raw response: {}", &body[..body.len().min(500)]);

    // Parse verbose_json format: { "text": "...", "segments": [...] }
    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))?;

    // Try to use segments to filter out hallucinated repeats.
    // Whisper marks hallucinated segments with high compression_ratio (>2.4)
    // or very high no_speech_prob (>0.6).
    if let Some(segments) = parsed["segments"].as_array() {
        let mut result = String::new();
        for seg in segments {
            let compression = seg["compression_ratio"].as_f64().unwrap_or(0.0);
            let no_speech = seg["no_speech_prob"].as_f64().unwrap_or(0.0);
            let seg_text = seg["text"].as_str().unwrap_or("");

            #[cfg(debug_assertions)]
            println!(
                "[stt] Segment: {:?} (compression={:.2}, no_speech={:.2})",
                seg_text, compression, no_speech
            );

            // Skip segments that look hallucinated
            if compression > 2.4 || no_speech > 0.6 {
                #[cfg(debug_assertions)]
                println!("[stt] Skipping hallucinated segment");
                continue;
            }
            result.push_str(seg_text);
        }
        if !result.is_empty() {
            return Ok(result.trim().to_string());
        }
    }

    // Fallback: use the top-level text field
    parsed["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Unexpected response format: {body}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dedup_exact_repeat() {
        assert_eq!(deduplicate_transcript("12341234"), "1234");
    }

    #[test]
    fn test_dedup_with_space() {
        assert_eq!(deduplicate_transcript("1234 1234"), "1234");
    }

    #[test]
    fn test_dedup_chinese() {
        assert_eq!(deduplicate_transcript("你好你好"), "你好");
    }

    #[test]
    fn test_dedup_with_punctuation() {
        assert_eq!(deduplicate_transcript("1234，1234"), "1234");
    }

    #[test]
    fn test_dedup_trailing_period() {
        assert_eq!(deduplicate_transcript("1234。1234。"), "1234");
    }

    #[test]
    fn test_dedup_triple_repeat() {
        assert_eq!(deduplicate_transcript("abcabcabc"), "abc");
    }

    #[test]
    fn test_dedup_no_repeat() {
        assert_eq!(deduplicate_transcript("hello world"), "hello world");
    }

    #[test]
    fn test_dedup_single_char() {
        assert_eq!(deduplicate_transcript("a"), "a");
    }

    #[test]
    fn test_dedup_empty() {
        assert_eq!(deduplicate_transcript(""), "");
    }

    #[test]
    fn test_dedup_chinese_sentence() {
        assert_eq!(
            deduplicate_transcript("今天天氣很好今天天氣很好"),
            "今天天氣很好"
        );
    }

    #[test]
    fn test_sanitize_subtitle_hallucination() {
        assert_eq!(sanitize_transcript_text("[(字幕製作:貝爾)]"), "");
    }

    #[test]
    fn test_sanitize_bracket_bye_hallucination() {
        assert_eq!(sanitize_transcript_text("[拜拜~]"), "");
    }

    #[test]
    fn test_effective_silence_detection() {
        let samples = vec![0.0001f32; 16000];
        assert!(is_effective_silence(&samples));
    }
}
