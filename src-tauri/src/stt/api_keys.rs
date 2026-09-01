use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::neuropen_dir;

const KEYRING_SERVICE: &str = "neuropen";
const KEYRING_LLM_USER: &str = "llm-api-key";
const KEYRING_STT_USER: &str = "stt-api-key";

static API_KEY_CACHE: Mutex<Option<String>> = Mutex::new(None);
static STT_API_KEY_CACHE: Mutex<Option<String>> = Mutex::new(None);

fn api_key_file_path() -> Result<PathBuf, String> {
    Ok(neuropen_dir()?.join("api_key"))
}

fn stt_api_key_file_path() -> Result<PathBuf, String> {
    Ok(neuropen_dir()?.join("stt_api_key"))
}

fn keyring_set(user: &str, key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, user)
        .map_err(|e| format!("Credential store error: {e}"))?;
    entry
        .set_password(key)
        .map_err(|e| format!("Failed to save key to credential store: {e}"))
}

fn keyring_read(user: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, user)
        .map_err(|error| format!("Credential store error: {error}"))?;
    match entry.get_password() {
        Ok(key) => {
            let key = key.trim().to_string();
            Ok((!key.is_empty()).then_some(key))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read key from credential store: {error}")),
    }
}

fn keyring_get(user: &str) -> Option<String> {
    keyring_read(user).ok().flatten()
}

fn keyring_delete(user: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, user)
        .map_err(|error| format!("Credential store error: {error}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Failed to clear key from credential store: {error}"
        )),
    }
}

fn remove_key_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to remove legacy API key file: {error}")),
    }
}

fn restore_keyring_value(user: &str, previous_key: Option<&str>) -> Result<(), String> {
    match previous_key {
        Some(key) => keyring_set(user, key),
        None => keyring_delete(user),
    }
}

fn persist_key_and_remove_legacy(
    user: &str,
    legacy_path: &Path,
    key: Option<&str>,
) -> Result<(), String> {
    let previous_key = keyring_read(user)?;

    match key {
        Some(key) => keyring_set(user, key)?,
        None => keyring_delete(user)?,
    }

    if let Err(error) = remove_key_file(legacy_path) {
        return match restore_keyring_value(user, previous_key.as_deref()) {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!(
                "{error}; failed to restore the previous credential: {rollback_error}"
            )),
        };
    }

    Ok(())
}

fn migrate_key_file_to_keyring(file_path: &std::path::Path, keyring_user: &str) {
    if let Ok(contents) = std::fs::read_to_string(file_path) {
        let key = contents.trim().to_string();
        if !key.is_empty() && keyring_set(keyring_user, &key).is_ok() {
            let _ = std::fs::remove_file(file_path);
        }
    }
}

pub(crate) fn set_api_key(key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    let path = api_key_file_path()?;
    let mut cache = API_KEY_CACHE
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    if key.is_empty() {
        persist_key_and_remove_legacy(KEYRING_LLM_USER, &path, None)?;
        *cache = None;
    } else {
        persist_key_and_remove_legacy(KEYRING_LLM_USER, &path, Some(&key))?;
        *cache = Some(key);
    }
    Ok(())
}

pub(crate) fn has_api_key() -> bool {
    if let Ok(guard) = API_KEY_CACHE.lock() {
        if guard.is_some() {
            return true;
        }
    }
    get_api_key().is_ok()
}

pub(crate) fn set_stt_api_key(key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    let path = stt_api_key_file_path()?;
    let mut cache = STT_API_KEY_CACHE
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    if key.is_empty() {
        persist_key_and_remove_legacy(KEYRING_STT_USER, &path, None)?;
        *cache = None;
    } else {
        persist_key_and_remove_legacy(KEYRING_STT_USER, &path, Some(&key))?;
        *cache = Some(key);
    }
    Ok(())
}

pub(crate) fn has_stt_api_key() -> bool {
    if let Ok(guard) = STT_API_KEY_CACHE.lock() {
        if guard.is_some() {
            return true;
        }
    }
    get_stt_api_key().is_ok()
}

pub(crate) fn get_stt_api_key() -> Result<String, String> {
    if let Ok(guard) = STT_API_KEY_CACHE.lock() {
        if let Some(ref key) = *guard {
            return Ok(key.clone());
        }
    }
    if let Some(key) = keyring_get(KEYRING_STT_USER) {
        if let Ok(mut cache) = STT_API_KEY_CACHE.lock() {
            *cache = Some(key.clone());
        }
        return Ok(key);
    }
    if let Ok(path) = stt_api_key_file_path() {
        if path.is_file() {
            migrate_key_file_to_keyring(&path, KEYRING_STT_USER);
            if let Some(key) = keyring_get(KEYRING_STT_USER) {
                if let Ok(mut cache) = STT_API_KEY_CACHE.lock() {
                    *cache = Some(key.clone());
                }
                return Ok(key);
            }
        }
    }
    Err("未設定 OpenAI STT API Key。請在設定中填入 STT API Key。".to_string())
}

pub(crate) fn get_api_key() -> Result<String, String> {
    if let Ok(guard) = API_KEY_CACHE.lock() {
        if let Some(ref key) = *guard {
            return Ok(key.clone());
        }
    }
    if let Some(key) = keyring_get(KEYRING_LLM_USER) {
        if let Ok(mut cache) = API_KEY_CACHE.lock() {
            *cache = Some(key.clone());
        }
        return Ok(key);
    }
    if let Ok(path) = api_key_file_path() {
        if path.is_file() {
            migrate_key_file_to_keyring(&path, KEYRING_LLM_USER);
            if let Some(key) = keyring_get(KEYRING_LLM_USER) {
                if let Ok(mut cache) = API_KEY_CACHE.lock() {
                    *cache = Some(key.clone());
                }
                return Ok(key);
            }
        }
    }
    Err("未設定 OpenAI API Key。請在設定中填入 API Key。".to_string())
}
