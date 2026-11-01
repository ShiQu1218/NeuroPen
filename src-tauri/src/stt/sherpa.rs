//! Local STT engines that run through the sherpa-onnx runtime: SenseVoice, Moonshine, Qwen3-ASR.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig};

use super::validate_model_path;
use crate::audio_capture::TARGET_SAMPLE_RATE;

/// The exported Qwen3-ASR decoder caps prompt + audio + generated tokens at 512 (about 28 s of
/// audio), so longer recordings are transcribed segment by segment.
const QWEN3_MAX_SEGMENT_SECONDS: usize = 18;
const QWEN3_MIN_SEGMENT_SECONDS: usize = 12;
const QWEN3_MAX_NEW_TOKENS: i32 = 256;
const SPLIT_FRAME_SAMPLES: usize = TARGET_SAMPLE_RATE as usize / 10;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SherpaEngine {
    SenseVoice,
    Moonshine,
    Qwen3Asr,
}

struct RecognizerCache {
    cache_key: String,
    recognizer: OfflineRecognizer,
}

// One loaded model at a time keeps memory bounded; Qwen3-ASR alone holds about 2 GB.
static RECOGNIZER_CACHE: Mutex<Option<RecognizerCache>> = Mutex::new(None);

pub async fn transcribe(
    engine: SherpaEngine,
    model_path: &str,
    samples: &[f32],
    stt_language: &str,
) -> Result<String, String> {
    let config = build_config(engine, model_path, stt_language)?;
    let cache_key = format!("{config:?}");
    let samples = samples.to_vec();

    tokio::task::spawn_blocking(move || {
        if samples.is_empty() {
            return Ok(String::new());
        }

        let mut cache = RECOGNIZER_CACHE
            .lock()
            .map_err(|e| format!("{engine:?} recognizer cache lock poisoned: {e}"))?;
        if cache.as_ref().map(|cached| cached.cache_key.as_str()) != Some(cache_key.as_str()) {
            // Drop the previous model before loading the next one to avoid holding both.
            *cache = None;
            let recognizer = OfflineRecognizer::create(&config)
                .ok_or_else(|| format!("Failed to load the {engine:?} model."))?;
            *cache = Some(RecognizerCache {
                cache_key,
                recognizer,
            });
        }
        let recognizer = &cache
            .as_ref()
            .ok_or("Recognizer cache not initialized")?
            .recognizer;

        let segments = match engine {
            SherpaEngine::Qwen3Asr => split_segments(&samples),
            SherpaEngine::SenseVoice | SherpaEngine::Moonshine => vec![samples.as_slice()],
        };
        let mut transcript = String::new();
        for segment in segments {
            let stream = recognizer.create_stream();
            stream.accept_waveform(TARGET_SAMPLE_RATE as i32, segment);
            recognizer.decode(&stream);
            let result = stream
                .get_result()
                .ok_or_else(|| format!("{engine:?} returned no result."))?;
            append_segment_text(&mut transcript, result.text.trim());
        }
        Ok(transcript)
    })
    .await
    .map_err(|e| format!("{engine:?} blocking task panicked: {e}"))?
}

fn build_config(
    engine: SherpaEngine,
    model_path: &str,
    stt_language: &str,
) -> Result<OfflineRecognizerConfig, String> {
    let canonical = strip_verbatim_prefix(validate_model_path(model_path)?);
    let dir = if canonical.is_dir() {
        canonical.clone()
    } else {
        canonical
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("Cannot determine the {engine:?} model directory."))?
    };
    let file = |candidates: &[&str]| -> Result<Option<String>, String> {
        candidates
            .iter()
            .map(|name| dir.join(name))
            .find(|path| path.is_file())
            .map(|path| Some(path.to_string_lossy().to_string()))
            .ok_or_else(|| format!("{engine:?} model file is missing: {}", candidates[0]))
    };

    let mut config = OfflineRecognizerConfig::default();
    let model = &mut config.model_config;
    model.num_threads = std::thread::available_parallelism()
        .map(|n| n.get().clamp(1, 4) as i32)
        .unwrap_or(2);
    match engine {
        SherpaEngine::SenseVoice => {
            model.sense_voice.model = if canonical.is_file() {
                Some(canonical.to_string_lossy().to_string())
            } else {
                file(&["model.int8.onnx", "model.onnx"])?
            };
            model.sense_voice.language = Some(sensevoice_language(stt_language).to_string());
            model.sense_voice.use_itn = true;
            model.tokens = file(&["tokens.txt"])?;
        }
        SherpaEngine::Moonshine => {
            model.moonshine.preprocessor = file(&["preprocess.onnx"])?;
            model.moonshine.encoder = file(&["encode.int8.onnx", "encode.onnx"])?;
            model.moonshine.uncached_decoder =
                file(&["uncached_decode.int8.onnx", "uncached_decode.onnx"])?;
            model.moonshine.cached_decoder =
                file(&["cached_decode.int8.onnx", "cached_decode.onnx"])?;
            model.tokens = file(&["tokens.txt"])?;
        }
        SherpaEngine::Qwen3Asr => {
            model.qwen3_asr.conv_frontend = file(&["conv_frontend.onnx"])?;
            model.qwen3_asr.encoder = file(&["encoder.int8.onnx"])?;
            model.qwen3_asr.decoder = file(&["decoder.int8.onnx"])?;
            for name in ["vocab.json", "merges.txt", "tokenizer_config.json"] {
                file(&[&format!("tokenizer/{name}")])?;
            }
            model.qwen3_asr.tokenizer = Some(dir.join("tokenizer").to_string_lossy().to_string());
            model.qwen3_asr.max_new_tokens = QWEN3_MAX_NEW_TOKENS;        }
    }
    Ok(config)
}

fn sensevoice_language(stt_language: &str) -> &'static str {
    match stt_language.trim().to_lowercase().as_str() {
        "zh" => "zh",
        "en" => "en",
        "ja" => "ja",
        "ko" => "ko",
        "yue" => "yue",
        _ => "auto",
    }
}

/// sherpa-onnx appends `/`-separated names to the paths it receives, which Windows rejects inside
/// `\\?\` verbatim paths produced by `canonicalize`.
fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(plain) if !plain.starts_with(r"UNC\") => PathBuf::from(plain),
        _ => path,
    }
}

/// Splits audio into segments no longer than the Qwen3-ASR limit, cutting at the quietest
/// 100 ms frame between the minimum and maximum segment length to avoid splitting words.
fn split_segments(samples: &[f32]) -> Vec<&[f32]> {
    let max_len = QWEN3_MAX_SEGMENT_SECONDS * TARGET_SAMPLE_RATE as usize;
    let min_len = QWEN3_MIN_SEGMENT_SECONDS * TARGET_SAMPLE_RATE as usize;
    let mut segments = Vec::new();
    let mut rest = samples;
    while rest.len() > max_len {
        let split_at = (min_len..max_len - SPLIT_FRAME_SAMPLES)
            .step_by(SPLIT_FRAME_SAMPLES)
            .min_by(|&a, &b| {
                frame_energy(&rest[a..a + SPLIT_FRAME_SAMPLES])
                    .total_cmp(&frame_energy(&rest[b..b + SPLIT_FRAME_SAMPLES]))
            })
            .map_or(max_len, |frame_start| frame_start + SPLIT_FRAME_SAMPLES / 2);
        let (head, tail) = rest.split_at(split_at);
        segments.push(head);
        rest = tail;
    }
    segments.push(rest);
    segments
}

fn frame_energy(frame: &[f32]) -> f32 {
    frame.iter().map(|sample| sample * sample).sum()
}

/// Chinese and Japanese segments join directly; Latin-script segments need a separating space.
fn append_segment_text(transcript: &mut String, text: &str) {
    let needs_space = matches!(
        (transcript.chars().last(), text.chars().next()),
        (Some(prev), Some(next)) if prev.is_ascii_graphic() && next.is_ascii_alphanumeric()
    );
    if needs_space {
        transcript.push(' ');
    }
    transcript.push_str(text);
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: usize = TARGET_SAMPLE_RATE as usize;

    /// Run with: NEUROPEN_SHERPA_ENGINE=senseVoice|moonshine|qwen3Asr
    /// NEUROPEN_SHERPA_MODEL_DIR=<model dir> NEUROPEN_SHERPA_WAV=<16 kHz wav>
    /// cargo test sherpa_transcribes_real_audio -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "requires a downloaded model"]
    async fn sherpa_transcribes_real_audio() {
        let engine = match std::env::var("NEUROPEN_SHERPA_ENGINE").as_deref() {
            Ok("senseVoice") => SherpaEngine::SenseVoice,
            Ok("moonshine") => SherpaEngine::Moonshine,
            _ => SherpaEngine::Qwen3Asr,
        };
        let dir = std::env::var("NEUROPEN_SHERPA_MODEL_DIR").expect("NEUROPEN_SHERPA_MODEL_DIR");
        let wav = std::env::var("NEUROPEN_SHERPA_WAV").expect("NEUROPEN_SHERPA_WAV");
        let wave = sherpa_onnx::Wave::read(&wav).expect("read wav");
        assert_eq!(wave.sample_rate(), TARGET_SAMPLE_RATE as i32);

        let text = transcribe(engine, &dir, wave.samples(), "auto")
            .await
            .expect("transcribe");

        println!("{text}");
        assert!(!text.is_empty());
    }

    #[test]
    fn sensevoice_language_maps_known_codes_and_defaults_to_auto() {
        assert_eq!(sensevoice_language(" ZH "), "zh");
        assert_eq!(sensevoice_language("yue"), "yue");
        assert_eq!(sensevoice_language("zh-tw"), "auto");
        assert_eq!(sensevoice_language(""), "auto");
    }

    #[test]
    fn verbatim_prefix_is_removed_except_for_unc_paths() {
        assert_eq!(
            strip_verbatim_prefix(PathBuf::from(r"\\?\C:\models\qwen3")),
            PathBuf::from(r"C:\models\qwen3")
        );
        assert_eq!(
            strip_verbatim_prefix(PathBuf::from(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\?\UNC\server\share")
        );
    }

    #[test]
    fn segment_text_joins_cjk_directly_and_latin_with_space() {
        let mut transcript = String::new();
        append_segment_text(&mut transcript, "你好。");
        append_segment_text(&mut transcript, "世界");
        assert_eq!(transcript, "你好。世界");

        let mut transcript = String::from("Hello there.");
        append_segment_text(&mut transcript, "General Kenobi.");
        assert_eq!(transcript, "Hello there. General Kenobi.");
    }

    #[test]
    fn short_audio_stays_one_segment() {
        let samples = vec![0.5; 10 * RATE];
        assert_eq!(split_segments(&samples).len(), 1);
    }

    #[test]
    fn long_audio_splits_at_quietest_frame_and_keeps_every_sample() {
        let mut samples = vec![0.5; 40 * RATE];
        let silence_start = 15 * RATE;
        samples[silence_start..silence_start + SPLIT_FRAME_SAMPLES].fill(0.0);

        let segments = split_segments(&samples);

        assert_eq!(segments[0].len(), silence_start + SPLIT_FRAME_SAMPLES / 2);
        assert!(segments
            .iter()
            .all(|segment| segment.len() <= QWEN3_MAX_SEGMENT_SECONDS * RATE));
        assert_eq!(
            segments.iter().map(|segment| segment.len()).sum::<usize>(),
            samples.len()
        );
    }
}
