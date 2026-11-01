//! In-process Kokoro TTS through the bundled sherpa-onnx runtime.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig};

/// Kokoro v1.1 speaker ids: 0-2 are English voices, 3+ are Chinese voices.
const ENGLISH_SPEAKER_ID: i32 = 0; // af_maple
const CHINESE_SPEAKER_ID: i32 = 3; // zf_001

struct TtsCache {
    model_dir: String,
    tts: OfflineTts,
}

static TTS_CACHE: Mutex<Option<TtsCache>> = Mutex::new(None);

/// A Kokoro bundle is identified by `voices.bin` next to the model file.
pub(crate) fn is_kokoro_model(model_path: &Path) -> bool {
    model_path
        .parent()
        .is_some_and(|dir| dir.join("voices.bin").is_file())
}

/// Synthesizes `text` and plays each sentence as soon as it is generated.
/// Returns early, without error, once `stop_flag` is set.
pub(crate) fn synthesize_and_play(
    text: &str,
    model_path: &Path,
    speed: f32,
    speaker_id: Option<u32>,
    is_english: bool,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    if stop_flag.load(Ordering::SeqCst) {
        return Ok(());
    }
    let dir = model_path
        .parent()
        .ok_or("Cannot determine the Kokoro model directory.")?;
    let mut cache = TTS_CACHE
        .lock()
        .map_err(|e| format!("Kokoro TTS cache lock poisoned: {e}"))?;
    let model_dir = dir.to_string_lossy().to_string();
    if cache.as_ref().map(|cached| cached.model_dir.as_str()) != Some(model_dir.as_str()) {
        *cache = None;
        *cache = Some(TtsCache {
            tts: create_tts(dir, model_path)?,
            model_dir,
        });
    }
    let tts = &cache.as_ref().ok_or("Kokoro TTS cache not initialized")?.tts;

    let (_stream, stream_handle) = rodio::OutputStream::try_default()
        .map_err(|e| format!("Failed to open audio output: {e}"))?;
    let sink = Arc::new(
        rodio::Sink::try_new(&stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {e}"))?,
    );

    let sample_rate = tts.sample_rate() as u32;
    let callback_sink = sink.clone();
    let callback_stop = stop_flag.clone();
    let on_sentence = move |samples: &[f32], _progress: f32| {
        callback_sink.append(rodio::buffer::SamplesBuffer::new(1, sample_rate, samples.to_vec()));
        !callback_stop.load(Ordering::SeqCst)
    };
    let generation = GenerationConfig {
        sid: speaker_id.map_or(
            if is_english { ENGLISH_SPEAKER_ID } else { CHINESE_SPEAKER_ID },
            |id| id as i32,
        ),
        speed,
        ..Default::default()
    };
    let generated = tts.generate_with_config(text, &generation, Some(on_sentence));
    if stop_flag.load(Ordering::SeqCst) {
        sink.stop();
        return Ok(());
    }
    generated.ok_or("Kokoro failed to synthesize audio.")?;

    while !sink.empty() {
        if stop_flag.load(Ordering::Relaxed) {
            sink.stop();
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    Ok(())
}

fn create_tts(dir: &Path, model_path: &Path) -> Result<OfflineTts, String> {
    let path = |name: &str| dir.join(name).to_string_lossy().to_string();
    let mut config = OfflineTtsConfig::default();
    let kokoro = &mut config.model.kokoro;
    kokoro.model = Some(model_path.to_string_lossy().to_string());
    kokoro.voices = Some(path("voices.bin"));
    kokoro.tokens = Some(path("tokens.txt"));
    // espeak-ng-data speaks English words missing from the lexicon (sherpa-onnx < 2.0 only).
    kokoro.data_dir = Some(path("espeak-ng-data"));
    kokoro.dict_dir = Some(path("dict"));
    kokoro.lexicon = Some(format!(
        "{},{}",
        path("lexicon-us-en.txt"),
        path("lexicon-zh.txt")
    ));
    config.rule_fsts = Some(format!(
        "{},{},{}",
        path("date-zh.fst"),
        path("phone-zh.fst"),
        path("number-zh.fst")
    ));
    config.model.num_threads = std::thread::available_parallelism()
        .map(|n| n.get().clamp(1, 4) as i32)
        .unwrap_or(2);
    OfflineTts::create(&config).ok_or_else(|| "Failed to load the Kokoro TTS model.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Run with: NEUROPEN_KOKORO_MODEL=<dir>/model.int8.onnx NEUROPEN_KOKORO_WAV=<output wav>
    /// cargo test kokoro_synthesizes_mixed_text -- --ignored --nocapture
    #[test]
    #[ignore = "requires the downloaded Kokoro bundle"]
    fn kokoro_synthesizes_mixed_text() {
        let model = std::env::var("NEUROPEN_KOKORO_MODEL").expect("NEUROPEN_KOKORO_MODEL");
        let out = std::env::var("NEUROPEN_KOKORO_WAV").expect("NEUROPEN_KOKORO_WAV");
        let model_path = Path::new(&model);
        assert!(is_kokoro_model(model_path));
        let tts = create_tts(model_path.parent().unwrap(), model_path).expect("load");

        let generation = GenerationConfig {
            sid: CHINESE_SPEAKER_ID,
            ..Default::default()
        };
        let audio = tts
            .generate_with_config(
                "請把這份 PDF 報告交給 NeuroPen 團隊。",
                &generation,
                None::<fn(&[f32], f32) -> bool>,
            )
            .expect("generate");

        assert!(audio.samples().len() > tts.sample_rate() as usize);
        assert!(audio.save(&out));
    }

    #[test]
    fn non_kokoro_paths_are_not_detected_as_kokoro() {
        assert!(!is_kokoro_model(Path::new(r"C:\missing\en_US-lessac-medium.onnx")));
    }
}

#[cfg(test)]
mod playback_tests {
    use super::*;

    /// Plays audio on the default output device.
    /// Run with: NEUROPEN_KOKORO_MODEL=<dir>/model.int8.onnx
    /// cargo test kokoro_streams_playback -- --ignored --nocapture
    #[test]
    #[ignore = "requires the Kokoro bundle and an audio output device"]
    fn kokoro_streams_playback_and_stops_on_flag() {
        let model = std::env::var("NEUROPEN_KOKORO_MODEL").expect("NEUROPEN_KOKORO_MODEL");
        let started = std::time::Instant::now();
        synthesize_and_play(
            "你好。這是測試。",
            Path::new(&model),
            1.0,
            None,
            false,
            Arc::new(AtomicBool::new(false)),
        )
        .expect("play");
        println!("played in {:?}", started.elapsed());

        let stopped = Arc::new(AtomicBool::new(true));
        let started = std::time::Instant::now();
        synthesize_and_play("這句不應該播完。", Path::new(&model), 1.0, None, false, stopped)
            .expect("stopped playback");
        println!("stopped in {:?}", started.elapsed());
    }
}
