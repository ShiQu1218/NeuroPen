use serde::Serialize;
use std::path::PathBuf;

use super::talkflow_dir;

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
pub(crate) struct LocalSttCatalogEntry {
    pub(crate) id: &'static str,
    pub(crate) name: &'static str,
    pub(crate) description: &'static str,
    pub(crate) speed: u8,
    pub(crate) accuracy: u8,
    pub(crate) file_name: &'static str,
    pub(crate) download_url: &'static str,
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

pub(crate) fn catalog_entry_by_id(model_id: &str) -> Option<&'static LocalSttCatalogEntry> {
    LOCAL_STT_CATALOG.iter().find(|entry| entry.id == model_id)
}

pub(crate) fn model_file_path(entry: &LocalSttCatalogEntry) -> Result<PathBuf, String> {
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

pub(crate) fn list_local_stt_models() -> Result<Vec<LocalSttModel>, String> {
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

pub(crate) fn delete_local_stt_model(model_id: String) -> Result<(), String> {
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

pub(crate) fn select_local_stt_model(model_id: String) -> Result<String, String> {
    let entry = catalog_entry_by_id(&model_id)
        .ok_or_else(|| format!("Unknown local STT model id: {model_id}"))?;
    let target_path = model_file_path(entry)?;
    if !target_path.is_file() {
        return Err("模型尚未安裝，請先安裝後再選擇。".into());
    }
    write_active_model_id(Some(entry.id))?;
    Ok(target_path.to_string_lossy().to_string())
}
