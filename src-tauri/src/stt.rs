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

/// In-process cache so we don't read from file on every call.
static API_KEY_CACHE: Mutex<Option<String>> = Mutex::new(None);

/// Get the path to the API key file (~/.talkflow/api_key).
fn api_key_file_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let dir = home.join(".talkflow");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create .talkflow dir: {e}"))?;
    }
    Ok(dir.join("api_key"))
}

/// Store the OpenAI API key to a file and update the in-process cache.
pub fn set_api_key(key: String) -> Result<(), String> {
    let path = api_key_file_path()?;

    if key.is_empty() {
        let _ = std::fs::remove_file(&path);
        let mut cache = API_KEY_CACHE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        *cache = None;
    } else {
        std::fs::write(&path, &key)
            .map_err(|e| format!("Failed to save API key: {e}"))?;
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

/// Read the API key — checks in-process cache first, then file.
/// Never exposed to frontend.
pub(crate) fn get_api_key() -> Result<String, String> {
    // Check cache
    if let Ok(guard) = API_KEY_CACHE.lock() {
        if let Some(ref key) = *guard {
            return Ok(key.clone());
        }
    }
    // Read from file and populate cache
    let path = api_key_file_path()?;
    let key = std::fs::read_to_string(&path)
        .map_err(|_| "未設定 OpenAI API Key。請在設定中填入 API Key。".to_string())?;
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("未設定 OpenAI API Key。請在設定中填入 API Key。".to_string());
    }
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

    if samples.is_empty() {
        let _ = app.emit("stt://error", SttError {
            message: "No audio captured".into(),
        });
        return Ok(());
    }

    // Check API key after stopping — recording is already stopped at this point
    let api_key = if engine == SttEngine::OpenAi {
        match get_api_key() {
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

    // Spawn async task to transcribe
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = match engine {
            SttEngine::OpenAi => transcribe_openai(api_key.as_deref().unwrap_or(""), &samples).await,
            SttEngine::Local  => transcribe_local(&model_path, &samples).await,
        };
        match result {
            Ok(raw_text) => {
                println!("[stt] Raw transcript: {:?}", raw_text);
                let text = deduplicate_transcript(&raw_text);
                if text != raw_text {
                    println!("[stt] Deduped transcript: {:?}", text);
                }
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
        .text("response_format", "verbose_json")
        .text("temperature", "0")
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

            println!(
                "[stt] Segment: {:?} (compression={:.2}, no_speech={:.2})",
                seg_text, compression, no_speech
            );

            // Skip segments that look hallucinated
            if compression > 2.4 || no_speech > 0.6 {
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
}
