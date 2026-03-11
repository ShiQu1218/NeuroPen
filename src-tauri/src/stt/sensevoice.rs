use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ort::{session::Session, value::Tensor};
use rustfft::{FftPlanner, num_complex::Complex32};

use super::validate_model_path;

struct SenseVoiceMetadata {
    blank_id: i32,
    window_size: usize,
    window_shift: usize,
    normalize_samples: bool,
    with_itn_id: i32,
    _without_itn_id: i32,
    lang_auto: i32,
    lang_zh: i32,
    lang_en: i32,
    lang_ja: i32,
    lang_ko: i32,
    lang_yue: i32,
    neg_mean: Vec<f32>,
    inv_stddev: Vec<f32>,
}

struct SenseVoiceSessionCache {
    cache_key: String,
    session: Session,
    metadata: SenseVoiceMetadata,
    tokens: Vec<String>,
}

static SESSION_CACHE: Mutex<Option<SenseVoiceSessionCache>> = Mutex::new(None);

pub async fn transcribe(model_path: &str, samples: &[f32], stt_language: &str) -> Result<String, String> {
    let (cache_key, model_file, tokens_file) = resolve_sensevoice_paths(model_path)?;
    let samples = samples.to_vec();
    let stt_language = stt_language.to_string();

    tokio::task::spawn_blocking(move || {
        if samples.is_empty() {
            return Ok(String::new());
        }

        let mut cache = SESSION_CACHE
            .lock()
            .map_err(|e| format!("SenseVoice session cache lock poisoned: {e}"))?;

        let needs_reload = match &*cache {
            Some(cached) => cached.cache_key != cache_key,
            None => true,
        };

        if needs_reload {
            let n_threads = std::thread::available_parallelism()
                .map(|n| n.get().clamp(1, 4))
                .unwrap_or(2);
            let session = Session::builder()
                .map_err(|e| format!("Failed to create ONNX session builder: {e}"))?
                .with_intra_threads(n_threads)
                .map_err(|e| format!("Failed to set ONNX threads: {e}"))?
                .commit_from_file(&model_file)
                .map_err(|e| format!("Failed to load SenseVoice ONNX model: {e}"))?;
            let metadata = read_metadata(&session)?;
            let tokens = load_tokens(&tokens_file)?;
            *cache = Some(SenseVoiceSessionCache {
                cache_key: cache_key.clone(),
                session,
                metadata,
                tokens,
            });
        }

        let cached = cache.as_mut().ok_or("SenseVoice cache not initialized")?;
        let features = compute_features(&samples, &cached.metadata);
        if features.is_empty() {
            return Ok(String::new());
        }

        let feature_dim = cached.metadata.neg_mean.len();
        if feature_dim == 0 || features.len() % feature_dim != 0 {
            return Err("SenseVoice features have an invalid shape.".into());
        }

        let num_frames = features.len() / feature_dim;
        let features_tensor = Tensor::from_array((
            [1usize, num_frames, feature_dim],
            features.into_boxed_slice(),
        ))
        .map_err(|e| format!("Failed to create SenseVoice features tensor: {e}"))?;
        let features_length_tensor = Tensor::from_array((
            [1usize],
            vec![num_frames as i32].into_boxed_slice(),
        ))
        .map_err(|e| format!("Failed to create SenseVoice features length tensor: {e}"))?;
        let language_tensor = Tensor::from_array((
            [1usize],
            vec![resolve_language_id(&cached.metadata, &stt_language)].into_boxed_slice(),
        ))
        .map_err(|e| format!("Failed to create SenseVoice language tensor: {e}"))?;
        let text_norm_tensor = Tensor::from_array((
            [1usize],
            vec![cached.metadata.with_itn_id].into_boxed_slice(),
        ))
        .map_err(|e| format!("Failed to create SenseVoice text-normalization tensor: {e}"))?;

        let outputs = cached
            .session
            .run(ort::inputs![
                features_tensor,
                features_length_tensor,
                language_tensor,
                text_norm_tensor,
            ])
            .map_err(|e| format!("SenseVoice inference failed: {e}"))?;

        decode_logits(&outputs[0], &cached.tokens, &cached.metadata)
    })
    .await
    .map_err(|e| format!("SenseVoice blocking task panicked: {e}"))?
}

fn resolve_sensevoice_paths(model_path: &str) -> Result<(String, PathBuf, PathBuf), String> {
    let canonical = validate_model_path(model_path)?;
    let base_dir = if canonical.is_dir() {
        canonical.clone()
    } else {
        canonical
            .parent()
            .map(Path::to_path_buf)
            .ok_or("無法判斷 SenseVoice 模型資料夾。")?
    };
    let model_file = if canonical.is_file() {
        if canonical.extension().and_then(|ext| ext.to_str()) != Some("onnx") {
            return Err("SenseVoice 模型路徑必須指向 .onnx 檔案或模型資料夾。".into());
        }
        canonical.clone()
    } else {
        find_existing_file(
            &[
                base_dir.join("model.int8.onnx"),
                base_dir.join("model.onnx"),
            ],
            "找不到 SenseVoice ONNX 檔案。",
        )?
    };
    let tokens_file = base_dir.join("tokens.txt");
    if !tokens_file.is_file() {
        return Err("找不到 SenseVoice tokens.txt。".into());
    }
    Ok((base_dir.to_string_lossy().to_string(), model_file, tokens_file))
}

fn find_existing_file(candidates: &[PathBuf], not_found_message: &str) -> Result<PathBuf, String> {
    candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .cloned()
        .ok_or_else(|| not_found_message.to_string())
}

fn read_metadata(session: &Session) -> Result<SenseVoiceMetadata, String> {
    let metadata = session
        .metadata()
        .map_err(|e| format!("Failed to read SenseVoice metadata: {e}"))?;

    Ok(SenseVoiceMetadata {
        blank_id: read_metadata_i32(&metadata, "blank_id")?.unwrap_or(0),
        window_size: read_metadata_i32(&metadata, "lfr_window_size")?
            .unwrap_or(7)
            .max(1) as usize,
        window_shift: read_metadata_i32(&metadata, "lfr_window_shift")?
            .unwrap_or(6)
            .max(1) as usize,
        normalize_samples: read_metadata_i32(&metadata, "normalize_samples")?.unwrap_or(0) != 0,
        with_itn_id: read_metadata_i32(&metadata, "with_itn")?.unwrap_or(14),
        _without_itn_id: read_metadata_i32(&metadata, "without_itn")?.unwrap_or(15),
        lang_auto: read_metadata_i32(&metadata, "lang_auto")?.unwrap_or(0),
        lang_zh: read_metadata_i32(&metadata, "lang_zh")?.unwrap_or(3),
        lang_en: read_metadata_i32(&metadata, "lang_en")?.unwrap_or(4),
        lang_yue: read_metadata_i32(&metadata, "lang_yue")?.unwrap_or(7),
        lang_ja: read_metadata_i32(&metadata, "lang_ja")?.unwrap_or(11),
        lang_ko: read_metadata_i32(&metadata, "lang_ko")?.unwrap_or(12),
        neg_mean: read_metadata_f32_list(&metadata, "neg_mean")?,
        inv_stddev: read_metadata_f32_list(&metadata, "inv_stddev")?,
    })
}

fn read_metadata_i32(metadata: &ort::session::ModelMetadata<'_>, key: &str) -> Result<Option<i32>, String> {
    metadata
        .custom(key)
        .map(|value| parse_optional_metadata_i32(&value, key))
        .unwrap_or(Ok(None))
}

fn read_metadata_f32_list(
    metadata: &ort::session::ModelMetadata<'_>,
    key: &str,
) -> Result<Vec<f32>, String> {
    metadata
        .custom(key)
        .ok_or_else(|| format!("SenseVoice metadata is missing {key}"))?
        .split(',')
        .filter_map(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .map(|value| {
            value
                .parse::<f32>()
                .map_err(|e| format!("Invalid SenseVoice metadata for {key}: {e}"))
        })
        .collect()
}

fn parse_optional_metadata_i32(value: &str, key: &str) -> Result<Option<i32>, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    trimmed
        .parse::<i32>()
        .map(Some)
        .map_err(|e| format!("Invalid SenseVoice metadata for {key}: {e}"))
}

fn load_tokens(path: &Path) -> Result<Vec<String>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read SenseVoice tokens.txt: {e}"))?;
    let mut indexed_tokens = Vec::<(usize, String)>::new();
    let mut max_id = 0usize;

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let split_at = line
            .rfind(|c: char| c.is_whitespace())
            .ok_or_else(|| format!("Invalid token line: {line}"))?;
        let token = line[..split_at].trim_end().to_string();
        let id = line[split_at..]
            .trim()
            .parse::<usize>()
            .map_err(|e| format!("Invalid token id in tokens.txt: {e}"))?;
        max_id = max_id.max(id);
        indexed_tokens.push((id, token));
    }

    let mut tokens = vec![String::new(); max_id + 1];
    for (id, token) in indexed_tokens {
        tokens[id] = token;
    }
    Ok(tokens)
}

fn resolve_language_id(metadata: &SenseVoiceMetadata, language: &str) -> i32 {
    match language.trim().to_lowercase().as_str() {
        "zh" => metadata.lang_zh,
        "en" => metadata.lang_en,
        "ja" => metadata.lang_ja,
        "ko" => metadata.lang_ko,
        "yue" => metadata.lang_yue,
        _ => metadata.lang_auto,
    }
}

fn compute_features(samples: &[f32], metadata: &SenseVoiceMetadata) -> Vec<f32> {
    let frames = compute_log_mel_filterbank(samples, metadata.normalize_samples);
    if frames.len() < metadata.window_size || metadata.neg_mean.is_empty() {
        return Vec::new();
    }

    let feat_dim = 80usize;
    let out_feat_dim = feat_dim * metadata.window_size;
    let out_num_frames = (frames.len() - metadata.window_size) / metadata.window_shift + 1;
    let mut out = vec![0.0f32; out_num_frames * out_feat_dim];

    for frame_index in 0..out_num_frames {
        let input_start = frame_index * metadata.window_shift;
        let output_start = frame_index * out_feat_dim;
        for window_offset in 0..metadata.window_size {
            let frame = &frames[input_start + window_offset];
            let dest = output_start + window_offset * feat_dim;
            out[dest..dest + feat_dim].copy_from_slice(frame);
        }
    }

    if metadata.neg_mean.len() != out_feat_dim || metadata.inv_stddev.len() != out_feat_dim {
        return Vec::new();
    }

    for frame in out.chunks_exact_mut(out_feat_dim) {
        for (i, value) in frame.iter_mut().enumerate() {
            *value = (*value + metadata.neg_mean[i]) * metadata.inv_stddev[i];
        }
    }

    out
}

fn compute_log_mel_filterbank(samples: &[f32], normalize_samples: bool) -> Vec<[f32; 80]> {
    const SAMPLE_RATE: usize = 16_000;
    const FRAME_LEN: usize = 400;
    const HOP_LEN: usize = 160;
    const FFT_SIZE: usize = 512;
    const MEL_BINS: usize = 80;
    const PREEMPH: f32 = 0.97;
    const EPSILON: f32 = 1e-10;

    if samples.is_empty() {
        return Vec::new();
    }

    let scaled: Vec<f32> = if normalize_samples {
        samples.to_vec()
    } else {
        samples.iter().map(|sample| sample * 32768.0).collect()
    };

    let num_frames = ((scaled.len().saturating_sub(1)) / HOP_LEN).max(1);
    let mel_filters = build_mel_filterbank(SAMPLE_RATE, FFT_SIZE, MEL_BINS);
    let hamming: Vec<f32> = (0..FRAME_LEN)
        .map(|i| 0.54 - 0.46 * ((2.0 * std::f32::consts::PI * i as f32) / (FRAME_LEN - 1) as f32).cos())
        .collect();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);
    let mut spectrum = vec![Complex32::default(); FFT_SIZE];
    let mut features = Vec::with_capacity(num_frames);

    for frame_index in 0..num_frames {
        let start = frame_index * HOP_LEN;
        let mut frame = vec![0.0f32; FRAME_LEN];
        let available = scaled.len().saturating_sub(start).min(FRAME_LEN);
        frame[..available].copy_from_slice(&scaled[start..start + available]);

        let mean = frame.iter().sum::<f32>() / FRAME_LEN as f32;
        for sample in &mut frame {
            *sample -= mean;
        }

        let mut previous = frame[0];
        frame[0] *= 1.0 - PREEMPH;
        for sample in frame.iter_mut().skip(1) {
            let current = *sample;
            *sample = current - PREEMPH * previous;
            previous = current;
        }

        for i in 0..FRAME_LEN {
            spectrum[i] = Complex32::new(frame[i] * hamming[i], 0.0);
        }
        for value in spectrum.iter_mut().skip(FRAME_LEN) {
            *value = Complex32::default();
        }
        fft.process(&mut spectrum);

        let power: Vec<f32> = spectrum[..(FFT_SIZE / 2 + 1)]
            .iter()
            .map(|value| value.norm_sqr().max(EPSILON))
            .collect();

        let mut mel_frame = [0.0f32; MEL_BINS];
        for (mel_index, filter) in mel_filters.iter().enumerate() {
            let energy = filter
                .iter()
                .zip(power.iter())
                .map(|(weight, value)| weight * value)
                .sum::<f32>()
                .max(EPSILON);
            mel_frame[mel_index] = energy.ln();
        }
        features.push(mel_frame);
    }

    features
}

fn build_mel_filterbank(sample_rate: usize, fft_size: usize, mel_bins: usize) -> Vec<Vec<f32>> {
    let low_hz = 20.0f32;
    let high_hz = sample_rate as f32 / 2.0;
    let low_mel = hz_to_mel(low_hz);
    let high_mel = hz_to_mel(high_hz);
    let mel_points: Vec<f32> = (0..(mel_bins + 2))
        .map(|i| low_mel + (high_mel - low_mel) * i as f32 / (mel_bins + 1) as f32)
        .collect();
    let hz_points: Vec<f32> = mel_points.into_iter().map(mel_to_hz).collect();
    let bins: Vec<usize> = hz_points
        .iter()
        .map(|hz| (((fft_size + 1) as f32 * *hz) / sample_rate as f32).floor() as usize)
        .collect();

    let num_fft_bins = fft_size / 2 + 1;
    let mut filters = vec![vec![0.0f32; num_fft_bins]; mel_bins];

    for mel_index in 0..mel_bins {
        let left = bins[mel_index].min(num_fft_bins - 1);
        let center = bins[mel_index + 1].min(num_fft_bins - 1);
        let right = bins[mel_index + 2].min(num_fft_bins - 1);

        if center > left {
            for bin in left..center {
                filters[mel_index][bin] = (bin - left) as f32 / (center - left) as f32;
            }
        }
        if right > center {
            for bin in center..right {
                filters[mel_index][bin] = (right - bin) as f32 / (right - center) as f32;
            }
        }
    }

    filters
}

fn hz_to_mel(hz: f32) -> f32 {
    2595.0 * (1.0 + hz / 700.0).log10()
}

fn mel_to_hz(mel: f32) -> f32 {
    700.0 * (10f32.powf(mel / 2595.0) - 1.0)
}

fn decode_logits(
    logits: &ort::value::DynValue,
    tokens: &[String],
    metadata: &SenseVoiceMetadata,
) -> Result<String, String> {
    let (shape, data) = logits
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Failed to read SenseVoice logits: {e}"))?;
    let dims = &**shape;
    if dims.len() != 3 {
        return Err("SenseVoice logits have an unexpected rank.".into());
    }
    let time_steps = dims[1].max(0) as usize;
    let vocab_size = dims[2].max(0) as usize;
    if time_steps == 0 || vocab_size == 0 {
        return Ok(String::new());
    }

    let mut decoded = Vec::<i32>::with_capacity(time_steps);
    for frame in 0..time_steps {
        let start = frame * vocab_size;
        let end = start + vocab_size;
        let frame_logits = &data[start..end];
        let mut best_index = 0usize;
        let mut best_score = f32::NEG_INFINITY;
        for (index, value) in frame_logits.iter().enumerate() {
            if *value > best_score {
                best_score = *value;
                best_index = index;
            }
        }
        decoded.push(best_index as i32);
    }

    decoded.dedup();
    decoded.retain(|token| *token != metadata.blank_id);
    let decoded = if decoded.len() > 4 {
        &decoded[4..]
    } else {
        &[][..]
    };

    let text = decoded
        .iter()
        .filter_map(|token_id| tokens.get(*token_id as usize))
        .cloned()
        .collect::<String>()
        .replace('▁', " ");

    Ok(text.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_skips_sensevoice_prefix_tokens() {
        let logits = Tensor::from_array((
            [1usize, 6usize, 8usize],
            vec![
                0.0f32, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // prefix 1
                0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0, // prefix 2
                0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, // prefix 3
                0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 10.0, 0.0, // prefix 4
                0.0, 0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, // real token
                0.0, 0.0, 0.0, 0.0, 0.0, 10.0, 0.0, 0.0, // real token
            ]
            .into_boxed_slice(),
        ))
        .expect("tensor")
        .into_dyn();
        let tokens = vec![
            "<blank>".into(),
            "<s>".into(),
            "</s>".into(),
            "<meta-0>".into(),
            "▁hello".into(),
            "▁world".into(),
            "<meta-1>".into(),
            "<meta-2>".into(),
        ];
        let metadata = SenseVoiceMetadata {
            blank_id: 0,
            window_size: 7,
            window_shift: 6,
            normalize_samples: false,
            with_itn_id: 14,
            _without_itn_id: 15,
            lang_auto: 0,
            lang_zh: 3,
            lang_en: 4,
            lang_ja: 11,
            lang_ko: 12,
            lang_yue: 7,
            neg_mean: vec![0.0; 560],
            inv_stddev: vec![1.0; 560],
        };

        let text = decode_logits(&logits, &tokens, &metadata).expect("decoded");
        assert_eq!(text, "hello world");
    }

    #[test]
    fn empty_integer_metadata_uses_default_path() {
        assert_eq!(
            parse_optional_metadata_i32("", "blank_id").expect("empty metadata"),
            None
        );
        assert_eq!(
            parse_optional_metadata_i32("   ", "blank_id").expect("whitespace metadata"),
            None
        );
    }
}
