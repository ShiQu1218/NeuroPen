//! Speech-to-Text engine (Whisper streaming).
//!
//! Phase 2 implementation:
//! - Open microphone via `cpal` (2.1 — audio_capture module)
//! - Stream audio chunks to Whisper model (2.2 — TODO)
//! - Emit Tauri events:
//!     `stt://start`         — recording began
//!     `stt://partial(text)` — intermediate transcript
//!     `stt://final(text)`   — sentence complete
//!     `stt://stop`          — recording ended

use crate::audio_capture::{self, CaptureHandle};
use std::sync::Mutex;
use tauri::Emitter;

/// Global recording handle — only one recording at a time.
static CAPTURE: Mutex<Option<CaptureHandle>> = Mutex::new(None);

/// Starts microphone capture.
/// Emits `stt://start` immediately.
/// Audio samples are buffered and can be drained via `drain_audio()`.
pub fn start_recording(app: tauri::AppHandle) -> Result<(), String> {
    // Prevent double-start
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

/// Stops recording and releases the audio stream.
/// Emits `stt://stop`.
pub fn stop_recording(app: tauri::AppHandle) -> Result<(), String> {
    let handle = {
        let mut guard = CAPTURE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        guard.take()
    };

    match handle {
        Some(h) => {
            h.stop();
            let _ = app.emit("stt://stop", ());
            println!("[stt] Recording stopped");
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
/// Returns an empty vec if not recording or no data available.
pub fn drain_audio() -> Vec<f32> {
    let mut out = Vec::new();
    if let Ok(guard) = CAPTURE.lock() {
        if let Some(ref handle) = *guard {
            handle.drain_samples(&mut out);
        }
    }
    out
}
