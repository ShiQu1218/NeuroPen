//! Speech-to-Text engines using OpenAI transcription and local models.
//!
//! Phase 2 implementation:
//! - Open microphone via `cpal` (audio_capture module)
//! - On stop, transcribe the buffered audio once
//! - Emit Tauri events:
//!     `stt://start`         — recording began
//!     `stt://final`         — final transcript ready
//!     `stt://stop`          — recording ended
//!     `stt://error`         — transcription failed

use crate::audio_capture::{self, CaptureHandle, TARGET_SAMPLE_RATE};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::Emitter;

mod api_keys;
mod models;
mod moonshine;
mod sensevoice;

/// Which STT backend to use.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SttEngine {
    OpenAi,
    #[serde(alias = "local")]
    LocalWhisper,
    SenseVoice,
    Moonshine,
    Parakeet,
}

/// Runtime capabilities — which engines are compiled in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttCapabilities {
    pub openai_available: bool,
    pub local_available: bool,
    pub sensevoice_available: bool,
    pub moonshine_available: bool,
    pub parakeet_available: bool,
}

pub fn get_capabilities() -> SttCapabilities {
    SttCapabilities {
        openai_available: true,
        local_available: true,
        sensevoice_available: true,
        moonshine_available: true,
        parakeet_available: has_external_engine_command("NEUROPEN_PARAKEET_CMD"),
    }
}

pub use models::LocalSttModel;

/// Global recording handle — only one recording at a time.
static CAPTURE: Mutex<Option<CaptureHandle>> = Mutex::new(None);

// ── Streaming STT state ─────────────────────────────────────────────────
use std::sync::atomic::{AtomicBool, Ordering};
static STREAMING_ACTIVE: AtomicBool = AtomicBool::new(false);
static STREAMING_STOP: AtomicBool = AtomicBool::new(false);
/// Samples drained by stop_recording that the streaming task still needs.
static STREAMING_FINAL_SAMPLES: Mutex<Option<Vec<f32>>> = Mutex::new(None);
/// A transcription owns the capture lifecycle until its final event has been emitted.
/// This prevents a new recording from reusing global streaming buffers while the
/// previous session is still finalizing.
static TRANSCRIPTION_ACTIVE: AtomicBool = AtomicBool::new(false);
static MODEL_DOWNLOAD_ACTIVE: AtomicBool = AtomicBool::new(false);
static MODEL_DOWNLOAD_CANCEL: AtomicBool = AtomicBool::new(false);

struct StreamingSessionGuard;

impl Drop for StreamingSessionGuard {
    fn drop(&mut self) {
        release_streaming_session();
    }
}

struct TranscriptionGuard;

impl Drop for TranscriptionGuard {
    fn drop(&mut self) {
        TRANSCRIPTION_ACTIVE.store(false, Ordering::SeqCst);
    }
}

fn claim_streaming_session(
    streaming_active: &AtomicBool,
    transcription_active: &AtomicBool,
) -> Result<(), &'static str> {
    streaming_active
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "Streaming already active")?;

    if transcription_active
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        streaming_active.store(false, Ordering::SeqCst);
        return Err("Previous transcription is still processing");
    }

    Ok(())
}

fn claim_non_streaming_transcription(transcription_active: &AtomicBool) -> bool {
    transcription_active
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
}

fn release_streaming_session() {
    if let Ok(mut final_samples) = STREAMING_FINAL_SAMPLES.lock() {
        *final_samples = None;
    }
    STREAMING_STOP.store(false, Ordering::SeqCst);
    STREAMING_ACTIVE.store(false, Ordering::SeqCst);
    TRANSCRIPTION_ACTIVE.store(false, Ordering::SeqCst);
}

struct LocalWhisperContextCache {
    model_path: String,
    context: Arc<whisper_rs::WhisperContext>,
}

/// Cache loaded whisper context so local STT doesn't reload model every request.
static LOCAL_WHISPER_CONTEXT: Mutex<Option<LocalWhisperContextCache>> = Mutex::new(None);

fn neuropen_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let dir = home.join(".neuropen");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create .neuropen dir: {e}"))?;
    }
    Ok(dir)
}

fn has_external_engine_command(env_key: &str) -> bool {
    std::env::var(env_key)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

pub fn list_local_stt_models() -> Result<Vec<LocalSttModel>, String> {
    models::list_local_stt_models()
}

pub async fn install_local_stt_model(
    app: tauri::AppHandle,
    model_id: String,
) -> Result<LocalSttModel, String> {
    let entry = models::catalog_entry_by_id(&model_id)
        .ok_or_else(|| format!("Unknown local STT model id: {model_id}"))?;
    let install_artifacts = models::install_artifacts(entry)?;
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
                "stt://model-download-progress",
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
                        .map_err(|e| format!("Failed to create model directory: {e}"))?;
                }

                let response = client
                    .get(artifact.download_url)
                    .send()
                    .await
                    .map_err(|e| format!("Failed to download model artifact: {e}"))?;
                let status = response.status();
                if !status.is_success() {
                    return Err(format!("Download failed with status {status}"));
                }

                total_bytes = match (total_bytes, response.content_length()) {
                    (Some(total), Some(content_len)) => Some(total + content_len),
                    (Some(total), None) => Some(total),
                    (None, Some(content_len)) => Some(downloaded + content_len),
                    (None, None) => None,
                };

                let file_name = artifact
                    .path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("artifact");
                let temp_path = artifact
                    .path
                    .with_file_name(format!("{file_name}.download"));
                let mut file = tokio::fs::File::create(&temp_path)
                    .await
                    .map_err(|e| format!("Failed to create model file: {e}"))?;
                let mut stream = response.bytes_stream();

                while let Some(chunk) = stream.next().await {
                    if MODEL_DOWNLOAD_CANCEL.load(Ordering::SeqCst) {
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        let _ = app.emit(
                            "stt://model-download-progress",
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
                    let bytes = chunk.map_err(|e| format!("Failed to read download chunk: {e}"))?;
                    tokio::io::AsyncWriteExt::write_all(&mut file, &bytes)
                        .await
                        .map_err(|e| format!("Failed to write model file: {e}"))?;
                    downloaded += bytes.len() as u64;
                    let progress_pct = total_bytes
                        .filter(|total| *total > 0)
                        .map(|total| ((downloaded as f64 / total as f64) * 100.0).min(100.0))
                        .unwrap_or(0.0);
                    let _ = app.emit(
                        "stt://model-download-progress",
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
                    .map_err(|e| format!("Failed to finalize model file: {e}"))?;
            }

            let _ = app.emit(
                "stt://model-download-progress",
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
                "stt://model-download-progress",
                serde_json::json!({
                    "modelId": model_id,
                    "status": "error",
                }),
            );
            return Err(err);
        }
    }

    models::list_local_stt_models()?
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
    models::delete_local_stt_model(model_id)
}

pub fn select_local_stt_model(model_id: String) -> Result<String, String> {
    models::select_local_stt_model(model_id)
}

pub fn set_api_key(key: String) -> Result<(), String> {
    api_keys::set_api_key(key)
}

pub fn has_api_key() -> bool {
    api_keys::has_api_key()
}

pub fn set_stt_api_key(key: String) -> Result<(), String> {
    api_keys::set_stt_api_key(key)
}

pub fn has_stt_api_key() -> bool {
    api_keys::has_stt_api_key()
}

pub(crate) fn get_stt_api_key() -> Result<String, String> {
    api_keys::get_stt_api_key()
}

pub(crate) fn get_api_key() -> Result<String, String> {
    api_keys::get_api_key()
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
    if TRANSCRIPTION_ACTIVE.load(Ordering::SeqCst) || STREAMING_ACTIVE.load(Ordering::SeqCst) {
        return Err("Previous transcription is still processing".into());
    }

    // Keep the check and assignment under one lock so concurrent command calls
    // cannot create two captures and overwrite the first handle.
    {
        let mut guard = CAPTURE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        // Recheck after acquiring the capture lock. A previous recording may
        // have claimed its final-transcription lease while this call waited.
        if TRANSCRIPTION_ACTIVE.load(Ordering::SeqCst) || STREAMING_ACTIVE.load(Ordering::SeqCst) {
            return Err("Previous transcription is still processing".into());
        }
        if guard.is_some() {
            return Err("Already recording".into());
        }
        *guard = Some(audio_capture::start()?);
    }

    let _ = app.emit("stt://start", ());
    println!("[stt] Recording started");
    Ok(())
}

/// Discard a buffered recording without transcribing or sending its audio.
pub fn cancel_recording(app: tauri::AppHandle) -> Result<(), String> {
    let mut guard = CAPTURE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    // Streaming has already submitted chunks; this command only discards audio
    // captured by the buffered recording workflow used by the main window.
    if STREAMING_ACTIVE.load(Ordering::SeqCst) {
        return Err("Cannot discard a streaming transcription".into());
    }
    if let Some(handle) = guard.take() {
        handle.stop();
        let _ = app.emit("stt://stop", ());
    }
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
    {
        // Keep capture validation, lease acquisition, and buffer initialization
        // together. Otherwise stop_recording can remove CAPTURE after validation
        // but before STREAMING_ACTIVE is claimed.
        let guard = CAPTURE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        if !guard.as_ref().is_some_and(CaptureHandle::is_recording) {
            return Err("Not recording".into());
        }

        claim_streaming_session(&STREAMING_ACTIVE, &TRANSCRIPTION_ACTIVE)
            .map_err(str::to_string)?;
        STREAMING_STOP.store(false, Ordering::SeqCst);
        if let Err(error) = STREAMING_FINAL_SAMPLES
            .lock()
            .map(|mut final_samples| *final_samples = None)
        {
            release_streaming_session();
            return Err(format!("Streaming buffer lock poisoned: {error}"));
        }
    }

    let api_key = if engine == SttEngine::OpenAi {
        get_stt_api_key().ok()
    } else {
        None
    };

    tauri::async_runtime::spawn(async move {
        let _session_guard = StreamingSessionGuard;
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
                let result = transcribe_by_engine(
                    &engine,
                    api_key.as_deref(),
                    &model_path,
                    &accumulated,
                    &stt_language,
                )
                .await;
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
                let _ = app.emit(
                    "stt://final",
                    SttResult {
                        text: String::new(),
                    },
                );
                return;
            }
            let result = transcribe_by_engine(
                &engine,
                api_key.as_deref(),
                &model_path,
                &accumulated,
                &stt_language,
            )
            .await;
            let stt_duration_ms = stt_start.elapsed().as_millis() as u64;
            match result {
                Ok(raw_text) => {
                    let text = sanitize_transcript_text(&raw_text);
                    let _ = app.emit(
                        "stt://metrics",
                        serde_json::json!({
                            "durationMs": stt_duration_ms,
                            "audioLengthSecs": duration_secs,
                        }),
                    );
                    let _ = app.emit("stt://final", SttResult { text });
                }
                Err(e) => {
                    eprintln!("[stt] Streaming final transcription error: {e}");
                    let _ = app.emit("stt://error", SttError { message: e });
                }
            }
        } else {
            let _ = app.emit(
                "stt://error",
                SttError {
                    message: "No audio captured".into(),
                },
            );
        }

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
    let stop_plan = {
        let mut guard = CAPTURE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        let handle = guard.take().ok_or("Not recording")?;
        if STREAMING_ACTIVE.load(Ordering::SeqCst) {
            Ok((handle, true, None))
        } else if claim_non_streaming_transcription(&TRANSCRIPTION_ACTIVE) {
            // Claim before releasing CAPTURE so a new recording cannot begin
            // between taking this handle and owning its final transcript.
            Ok((handle, false, Some(TranscriptionGuard)))
        } else {
            Err(handle)
        }
    };

    let (h, streaming_active, non_streaming_lease) = match stop_plan {
        Ok(plan) => plan,
        Err(handle) => {
            handle.stop();
            return Err("Previous transcription is still processing".into());
        }
    };

    // Drain all buffered audio before stopping the stream
    let mut samples = Vec::new();
    h.drain_samples(&mut samples);
    h.stop();

    let _ = app.emit("stt://stop", ());
    println!(
        "[stt] Recording stopped, {} samples captured",
        samples.len()
    );

    // If streaming STT is active, hand off remaining samples and signal stop
    if streaming_active {
        if let Err(error) = STREAMING_FINAL_SAMPLES
            .lock()
            .map(|mut guard| *guard = Some(samples))
        {
            // The streaming task must still be allowed to release its lease.
            STREAMING_STOP.store(true, Ordering::SeqCst);
            return Err(format!("Streaming buffer lock poisoned: {error}"));
        }
        STREAMING_STOP.store(true, Ordering::SeqCst);
        println!("[stt] Signaled streaming task to finalize");
        return Ok(());
    }

    // ── Non-streaming path (original behavior) ──────────────────────────
    if samples.is_empty() {
        let _ = app.emit(
            "stt://error",
            SttError {
                message: "No audio captured".into(),
            },
        );
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
        let _ = app.emit(
            "stt://final",
            SttResult {
                text: String::new(),
            },
        );
        return Ok(());
    }

    // Spawn async task to transcribe
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let _transcription_guard = non_streaming_lease;
        let stt_start = std::time::Instant::now();
        let result = transcribe_by_engine(
            &engine,
            api_key.as_deref(),
            &model_path,
            &samples,
            &stt_language,
        )
        .await;
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
                let _ = app_clone.emit(
                    "stt://metrics",
                    serde_json::json!({
                        "durationMs": stt_duration_ms,
                        "audioLengthSecs": duration_secs,
                    }),
                );
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

/// Validate that a user-supplied model path is safe to load.
/// Must be absolute, point to an existing file or directory, and resolve cleanly (no `..` tricks).
fn validate_model_path(model_path: &str) -> Result<PathBuf, String> {
    if model_path.is_empty() {
        return Err("未設定本地模型路徑。請在設定中填入模型檔路徑。".into());
    }

    let p = std::path::Path::new(model_path);

    if !p.is_absolute() {
        return Err("模型路徑必須為絕對路徑。".into());
    }

    let canonical = p
        .canonicalize()
        .map_err(|e| format!("無法解析模型路徑：{e}"))?;

    if !canonical.exists() {
        return Err("模型路徑不存在。".into());
    }

    Ok(canonical)
}

/// Central routing for all STT engines.
async fn transcribe_by_engine(
    engine: &SttEngine,
    api_key: Option<&str>,
    model_path: &str,
    samples: &[f32],
    stt_language: &str,
) -> Result<String, String> {
    match engine {
        SttEngine::OpenAi => {
            transcribe_openai(api_key.unwrap_or(""), model_path, samples, stt_language).await
        }
        SttEngine::LocalWhisper => transcribe_local(model_path, samples, stt_language).await,
        SttEngine::SenseVoice => sensevoice::transcribe(model_path, samples, stt_language).await,
        SttEngine::Moonshine => moonshine::transcribe(model_path, samples).await,
        SttEngine::Parakeet => {
            transcribe_external_command("Parakeet", "NEUROPEN_PARAKEET_CMD", model_path, samples)
                .await
        }
    }
}

/// Transcribe audio using local whisper.cpp via whisper-rs.
async fn transcribe_local(
    model_path: &str,
    samples: &[f32],
    stt_language: &str,
) -> Result<String, String> {
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    let canonical = validate_model_path(model_path)?;
    match canonical.extension().and_then(|ext| ext.to_str()) {
        Some("bin") => {}
        _ => return Err("Whisper 模型路徑必須指向 .bin 檔案。".into()),
    }
    let model_path = canonical.to_string_lossy().to_string();
    let samples: Vec<f32> = samples.to_vec();
    let stt_language = stt_language.to_string();

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

        let mut state = ctx
            .create_state()
            .map_err(|e| format!("State error: {e}"))?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        // Force transcription mode (never auto-translate to English).
        params.set_translate(false);
        params.set_language(normalize_stt_language(&stt_language));
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

fn normalize_template_path(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Validate that a path contains no shell metacharacters that could enable injection.
/// Allows: alphanumeric, '.', '/', '\', '-', '_', ':', ' ' (spaces are safe when quoted).
fn validate_shell_safe_path(value: &str, field_name: &str) -> Result<(), String> {
    if value.chars().any(|c| {
        matches!(
            c,
            '&' | '|'
                | ';'
                | '`'
                | '$'
                | '!'
                | '"'
                | '\''
                | '<'
                | '>'
                | '('
                | ')'
                | '{'
                | '}'
                | '\n'
                | '\r'
        )
    }) {
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

    let temp_dir = neuropen_dir()?.join("temp");
    if !temp_dir.exists() {
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to create temp dir: {e}"))?;
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
            std::process::Command::new("cmd")
                .args(["/C", &cmdline])
                .output()
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::process::Command::new("sh")
                .args(["-lc", &cmdline])
                .output()
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

/// Preserve the model transcript verbatim apart from outer whitespace.
///
/// Repetition alone is not evidence of a hallucination: it is common in natural
/// speech (for example `謝謝`, `拜拜`, and deliberate repeated phrases). The API
/// path already filters segments using model confidence, which is a safer signal
/// than deleting text based only on its characters.
fn deduplicate_transcript(text: &str) -> String {
    text.trim().to_string()
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
    rms < 0.0025 && peak < 0.015
}

fn sanitize_transcript_text(text: &str) -> String {
    let deduped = deduplicate_transcript(text);
    let trimmed = deduped.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let normalized = trimmed
        .trim_matches(|c: char| c == '[' || c == ']' || c == '(' || c == ')' || c.is_whitespace())
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

const DEFAULT_OPENAI_STT_MODEL: &str = "gpt-transcribe";
const OPENAI_MINI_STT_MODEL: &str = "gpt-4o-mini-transcribe";

fn normalize_openai_stt_model(model: &str) -> Result<&'static str, String> {
    match model.trim() {
        "" | "openai-whisper-api" | "whisper-1" => Ok(DEFAULT_OPENAI_STT_MODEL),
        DEFAULT_OPENAI_STT_MODEL => Ok(DEFAULT_OPENAI_STT_MODEL),
        OPENAI_MINI_STT_MODEL => Ok(OPENAI_MINI_STT_MODEL),
        unsupported => Err(format!("Unsupported OpenAI STT model: {unsupported}")),
    }
}

fn openai_language_field(model: &str) -> &'static str {
    if model == DEFAULT_OPENAI_STT_MODEL {
        "languages[]"
    } else {
        "language"
    }
}

fn parse_openai_transcription_response(body: &str) -> Result<String, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("Failed to parse response: {e}"))?;
    parsed["text"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| format!("Unexpected response format: {body}"))
}

/// Call the OpenAI transcription API for one final transcript.
async fn transcribe_openai(
    api_key: &str,
    model: &str,
    samples: &[f32],
    stt_language: &str,
) -> Result<String, String> {
    let model = normalize_openai_stt_model(model)?;
    let wav_data = encode_wav(samples);

    println!(
        "[stt] Sending {} bytes of WAV to OpenAI transcription model {}",
        wav_data.len(),
        model
    );

    let part = reqwest::multipart::Part::bytes(wav_data)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Failed to create multipart: {e}"))?;

    let mut form = reqwest::multipart::Form::new()
        .text("model", model.to_string())
        .part("file", part);
    if let Some(language) = normalize_stt_language(stt_language) {
        form = form.text(openai_language_field(model), language.to_string());
    }

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {api_key}"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("OpenAI transcription request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    if !status.is_success() {
        return Err(format!("OpenAI transcription error ({}): {}", status, body));
    }

    #[cfg(debug_assertions)]
    println!(
        "[stt] OpenAI transcription raw response: {}",
        &body[..body.len().min(500)]
    );

    parse_openai_transcription_response(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dedup_exact_repeat() {
        assert_eq!(deduplicate_transcript("12341234"), "12341234");
    }

    #[test]
    fn test_dedup_with_space() {
        assert_eq!(deduplicate_transcript("1234 1234"), "1234 1234");
    }

    #[test]
    fn test_dedup_chinese() {
        assert_eq!(deduplicate_transcript("你好你好"), "你好你好");
    }

    #[test]
    fn test_dedup_with_punctuation() {
        assert_eq!(deduplicate_transcript("1234，1234"), "1234，1234");
    }

    #[test]
    fn test_dedup_trailing_period() {
        assert_eq!(deduplicate_transcript("1234。1234。"), "1234。1234。");
    }

    #[test]
    fn test_dedup_triple_repeat() {
        assert_eq!(deduplicate_transcript("abcabcabc"), "abcabcabc");
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
            deduplicate_transcript("今天天氣很好，今天天氣很好"),
            "今天天氣很好，今天天氣很好"
        );
    }

    #[test]
    fn test_dedup_preserves_short_repeated_words() {
        assert_eq!(deduplicate_transcript("謝謝 謝謝"), "謝謝 謝謝");
        assert_eq!(deduplicate_transcript("拜拜"), "拜拜");
    }

    #[test]
    fn streaming_claim_is_exclusive_until_released() {
        let streaming = AtomicBool::new(false);
        let processing = AtomicBool::new(false);

        assert!(claim_streaming_session(&streaming, &processing).is_ok());
        assert!(claim_streaming_session(&streaming, &processing).is_err());

        streaming.store(false, Ordering::SeqCst);
        processing.store(false, Ordering::SeqCst);
        assert!(claim_streaming_session(&streaming, &processing).is_ok());
    }

    #[test]
    fn streaming_claim_rolls_back_when_another_transcription_is_active() {
        let streaming = AtomicBool::new(false);
        let processing = AtomicBool::new(true);

        assert_eq!(
            claim_streaming_session(&streaming, &processing),
            Err("Previous transcription is still processing")
        );
        assert!(!streaming.load(Ordering::SeqCst));
    }

    #[test]
    fn non_streaming_claim_is_exclusive_until_finalization() {
        let processing = AtomicBool::new(false);

        assert!(claim_non_streaming_transcription(&processing));
        assert!(!claim_non_streaming_transcription(&processing));

        processing.store(false, Ordering::SeqCst);
        assert!(claim_non_streaming_transcription(&processing));
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

    #[test]
    fn test_quiet_speech_like_audio_is_not_silence() {
        let samples = vec![0.02f32; 16000];
        assert!(!is_effective_silence(&samples));
    }

    #[test]
    fn openai_stt_legacy_models_upgrade_to_default() {
        for model in ["", "openai-whisper-api", "whisper-1"] {
            assert_eq!(
                normalize_openai_stt_model(model).unwrap(),
                DEFAULT_OPENAI_STT_MODEL
            );
        }
    }

    #[test]
    fn openai_stt_models_are_allowlisted() {
        assert_eq!(
            normalize_openai_stt_model(DEFAULT_OPENAI_STT_MODEL).unwrap(),
            DEFAULT_OPENAI_STT_MODEL
        );
        assert_eq!(
            normalize_openai_stt_model(OPENAI_MINI_STT_MODEL).unwrap(),
            OPENAI_MINI_STT_MODEL
        );
        assert!(normalize_openai_stt_model("unknown-model").is_err());
    }

    #[test]
    fn openai_stt_language_field_matches_model_contract() {
        assert_eq!(
            openai_language_field(DEFAULT_OPENAI_STT_MODEL),
            "languages[]"
        );
        assert_eq!(openai_language_field(OPENAI_MINI_STT_MODEL), "language");
    }

    #[test]
    fn parses_openai_stt_json_response() {
        let body = r#"{"text":"測試文字","languages":["zh"]}"#;
        assert_eq!(
            parse_openai_transcription_response(body).unwrap(),
            "測試文字"
        );
    }

    #[test]
    fn rejects_openai_stt_response_without_text() {
        let error = parse_openai_transcription_response(r#"{"languages":["zh"]}"#)
            .expect_err("missing text should fail");
        assert!(error.contains("Unexpected response format"));
    }
}
