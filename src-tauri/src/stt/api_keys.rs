use std::path::PathBuf;
use std::sync::Mutex;

use super::talkflow_dir;

const KEYRING_SERVICE: &str = "talkflow";
const KEYRING_LLM_USER: &str = "llm-api-key";
const KEYRING_STT_USER: &str = "stt-api-key";

static API_KEY_CACHE: Mutex<Option<String>> = Mutex::new(None);
static STT_API_KEY_CACHE: Mutex<Option<String>> = Mutex::new(None);

fn api_key_file_path() -> Result<PathBuf, String> {
    Ok(talkflow_dir()?.join("api_key"))
}

fn stt_api_key_file_path() -> Result<PathBuf, String> {
    Ok(talkflow_dir()?.join("stt_api_key"))
}

fn keyring_set(user: &str, key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, user)
        .map_err(|e| format!("Credential store error: {e}"))?;
    entry
        .set_password(key)
        .map_err(|e| format!("Failed to save key to credential store: {e}"))
}

fn keyring_get(user: &str) -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, user).ok()?;
    entry.get_password().ok().filter(|k| !k.trim().is_empty())
}

fn keyring_delete(user: &str) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, user) {
        let _ = entry.delete_credential();
    }
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
    if key.is_empty() {
        keyring_delete(KEYRING_LLM_USER);
        if let Ok(path) = api_key_file_path() {
            let _ = std::fs::remove_file(path);
        }
        let mut cache = API_KEY_CACHE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        *cache = None;
    } else {
        keyring_set(KEYRING_LLM_USER, &key)?;
        let mut cache = API_KEY_CACHE.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
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
    if key.is_empty() {
        keyring_delete(KEYRING_STT_USER);
        if let Ok(path) = stt_api_key_file_path() {
            let _ = std::fs::remove_file(path);
        }
        let mut cache = STT_API_KEY_CACHE
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        *cache = None;
    } else {
        keyring_set(KEYRING_STT_USER, &key)?;
        let mut cache = STT_API_KEY_CACHE
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
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
    Err("未設定 Whisper STT API Key。請在設定中填入 STT API Key。".to_string())
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
