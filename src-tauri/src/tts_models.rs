use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTtsModel {
    pub id: String,
    pub name: String,
    pub description: String,
    pub language: String,
    pub quality: String,
    pub speaker_count: u32,
    pub download_url: String,
    pub file_name: String,
    pub installed: bool,
    pub active: bool,
    pub model_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum LocalTtsEngine {
    /// Single `.onnx` + `.onnx.json` voice from rhasspy/piper-voices, run by the Piper CLI.
    Piper,
    /// sherpa-onnx Kokoro bundle, downloaded as one `.tar.bz2` archive named after the entry id.
    Kokoro,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct LocalTtsCatalogEntry {
    pub(crate) id: &'static str,
    pub(crate) name: &'static str,
    pub(crate) description: &'static str,
    pub(crate) language: &'static str,
    pub(crate) quality: &'static str,
    pub(crate) speaker_count: u32,
    pub(crate) relative_dir: &'static str,
    pub(crate) file_name: &'static str,
    pub(crate) engine: LocalTtsEngine,
}

#[derive(Debug, Clone)]
pub(crate) struct LocalTtsInstallArtifact {
    pub(crate) path: PathBuf,
    pub(crate) download_url: String,
}

const HUGGING_FACE_RESOLVE_ROOT: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const SHERPA_TTS_RELEASE_ROOT: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";
/// Files whose presence marks a fully extracted Kokoro bundle.
const KOKORO_REQUIRED_PATHS: [&str; 6] = [
    "model.int8.onnx",
    "voices.bin",
    "tokens.txt",
    "lexicon-zh.txt",
    "espeak-ng-data/phontab",
    "dict/jieba.dict.utf8",
];

const LOCAL_TTS_CATALOG: [LocalTtsCatalogEntry; 8] = [
    LocalTtsCatalogEntry {
        id: "kokoro-int8-multi-lang-v1_1",
        name: "Kokoro v1.1",
        description: "Kokoro v1.1 multilingual voices for Chinese and English, including mixed text.",
        language: "zh-CN, en-US",
        quality: "high",
        speaker_count: 103,
        relative_dir: "",
        file_name: "model.int8.onnx",
        engine: LocalTtsEngine::Kokoro,
    },
    LocalTtsCatalogEntry {
        id: "zh-cn-huayan-medium",
        name: "Huayan",
        description: "中文中型女聲，適合作為繁中與簡中預設語音。",
        language: "zh-CN",
        quality: "medium",
        speaker_count: 1,
        relative_dir: "zh/zh_CN/huayan/medium",
        file_name: "zh_CN-huayan-medium.onnx",
        engine: LocalTtsEngine::Piper,
    },
    LocalTtsCatalogEntry {
        id: "en-us-lessac-medium",
        name: "Lessac",
        description: "英文中型單說話人模型，語氣自然，適合一般助理朗讀。",
        language: "en-US",
        quality: "medium",
        speaker_count: 1,
        relative_dir: "en/en_US/lessac/medium",
        file_name: "en_US-lessac-medium.onnx",
        engine: LocalTtsEngine::Piper,
    },
    LocalTtsCatalogEntry {
        id: "de-de-thorsten-medium",
        name: "Thorsten",
        description: "德文中型男聲模型。",
        language: "de-DE",
        quality: "medium",
        speaker_count: 1,
        relative_dir: "de/de_DE/thorsten/medium",
        file_name: "de_DE-thorsten-medium.onnx",
        engine: LocalTtsEngine::Piper,
    },
    LocalTtsCatalogEntry {
        id: "fr-fr-siwis-medium",
        name: "Siwis",
        description: "法文中型單說話人模型。",
        language: "fr-FR",
        quality: "medium",
        speaker_count: 1,
        relative_dir: "fr/fr_FR/siwis/medium",
        file_name: "fr_FR-siwis-medium.onnx",
        engine: LocalTtsEngine::Piper,
    },
    LocalTtsCatalogEntry {
        id: "es-es-sharvard-medium",
        name: "Sharvard",
        description: "西班牙文中型雙說話人模型，可搭配 Speaker ID 切換聲音。",
        language: "es-ES",
        quality: "medium",
        speaker_count: 2,
        relative_dir: "es/es_ES/sharvard/medium",
        file_name: "es_ES-sharvard-medium.onnx",
        engine: LocalTtsEngine::Piper,
    },
    LocalTtsCatalogEntry {
        id: "ru-ru-irina-medium",
        name: "Irina",
        description: "俄文中型單說話人模型。",
        language: "ru-RU",
        quality: "medium",
        speaker_count: 1,
        relative_dir: "ru/ru_RU/irina/medium",
        file_name: "ru_RU-irina-medium.onnx",
        engine: LocalTtsEngine::Piper,
    },
    LocalTtsCatalogEntry {
        id: "ar-jo-kareem-medium",
        name: "Kareem",
        description: "阿拉伯文中型單說話人模型。",
        language: "ar-SA",
        quality: "medium",
        speaker_count: 1,
        relative_dir: "ar/ar_JO/kareem/medium",
        file_name: "ar_JO-kareem-medium.onnx",
        engine: LocalTtsEngine::Piper,
    },
];

fn neuropen_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let dir = home.join(".neuropen");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create .neuropen dir: {e}"))?;
    }
    Ok(dir)
}

fn local_models_dir() -> Result<PathBuf, String> {
    let dir = neuropen_dir()?.join("piper").join("models");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create TTS model dir: {e}"))?;
    }
    Ok(dir)
}

fn active_model_file_path() -> Result<PathBuf, String> {
    Ok(neuropen_dir()?.join("active_local_tts_model"))
}

fn install_root_path(entry: &LocalTtsCatalogEntry) -> Result<PathBuf, String> {
    Ok(local_models_dir()?.join(entry.id))
}

fn model_path(entry: &LocalTtsCatalogEntry) -> Result<PathBuf, String> {
    Ok(install_root_path(entry)?.join(entry.file_name))
}

fn config_path(entry: &LocalTtsCatalogEntry) -> Result<PathBuf, String> {
    Ok(install_root_path(entry)?.join(format!("{}.json", entry.file_name)))
}

pub(crate) fn is_entry_installed(entry: &LocalTtsCatalogEntry) -> Result<bool, String> {
    match entry.engine {
        LocalTtsEngine::Piper => Ok(model_path(entry)?.is_file() && config_path(entry)?.is_file()),
        LocalTtsEngine::Kokoro => {
            let root = install_root_path(entry)?;
            Ok(KOKORO_REQUIRED_PATHS
                .iter()
                .all(|relative| root.join(relative).is_file()))
        }
    }
}

fn primary_download_url(entry: &LocalTtsCatalogEntry) -> String {
    match entry.engine {
        LocalTtsEngine::Piper => format!(
            "{}/{}/{}",
            HUGGING_FACE_RESOLVE_ROOT, entry.relative_dir, entry.file_name
        ),
        LocalTtsEngine::Kokoro => format!("{SHERPA_TTS_RELEASE_ROOT}/{}.tar.bz2", entry.id),
    }
}

/// Extracts a downloaded Kokoro archive next to its final location, then renames it into place
/// so an interrupted extraction never looks installed. The archive is removed afterwards.
pub(crate) fn extract_kokoro_archive(
    entry: &LocalTtsCatalogEntry,
    archive_path: &Path,
) -> Result<(), String> {
    let models_dir = local_models_dir()?;
    let staging_dir = models_dir.join(format!(".extract-{}", entry.id));
    let final_dir = install_root_path(entry)?;
    let _ = std::fs::remove_dir_all(&staging_dir);

    let result = (|| {
        let archive = std::fs::File::open(archive_path)
            .map_err(|e| format!("Failed to open TTS model archive: {e}"))?;
        tar::Archive::new(bzip2::read::BzDecoder::new(std::io::BufReader::new(archive)))
            .unpack(&staging_dir)
            .map_err(|e| format!("Failed to extract TTS model archive: {e}"))?;
        let extracted_dir = staging_dir.join(entry.id);
        if !extracted_dir.is_dir() {
            return Err(format!("TTS model archive is missing the {} directory", entry.id));
        }
        if final_dir.exists() {
            std::fs::remove_dir_all(&final_dir)
                .map_err(|e| format!("Failed to replace TTS model directory: {e}"))?;
        }
        std::fs::rename(&extracted_dir, &final_dir)
            .map_err(|e| format!("Failed to finalize TTS model directory: {e}"))
    })();

    let _ = std::fs::remove_dir_all(&staging_dir);
    let _ = std::fs::remove_file(archive_path);
    result?;
    if !is_entry_installed(entry)? {
        return Err("TTS model archive is missing required Kokoro files".into());
    }
    Ok(())
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
            std::fs::write(path, id).map_err(|e| format!("Failed to save active TTS model: {e}"))?
        }
        _ => {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(())
}

fn config_download_url(entry: &LocalTtsCatalogEntry) -> String {
    format!(
        "{}/{}/{}.json",
        HUGGING_FACE_RESOLVE_ROOT, entry.relative_dir, entry.file_name
    )
}

fn language_matches(entry_language: &str, requested_language: &str) -> bool {
    let requested = match requested_language {
        "zh-TW" | "zh-CN" => "zh-CN",
        "ar-SA" | "ar-JO" => "ar-SA",
        other => other,
    };
    entry_language
        .split(',')
        .any(|language| language.trim() == requested)
}

pub(crate) fn catalog_entry_by_id(model_id: &str) -> Option<&'static LocalTtsCatalogEntry> {
    LOCAL_TTS_CATALOG.iter().find(|entry| entry.id == model_id)
}

pub(crate) fn install_artifacts(
    entry: &LocalTtsCatalogEntry,
) -> Result<Vec<LocalTtsInstallArtifact>, String> {
    Ok(match entry.engine {
        LocalTtsEngine::Piper => vec![
            LocalTtsInstallArtifact {
                path: model_path(entry)?,
                download_url: primary_download_url(entry),
            },
            LocalTtsInstallArtifact {
                path: config_path(entry)?,
                download_url: config_download_url(entry),
            },
        ],
        LocalTtsEngine::Kokoro => vec![LocalTtsInstallArtifact {
            path: local_models_dir()?.join(format!("{}.tar.bz2", entry.id)),
            download_url: primary_download_url(entry),
        }],
    })
}

pub(crate) fn list_local_tts_models() -> Result<Vec<LocalTtsModel>, String> {
    let active_model_id = read_active_model_id();
    LOCAL_TTS_CATALOG
        .iter()
        .map(|entry| {
            let model_path = model_path(entry)?;
            let installed = is_entry_installed(entry)?;
            Ok(LocalTtsModel {
                id: entry.id.to_string(),
                name: entry.name.to_string(),
                description: entry.description.to_string(),
                language: entry.language.to_string(),
                quality: entry.quality.to_string(),
                speaker_count: entry.speaker_count,
                download_url: primary_download_url(entry),
                file_name: entry.file_name.to_string(),
                installed,
                active: installed && active_model_id.as_deref() == Some(entry.id),
                model_path: model_path.to_string_lossy().to_string(),
            })
        })
        .collect()
}

pub(crate) fn delete_local_tts_model(model_id: String) -> Result<(), String> {
    let entry = catalog_entry_by_id(&model_id)
        .ok_or_else(|| format!("Unknown local TTS model id: {model_id}"))?;
    let target_path = install_root_path(entry)?;
    if target_path.exists() {
        std::fs::remove_dir_all(&target_path)
            .map_err(|e| format!("Failed to delete TTS model directory: {e}"))?;
    }
    if read_active_model_id().as_deref() == Some(entry.id) {
        write_active_model_id(None)?;
    }
    Ok(())
}

pub(crate) fn select_local_tts_model(model_id: String) -> Result<String, String> {
    let entry = catalog_entry_by_id(&model_id)
        .ok_or_else(|| format!("Unknown local TTS model id: {model_id}"))?;
    let selected_model_path = model_path(entry)?;
    if !is_entry_installed(entry)? {
        return Err("模型尚未安裝，請先安裝後再選擇。".into());
    }
    write_active_model_id(Some(entry.id))?;
    Ok(selected_model_path.to_string_lossy().to_string())
}

pub(crate) fn preferred_model_path_for_language(
    requested_language: &str,
) -> Result<Option<PathBuf>, String> {
    if let Some(active_model_id) = read_active_model_id() {
        if let Some(entry) = catalog_entry_by_id(&active_model_id) {
            // Kokoro cannot speak languages outside its lexicons; let those fall through
            // to a matching Piper voice.
            let speaks_language = entry.engine == LocalTtsEngine::Piper
                || language_matches(entry.language, requested_language);
            if speaks_language && is_entry_installed(entry)? {
                return Ok(Some(model_path(entry)?));
            }
        }
    }

    for entry in &LOCAL_TTS_CATALOG {
        if language_matches(entry.language, requested_language) && is_entry_installed(entry)? {
            return Ok(Some(model_path(entry)?));
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_artifacts_include_model_and_config() {
        let entry = catalog_entry_by_id("en-us-lessac-medium").expect("english voice");
        let artifacts = install_artifacts(entry).expect("artifacts");
        let file_names: Vec<String> = artifacts
            .iter()
            .map(|artifact| {
                artifact
                    .path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        assert_eq!(
            file_names,
            vec![
                "en_US-lessac-medium.onnx".to_string(),
                "en_US-lessac-medium.onnx.json".to_string()
            ]
        );
    }

    #[test]
    fn kokoro_installs_from_one_archive_and_matches_chinese_and_english() {
        let entry = catalog_entry_by_id("kokoro-int8-multi-lang-v1_1").expect("kokoro entry");
        let artifacts = install_artifacts(entry).expect("artifacts");
        assert_eq!(artifacts.len(), 1);
        assert!(artifacts[0]
            .download_url
            .ends_with("/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2"));
        assert!(language_matches(entry.language, "zh-TW"));
        assert!(language_matches(entry.language, "en-US"));
        assert!(!language_matches(entry.language, "de-DE"));
    }

    #[test]
    fn zh_tw_falls_back_to_zh_cn_catalog() {
        assert!(language_matches("zh-CN", "zh-TW"));
        assert!(language_matches("zh-CN", "zh-CN"));
        assert!(!language_matches("en-US", "zh-TW"));
    }
}

#[cfg(test)]
mod install_tests {
    use super::*;

    /// Installs Kokoro into ~/.neuropen from a local copy of the release archive.
    /// Run with: NEUROPEN_KOKORO_ARCHIVE=<kokoro-int8-multi-lang-v1_1.tar.bz2>
    /// cargo test kokoro_archive_extracts -- --ignored --nocapture
    #[test]
    #[ignore = "requires the Kokoro release archive and writes to ~/.neuropen"]
    fn kokoro_archive_extracts_into_place() {
        let source = std::env::var("NEUROPEN_KOKORO_ARCHIVE").expect("NEUROPEN_KOKORO_ARCHIVE");
        let entry = catalog_entry_by_id("kokoro-int8-multi-lang-v1_1").expect("kokoro entry");
        let archive = install_artifacts(entry).expect("artifacts").remove(0).path;
        std::fs::copy(source, &archive).expect("copy archive");

        extract_kokoro_archive(entry, &archive).expect("extract");

        assert!(is_entry_installed(entry).expect("installed check"));
        assert!(!archive.exists());
        assert!(!local_models_dir()
            .expect("models dir")
            .join(format!(".extract-{}", entry.id))
            .exists());
    }
}
