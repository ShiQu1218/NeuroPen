//! Microphone audio capture via cpal.
//!
//! Phase 2.1 implementation:
//! - Opens the system default audio input device
//! - Captures audio resampled to 16 kHz mono f32 (Whisper's expected format)
//! - Buffers samples in a lock-free ring buffer for the STT consumer
//! - Provides start/stop controls with thread-safe state management
//!
//! The ring buffer decouples the real-time audio callback from the
//! (potentially blocking) STT processing thread.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Whisper expects 16 kHz mono f32 samples.
pub const TARGET_SAMPLE_RATE: u32 = 16_000;
pub const TARGET_CHANNELS: u16 = 1;

/// Ring buffer capacity — ~30 seconds of 16 kHz mono audio.
const RING_BUFFER_CAPACITY: usize = TARGET_SAMPLE_RATE as usize * 30;

/// Type aliases for the ring buffer halves.
type RbProd = ringbuf::HeapProd<f32>;
type RbCons = ringbuf::HeapCons<f32>;

/// Handle returned by `start()`. Dropping it stops the capture.
///
/// cpal's `Stream` is `!Send` on some platforms, so we wrap it
/// in an `UnsafeStreamHolder` and only access it on the thread
/// that created it (the stop just drops it).
pub struct CaptureHandle {
    /// The cpal stream kept alive inside a wrapper.
    _stream: UnsafeStreamHolder,
    /// Consumer half of the ring buffer.
    consumer: Arc<Mutex<RbCons>>,
    /// Flag: true while recording.
    recording: Arc<AtomicBool>,
}

// cpal::Stream is !Send on Windows (WASAPI), but we only ever
// create and drop the stream on the same thread. The Mutex<Option>
// in stt.rs requires Send. This is safe because:
// - start() creates the stream on the calling thread
// - stop() drops it (CaptureHandle moved into stop, so the stream is dropped)
// - We never access the stream from another thread
struct UnsafeStreamHolder(cpal::Stream);
unsafe impl Send for UnsafeStreamHolder {}

impl CaptureHandle {
    /// Drain all available samples from the ring buffer into `out`.
    /// Returns the number of samples read.
    pub fn drain_samples(&self, out: &mut Vec<f32>) -> usize {
        let mut consumer = self.consumer.lock().expect("consumer lock poisoned");
        let available = consumer.occupied_len();
        if available == 0 {
            return 0;
        }
        out.reserve(available);
        let start = out.len();
        out.resize(start + available, 0.0);
        let n = consumer.pop_slice(&mut out[start..]);
        out.truncate(start + n);
        n
    }

    /// Returns true if the capture is still active.
    pub fn is_recording(&self) -> bool {
        self.recording.load(Ordering::Relaxed)
    }

    /// Stop recording and release the audio stream.
    pub fn stop(self) {
        self.recording.store(false, Ordering::SeqCst);
        // `_stream` is dropped here, which stops the cpal stream.
        println!("[audio_capture] Stopped");
    }
}

/// Linearly resample a chunk from `src_rate` → `TARGET_SAMPLE_RATE`.
/// Simple linear interpolation — good enough for speech.
fn resample(input: &[f32], src_rate: u32) -> Vec<f32> {
    if src_rate == TARGET_SAMPLE_RATE {
        return input.to_vec();
    }
    let ratio = src_rate as f64 / TARGET_SAMPLE_RATE as f64;
    let out_len = (input.len() as f64 / ratio).ceil() as usize;
    let mut output = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_idx = i as f64 * ratio;
        let idx0 = src_idx.floor() as usize;
        let idx1 = (idx0 + 1).min(input.len().saturating_sub(1));
        let frac = (src_idx - idx0 as f64) as f32;
        let sample = input[idx0] * (1.0 - frac) + input[idx1] * frac;
        output.push(sample);
    }
    output
}

/// Down-mix interleaved multi-channel audio to mono by averaging channels.
fn downmix_to_mono(input: &[f32], channels: u16) -> Vec<f32> {
    if channels == 1 {
        return input.to_vec();
    }
    let ch = channels as usize;
    input
        .chunks_exact(ch)
        .map(|frame| frame.iter().sum::<f32>() / ch as f32)
        .collect()
}

/// Start capturing audio from the default input device.
///
/// Returns a `CaptureHandle` that provides:
/// - `drain_samples()` to read buffered audio
/// - `stop()` to end the capture
///
/// # Errors
/// Returns a descriptive string if the audio device cannot be opened.
pub fn start() -> Result<CaptureHandle, String> {
    let host = cpal::default_host();

    let device = host
        .default_input_device()
        .ok_or_else(|| "No default audio input device found".to_string())?;

    let device_name = device.name().unwrap_or_else(|_| "unknown".into());
    println!("[audio_capture] Using input device: {device_name}");

    let supported_config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get default input config: {e}"))?;

    let sample_format = supported_config.sample_format();
    let config: cpal::StreamConfig = supported_config.into();

    let src_rate = config.sample_rate.0;
    let src_channels = config.channels;
    println!(
        "[audio_capture] Device config: {}Hz, {} ch, {:?}",
        src_rate, src_channels, sample_format
    );

    // Create the ring buffer
    let rb = ringbuf::HeapRb::<f32>::new(RING_BUFFER_CAPACITY);
    let (producer, consumer) = rb.split();
    let producer: Arc<Mutex<RbProd>> = Arc::new(Mutex::new(producer));
    let consumer: Arc<Mutex<RbCons>> = Arc::new(Mutex::new(consumer));

    let recording = Arc::new(AtomicBool::new(true));

    // Shared function to push f32 samples through the pipeline
    fn push_f32_samples(
        raw: &[f32],
        src_channels: u16,
        src_rate: u32,
        recording_flag: &AtomicBool,
        producer: &Mutex<RbProd>,
    ) {
        if !recording_flag.load(Ordering::Relaxed) {
            return;
        }
        let mono = downmix_to_mono(raw, src_channels);
        let resampled = resample(&mono, src_rate);
        if let Ok(mut prod) = producer.lock() {
            prod.push_slice(&resampled);
        }
    }

    let err_fn = |err: cpal::StreamError| {
        eprintln!("[audio_capture] Stream error: {err}");
    };

    let stream = match sample_format {
        SampleFormat::F32 => {
            let producer = producer.clone();
            let rec = recording.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        push_f32_samples(data, src_channels, src_rate, &rec, &producer);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build f32 input stream: {e}"))?
        }
        SampleFormat::I16 => {
            let producer = producer.clone();
            let rec = recording.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let f32_data: Vec<f32> =
                            data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                        push_f32_samples(&f32_data, src_channels, src_rate, &rec, &producer);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build i16 input stream: {e}"))?
        }
        SampleFormat::U16 => {
            let producer = producer.clone();
            let rec = recording.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        let f32_data: Vec<f32> = data
                            .iter()
                            .map(|&s| (s as f32 / u16::MAX as f32) * 2.0 - 1.0)
                            .collect();
                        push_f32_samples(&f32_data, src_channels, src_rate, &rec, &producer);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build u16 input stream: {e}"))?
        }
        _ => {
            return Err(format!("Unsupported sample format: {sample_format:?}"));
        }
    };

    stream
        .play()
        .map_err(|e| format!("Failed to start audio stream: {e}"))?;

    println!("[audio_capture] Recording started");

    Ok(CaptureHandle {
        _stream: UnsafeStreamHolder(stream),
        consumer,
        recording,
    })
}

/// List available audio input devices (for settings UI).
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devices| {
            devices
                .filter_map(|d| d.name().ok())
                .collect()
        })
        .unwrap_or_default()
}
