use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ort::{session::Session, value::DynValue, value::Tensor};

use super::validate_model_path;

struct MoonshineSessionCache {
    cache_key: String,
    preprocess: Session,
    encoder: Session,
    uncached_decoder: Session,
    cached_decoder: Session,
    tokens: Vec<String>,
    sos_token: i32,
    eos_token: i32,
}

static SESSION_CACHE: Mutex<Option<MoonshineSessionCache>> = Mutex::new(None);

pub async fn transcribe(model_path: &str, samples: &[f32]) -> Result<String, String> {
    let (cache_key, bundle) = resolve_moonshine_bundle(model_path)?;
    let samples = samples.to_vec();

    tokio::task::spawn_blocking(move || {
        if samples.is_empty() {
            return Ok(String::new());
        }

        let mut cache = SESSION_CACHE
            .lock()
            .map_err(|e| format!("Moonshine session cache lock poisoned: {e}"))?;
        let needs_reload = match &*cache {
            Some(cached) => cached.cache_key != cache_key,
            None => true,
        };

        if needs_reload {
            let n_threads = std::thread::available_parallelism()
                .map(|n| n.get().clamp(1, 4))
                .unwrap_or(2);
            let preprocess = build_session(&bundle.preprocess, n_threads, "Moonshine preprocess")?;
            let encoder = build_session(&bundle.encoder, n_threads, "Moonshine encoder")?;
            let uncached_decoder =
                build_session(&bundle.uncached_decoder, n_threads, "Moonshine uncached decoder")?;
            let cached_decoder =
                build_session(&bundle.cached_decoder, n_threads, "Moonshine cached decoder")?;
            let tokens = load_tokens(&bundle.tokens)?;
            let sos_token = find_token_id(&tokens, "<s>")?;
            let eos_token = find_token_id(&tokens, "</s>")?;

            *cache = Some(MoonshineSessionCache {
                cache_key: cache_key.clone(),
                preprocess,
                encoder,
                uncached_decoder,
                cached_decoder,
                tokens,
                sos_token,
                eos_token,
            });
        }

        let cached = cache.as_mut().ok_or("Moonshine cache not initialized")?;
        let audio_tensor = Tensor::from_array((
            [1usize, samples.len()],
            samples.into_boxed_slice(),
        ))
        .map_err(|e| format!("Failed to create Moonshine audio tensor: {e}"))?;
        let preprocess_outputs = cached
            .preprocess
            .run(ort::inputs![audio_tensor])
            .map_err(|e| format!("Moonshine preprocessor inference failed: {e}"))?;
        let features = take_first_output(preprocess_outputs, "Moonshine preprocessor output")?;
        let feature_shape = &**features.dtype().tensor_shape().ok_or("Moonshine features are not a tensor.")?;
        if feature_shape.len() != 3 {
            return Err("Moonshine features have an unexpected rank.".into());
        }
        let feature_frames = feature_shape[1].max(0) as i32;
        let feature_len_tensor = Tensor::from_array((
            [1usize],
            vec![feature_frames].into_boxed_slice(),
        ))
        .map_err(|e| format!("Failed to create Moonshine feature length tensor: {e}"))?;

        let encoder_outputs = cached
            .encoder
            .run(ort::inputs![&features, feature_len_tensor])
            .map_err(|e| format!("Moonshine encoder inference failed: {e}"))?;
        let encoder_out = take_first_output(encoder_outputs, "Moonshine encoder output")?;

        let mut generated_tokens = vec![cached.sos_token];
        let first_token_tensor = token_tensor(cached.sos_token)?;
        let first_len_tensor = seq_len_tensor(generated_tokens.len() as i32)?;
        let uncached_outputs = cached
            .uncached_decoder
            .run(ort::inputs![first_token_tensor, &encoder_out, first_len_tensor])
            .map_err(|e| format!("Moonshine uncached decoder inference failed: {e}"))?;
        let (mut logits, mut states) = split_decoder_outputs(uncached_outputs, "Moonshine uncached decoder")?;

        let max_len = ((feature_shape[1].max(1) as f32) * 1.5).ceil().max(8.0) as usize;
        for _ in 0..max_len {
            let token = argmax_token(&logits)?;
            if token == cached.eos_token {
                break;
            }
            generated_tokens.push(token);

            let step_token_tensor = token_tensor(token)?;
            let step_len_tensor = seq_len_tensor(generated_tokens.len() as i32)?;
            let cached_input_names: Vec<String> = cached
                .cached_decoder
                .inputs()
                .iter()
                .map(|input| input.name().to_string())
                .collect();
            let mut inputs = ort::inputs![
                cached_input_names[0].as_str() => step_token_tensor,
                cached_input_names[1].as_str() => &encoder_out,
                cached_input_names[2].as_str() => step_len_tensor,
            ];
            for (index, state) in states.iter().enumerate() {
                let input_name = cached_input_names
                    .get(index + 3)
                    .ok_or("Moonshine cached decoder state input mismatch.")?
                    .clone();
                inputs.push((input_name.into(), state.into()));
            }

            let cached_outputs = cached
                .cached_decoder
                .run(inputs)
                .map_err(|e| format!("Moonshine cached decoder inference failed: {e}"))?;
            let (next_logits, next_states) =
                split_decoder_outputs(cached_outputs, "Moonshine cached decoder")?;
            logits = next_logits;
            states = next_states;
        }

        Ok(tokens_to_text(&cached.tokens, &generated_tokens[1..]))
    })
    .await
    .map_err(|e| format!("Moonshine blocking task panicked: {e}"))?
}

struct MoonshineBundlePaths {
    preprocess: PathBuf,
    encoder: PathBuf,
    uncached_decoder: PathBuf,
    cached_decoder: PathBuf,
    tokens: PathBuf,
}

fn resolve_moonshine_bundle(model_path: &str) -> Result<(String, MoonshineBundlePaths), String> {
    let canonical = validate_model_path(model_path)?;
    let base_dir = if canonical.is_dir() {
        canonical.clone()
    } else {
        canonical
            .parent()
            .map(Path::to_path_buf)
            .ok_or("無法判斷 Moonshine 模型資料夾。")?
    };

    let bundle = MoonshineBundlePaths {
        preprocess: find_existing_file(&[base_dir.join("preprocess.onnx")], "找不到 Moonshine preprocess.onnx。")?,
        encoder: find_existing_file(
            &[base_dir.join("encode.int8.onnx"), base_dir.join("encode.onnx")],
            "找不到 Moonshine encoder 模型。",
        )?,
        uncached_decoder: find_existing_file(
            &[
                base_dir.join("uncached_decode.int8.onnx"),
                base_dir.join("uncached_decode.onnx"),
            ],
            "找不到 Moonshine uncached decoder 模型。",
        )?,
        cached_decoder: find_existing_file(
            &[
                base_dir.join("cached_decode.int8.onnx"),
                base_dir.join("cached_decode.onnx"),
            ],
            "找不到 Moonshine cached decoder 模型。",
        )?,
        tokens: find_existing_file(&[base_dir.join("tokens.txt")], "找不到 Moonshine tokens.txt。")?,
    };

    Ok((base_dir.to_string_lossy().to_string(), bundle))
}

fn find_existing_file(candidates: &[PathBuf], not_found_message: &str) -> Result<PathBuf, String> {
    candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .cloned()
        .ok_or_else(|| not_found_message.to_string())
}

fn build_session(path: &Path, threads: usize, label: &str) -> Result<Session, String> {
    Session::builder()
        .map_err(|e| format!("Failed to create {label} session builder: {e}"))?
        .with_intra_threads(threads)
        .map_err(|e| format!("Failed to set {label} threads: {e}"))?
        .commit_from_file(path)
        .map_err(|e| format!("Failed to load {label}: {e}"))
}

fn load_tokens(path: &Path) -> Result<Vec<String>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read Moonshine tokens.txt: {e}"))?;
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
            .map_err(|e| format!("Invalid Moonshine token id: {e}"))?;
        max_id = max_id.max(id);
        indexed_tokens.push((id, token));
    }

    let mut tokens = vec![String::new(); max_id + 1];
    for (id, token) in indexed_tokens {
        tokens[id] = token;
    }
    Ok(tokens)
}

fn find_token_id(tokens: &[String], wanted: &str) -> Result<i32, String> {
    tokens
        .iter()
        .position(|token| token == wanted)
        .map(|index| index as i32)
        .ok_or_else(|| format!("Moonshine tokens.txt is missing {wanted}"))
}

fn token_tensor(token: i32) -> Result<Tensor<i32>, String> {
    Tensor::from_array(([1usize, 1usize], vec![token].into_boxed_slice()))
        .map_err(|e| format!("Failed to create Moonshine token tensor: {e}"))
}

fn seq_len_tensor(seq_len: i32) -> Result<Tensor<i32>, String> {
    Tensor::from_array(([1usize], vec![seq_len].into_boxed_slice()))
        .map_err(|e| format!("Failed to create Moonshine sequence length tensor: {e}"))
}

fn take_first_output(outputs: ort::session::SessionOutputs<'_>, label: &str) -> Result<DynValue, String> {
    outputs
        .into_iter()
        .next()
        .map(|(_, value)| value)
        .ok_or_else(|| format!("{label} is missing."))
}

fn split_decoder_outputs(
    outputs: ort::session::SessionOutputs<'_>,
    label: &str,
) -> Result<(DynValue, Vec<DynValue>), String> {
    let mut iter = outputs.into_iter();
    let logits = iter
        .next()
        .map(|(_, value)| value)
        .ok_or_else(|| format!("{label} logits are missing."))?;
    let states = iter.map(|(_, value)| value).collect();
    Ok((logits, states))
}

fn argmax_token(logits: &DynValue) -> Result<i32, String> {
    let (shape, data) = logits
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Failed to read Moonshine logits: {e}"))?;
    let dims = &**shape;
    if dims.len() != 3 {
        return Err("Moonshine logits have an unexpected rank.".into());
    }
    let vocab_size = dims[2].max(0) as usize;
    if vocab_size == 0 {
        return Err("Moonshine logits have an empty vocabulary dimension.".into());
    }

    let mut best_index = 0usize;
    let mut best_score = f32::NEG_INFINITY;
    for (index, value) in data.iter().take(vocab_size).enumerate() {
        if *value > best_score {
            best_score = *value;
            best_index = index;
        }
    }
    Ok(best_index as i32)
}

fn tokens_to_text(tokens: &[String], token_ids: &[i32]) -> String {
    token_ids
        .iter()
        .filter_map(|token_id| tokens.get(*token_id as usize))
        .cloned()
        .collect::<String>()
        .replace('▁', " ")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moonshine_tokens_render_sentencepiece_spaces() {
        let tokens = vec![
            "<s>".into(),
            "</s>".into(),
            "▁hello".into(),
            "▁moon".into(),
            "shine".into(),
        ];

        assert_eq!(tokens_to_text(&tokens, &[2, 3, 4]), "hello moonshine");
    }
}
