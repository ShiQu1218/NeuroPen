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
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;

/// Which STT backend to use.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SttEngine {
    OpenAi,
    Local,
}

/// Runtime capabilities — which engines are compiled in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttCapabilities {
    pub openai_available: bool,
    pub local_available: bool,
}

pub fn get_capabilities() -> SttCapabilities {
    SttCapabilities {
        openai_available: true,
        #[cfg(feature = "local-stt")]
        local_available: true,
        #[cfg(not(feature = "local-stt"))]
        local_available: false,
    }
}

/// Global recording handle — only one recording at a time.
static CAPTURE: Mutex<Option<CaptureHandle>> = Mutex::new(None);

const KEYRING_SERVICE: &str = "com.talkflow.app";
const KEYRING_USER: &str = "openai-api-key";

/// In-process cache so we don't hit the OS credential store on every transcription.
static API_KEY_CACHE: Mutex<Option<String>> = Mutex::new(None);

/// Store the OpenAI API key in the OS credential store (Windows Credential Manager)
/// and update the in-process cache.
pub fn set_api_key(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Keyring init error: {e}"))?;

    if key.is_empty() {
        let _ = entry.delete_credential(); // ignore "not found"
        let mut cache = API_KEY_CACHE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        *cache = None;
    } else {
        entry
            .set_password(&key)
            .map_err(|e| format!("Keyring save error: {e}"))?;
        let mut cache = API_KEY_CACHE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        *cache = Some(key);
    }
    Ok(())
}

/// Check whether an API key exists (without revealing the value).
pub fn has_api_key() -> bool {
    // Check cache first
    if let Ok(guard) = API_KEY_CACHE.lock() {
        if guard.is_some() {
            return true;
        }
    }
    // Fall back to credential store
    get_api_key().is_ok()
}

/// Read the API key — checks in-process cache first, then OS credential store.
/// Never exposed to frontend.
pub(crate) fn get_api_key() -> Result<String, String> {
    // Check cache
    if let Ok(guard) = API_KEY_CACHE.lock() {
        if let Some(ref key) = *guard {
            return Ok(key.clone());
        }
    }
    // Read from OS credential store and populate cache
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Keyring init error: {e}"))?;
    let key = entry
        .get_password()
        .map_err(|_| "未設定 OpenAI API Key。請在設定中填入 API Key。".to_string())?;
    if let Ok(mut cache) = API_KEY_CACHE.lock() {
        *cache = Some(key.clone());
    }
    Ok(key)
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

/// Stops recording, transcribes via the selected engine, and emits the transcript.
/// Returns immediately; transcription runs in the background.
pub fn stop_recording(
    app: tauri::AppHandle,
    engine: SttEngine,
    model_path: String,
) -> Result<(), String> {
    // Read the API key early (before spawning) so we fail fast if missing
    let api_key = if engine == SttEngine::OpenAi {
        Some(get_api_key()?)
    } else {
        None
    };

    let handle = {
        let mut guard = CAPTURE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        guard.take()
    };

    match handle {
        Some(h) => {
            // Drain all buffered audio before stopping the stream
            let mut samples = Vec::new();
            h.drain_samples(&mut samples);
            h.stop();

            let _ = app.emit("stt://stop", ());
            println!("[stt] Recording stopped, {} samples captured", samples.len());

            if samples.is_empty() {
                let _ = app.emit("stt://error", SttError {
                    message: "No audio captured".into(),
                });
                return Ok(());
            }

            // Spawn async task to transcribe
            let app_clone = app.clone();
            tokio::spawn(async move {
                let result = match engine {
                    SttEngine::OpenAi => transcribe_openai(api_key.as_deref().unwrap_or(""), &samples).await,
                    SttEngine::Local  => transcribe_local(&model_path, &samples).await,
                };
                match result {
                    Ok(text) => {
                        #[cfg(debug_assertions)]
                        println!("[stt] Transcript: {text}");
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
        None => Err("Not recording".into()),
    }
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
            let ctx =
                WhisperContext::new_with_params(&model_path, WhisperContextParameters::default())
                    .map_err(|e| format!("Failed to load model: {e}"))?;
            let mut state = ctx.create_state().map_err(|e| format!("State error: {e}"))?;
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_language(Some("zh"));
            params.set_print_realtime(false);
            params.set_print_progress(false);
            state
                .full(params, &samples)
                .map_err(|e| format!("Transcription failed: {e}"))?;

            let n = state
                .full_n_segments()
                .map_err(|e| format!("Segment error: {e}"))?;
            let mut result = String::new();
            for i in 0..n {
                if let Ok(seg) = state.full_get_segment_text(i) {
                    result.push_str(&seg);
                }
            }
            Ok(result.trim().to_string())
        })
        .await
        .map_err(|e| format!("Blocking task panicked: {e}"))?
    }
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
async fn transcribe_openai(api_key: &str, samples: &[f32]) -> Result<String, String> {
    let wav_data = encode_wav(samples);

    println!("[stt] Sending {} bytes of WAV to OpenAI Whisper API", wav_data.len());

    let part = reqwest::multipart::Part::bytes(wav_data)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Failed to create multipart: {e}"))?;

    let form = reqwest::multipart::Form::new()
        .text("model", "whisper-1")
        .text("language", "zh")
        .text("response_format", "json")
        .part("file", part);

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

    // Parse {"text": "..."}
    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))?;

    parsed["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Unexpected response format: {body}"))
}
