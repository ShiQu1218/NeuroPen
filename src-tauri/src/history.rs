//! History module — persists NeuroPen session records to disk.
//!
//! Storage: `%APPDATA%/com.neuropen.app/history.json` (max 200 entries).
//! Each entry captures mode, input, instruction, output, provider/model, timestamp.

use dirs::data_dir;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FeedbackRating {
    Up,
    Down,
}

/// One recorded interaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    /// Unix timestamp (seconds)
    pub timestamp: i64,
    /// "A" | "B1" | "B2" | "C"
    pub mode: String,
    /// Selected text or STT transcript
    pub input_text: String,
    /// User instruction (Mode B/C); empty for Mode A
    pub instruction: String,
    /// LLM reply or STT result
    pub output: String,
    /// LLM provider name
    pub provider: String,
    /// Model name
    pub model: String,
    /// Whether the entry is favorited (exempt from auto-pruning)
    #[serde(default)]
    pub favorited: bool,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub feedback_rating: Option<FeedbackRating>,
    #[serde(default)]
    pub preference_category_key: Option<String>,
    #[serde(default)]
    pub preference_category_label: Option<String>,
    #[serde(default)]
    pub quick_action_command_id: Option<String>,
}

const MAX_ENTRIES: usize = 200;
const HISTORY_RETENTION_DAYS: i64 = 30;

static HISTORY_FILE: Lazy<PathBuf> = Lazy::new(|| {
    let mut p = data_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("com.neuropen.app");
    p.push("history.json");
    p
});

static HISTORY: Mutex<Option<Vec<HistoryEntry>>> = Mutex::new(None);

fn atomic_write_backup_path(path: &Path) -> PathBuf {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| format!("{extension}.bak"))
        .unwrap_or_else(|| "bak".to_string());
    path.with_extension(extension)
}

fn atomic_write_temp_path(path: &Path) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("data");
    path.with_file_name(format!(".{file_name}.{}.{}.tmp", std::process::id(), nonce))
}

/// Recovers the prior complete value if the process stopped after moving it to
/// the backup but before installing the synced replacement.
pub(crate) fn recover_atomic_write(path: &Path) -> io::Result<()> {
    let backup_path = atomic_write_backup_path(path);
    match (path.exists(), backup_path.exists()) {
        (false, true) => fs::rename(backup_path, path),
        // The replacement was installed before the interruption, so it is the
        // authoritative value. Remove the now-stale previous version.
        (true, true) => fs::remove_file(backup_path),
        _ => Ok(()),
    }
}

/// Writes a replacement through a synced temporary file, without truncating
/// the previous persisted value if an I/O failure occurs.
pub(crate) fn atomic_write_file(path: &Path, contents: &[u8]) -> io::Result<()> {
    recover_atomic_write(path)?;

    let temp_path = atomic_write_temp_path(path);
    let backup_path = atomic_write_backup_path(path);
    let write_result = (|| -> io::Result<()> {
        let mut temp_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        temp_file.write_all(contents)?;
        temp_file.sync_all()?;
        drop(temp_file);

        let had_existing = path.exists();
        if had_existing {
            fs::rename(path, &backup_path)?;
        }

        if let Err(error) = fs::rename(&temp_path, path) {
            if had_existing {
                let _ = fs::rename(&backup_path, path);
            }
            return Err(error);
        }

        if had_existing {
            let _ = fs::remove_file(&backup_path);
        }
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

fn lock_history() -> std::sync::MutexGuard<'static, Option<Vec<HistoryEntry>>> {
    match HISTORY.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("[history] lock poisoned, recovering cached history state");
            poisoned.into_inner()
        }
    }
}

fn ensure_loaded(guard: &mut Option<Vec<HistoryEntry>>) -> Result<&mut Vec<HistoryEntry>, String> {
    if guard.is_none() {
        let mut entries = load_from_disk()?;
        if prune_expired(&mut entries) {
            save_to_disk(&entries)?;
        }
        *guard = Some(entries);
    }
    Ok(guard.get_or_insert_with(Vec::new))
}

fn load_from_disk() -> Result<Vec<HistoryEntry>, String> {
    recover_atomic_write(&HISTORY_FILE)
        .map_err(|error| format!("Failed to recover history data: {error}"))?;
    match fs::read_to_string(&*HISTORY_FILE) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|error| format!("Failed to parse history data: {error}")),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("Failed to read history data: {error}")),
    }
}

fn save_to_disk(entries: &[HistoryEntry]) -> Result<(), String> {
    if let Some(parent) = HISTORY_FILE.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create history directory: {error}"))?;
    }
    let text = serde_json::to_string_pretty(entries)
        .map_err(|error| format!("Failed to serialize history data: {error}"))?;
    atomic_write_file(&HISTORY_FILE, text.as_bytes())
        .map_err(|error| format!("Failed to save history data: {error}"))
}

fn persist_mutation<T, R>(
    state: &mut T,
    mutate: impl FnOnce(&mut T) -> R,
    persist: impl FnOnce(&T) -> Result<(), String>,
) -> Result<R, String>
where
    T: Clone,
{
    let previous = state.clone();
    let result = mutate(state);
    if let Err(error) = persist(state) {
        *state = previous;
        return Err(error);
    }
    Ok(result)
}

fn unique_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{ts}-{nanos:09}")
}

fn unix_now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn prune_expired(entries: &mut Vec<HistoryEntry>) -> bool {
    let cutoff = unix_now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60;
    let before = entries.len();
    entries.retain(|entry| entry.favorited || entry.timestamp >= cutoff);
    entries.len() != before
}

/// Append a new history entry. Automatically truncates to `MAX_ENTRIES`.
pub fn save(
    mode: &str,
    input_text: &str,
    instruction: &str,
    output: &str,
    provider: &str,
    model: &str,
    request_id: Option<&str>,
    preference_category_key: Option<&str>,
    preference_category_label: Option<&str>,
    quick_action_command_id: Option<&str>,
) -> Result<(), String> {
    let entry = HistoryEntry {
        id: unique_id(),
        timestamp: unix_now(),
        mode: mode.to_string(),
        input_text: input_text.to_string(),
        instruction: instruction.to_string(),
        output: output.to_string(),
        provider: provider.to_string(),
        model: model.to_string(),
        favorited: false,
        request_id: request_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string()),
        feedback_rating: None,
        preference_category_key: preference_category_key
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string()),
        preference_category_label: preference_category_label
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string()),
        quick_action_command_id: quick_action_command_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string()),
    };

    let mut guard = lock_history();
    let entries = ensure_loaded(&mut guard)?;
    persist_mutation(
        entries,
        |entries| {
            prune_expired(entries);
            entries.insert(0, entry); // newest first
            if entries.len() > MAX_ENTRIES {
                entries.truncate(MAX_ENTRIES);
            }
        },
        |entries| save_to_disk(entries),
    )
}

/// Return all history entries (newest first).
pub fn list() -> Result<Vec<HistoryEntry>, String> {
    let mut guard = lock_history();
    Ok(ensure_loaded(&mut guard)?.clone())
}

/// Delete a single entry by id. Returns true if found.
pub fn delete(id: &str) -> Result<bool, String> {
    let mut guard = lock_history();
    let entries = ensure_loaded(&mut guard)?;
    if !entries.iter().any(|entry| entry.id == id) {
        return Ok(false);
    }
    persist_mutation(
        entries,
        |entries| {
            entries.retain(|entry| entry.id != id);
            true
        },
        |entries| save_to_disk(entries),
    )
}

/// Update feedback metadata for an entry. Returns true if a matching entry was found.
pub fn set_feedback(
    id: Option<&str>,
    request_id: Option<&str>,
    feedback_rating: FeedbackRating,
    preference_category_key: Option<&str>,
    preference_category_label: Option<&str>,
    quick_action_command_id: Option<&str>,
) -> Result<bool, String> {
    let trimmed_id = id.map(str::trim).filter(|value| !value.is_empty());
    let trimmed_request_id = request_id.map(str::trim).filter(|value| !value.is_empty());
    if trimmed_id.is_none() && trimmed_request_id.is_none() {
        return Ok(false);
    }

    let mut guard = lock_history();
    let entries = ensure_loaded(&mut guard)?;
    let Some(entry_index) = entries.iter().position(|entry| {
        let matches_id = trimmed_id.is_some_and(|value| entry.id == value);
        let matches_request_id = trimmed_request_id
            .and_then(|value| {
                entry
                    .request_id
                    .as_deref()
                    .map(|entry_request_id| entry_request_id == value)
            })
            .unwrap_or(false);
        matches_id || matches_request_id
    }) else {
        return Ok(false);
    };

    persist_mutation(
        entries,
        |entries| {
            let entry = &mut entries[entry_index];
            entry.feedback_rating = Some(feedback_rating);
            if let Some(value) = trimmed_request_id {
                entry.request_id = Some(value.to_string());
            }
            entry.preference_category_key = preference_category_key
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .or_else(|| entry.preference_category_key.clone());
            entry.preference_category_label = preference_category_label
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .or_else(|| entry.preference_category_label.clone());
            entry.quick_action_command_id = quick_action_command_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .or_else(|| entry.quick_action_command_id.clone());
            true
        },
        |entries| save_to_disk(entries),
    )
}

/// Clear all history.
pub fn clear_all() -> Result<(), String> {
    let mut guard = lock_history();
    let entries = ensure_loaded(&mut guard)?;
    if entries.is_empty() {
        return Ok(());
    }
    persist_mutation(
        entries,
        |entries| entries.clear(),
        |entries| save_to_disk(entries),
    )
}

/// Toggle the favorited flag on an entry. Returns the new favorited state, or None if not found.
pub fn toggle_favorite(id: &str) -> Result<Option<bool>, String> {
    let mut guard = lock_history();
    let entries = ensure_loaded(&mut guard)?;
    let Some(entry_index) = entries.iter().position(|entry| entry.id == id) else {
        return Ok(None);
    };
    persist_mutation(
        entries,
        |entries| {
            let entry = &mut entries[entry_index];
            entry.favorited = !entry.favorited;
            Some(entry.favorited)
        },
        |entries| save_to_disk(entries),
    )
}

/// Search history entries — matches input_text, instruction, or output.
pub fn search(query: &str) -> Result<Vec<HistoryEntry>, String> {
    let lower = query.to_lowercase();
    let mut guard = lock_history();
    Ok(ensure_loaded(&mut guard)?
        .iter()
        .filter(|e| {
            e.input_text.to_lowercase().contains(&lower)
                || e.instruction.to_lowercase().contains(&lower)
                || e.output.to_lowercase().contains(&lower)
        })
        .cloned()
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{
        atomic_write_backup_path, atomic_write_file, persist_mutation, recover_atomic_write,
        FeedbackRating, HistoryEntry,
    };
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn atomic_write_replaces_data_and_recovers_interrupted_install() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "neuropen-history-atomic-write-{}-{nonce}",
            std::process::id()
        ));
        let path = directory.join("history.json");
        fs::create_dir_all(&directory).expect("temporary directory should be created");
        fs::write(&path, "before").expect("initial data should be written");

        atomic_write_file(&path, b"after").expect("replacement should be written atomically");
        assert_eq!(fs::read_to_string(&path).unwrap(), "after");
        assert!(!atomic_write_backup_path(&path).exists());

        let backup = atomic_write_backup_path(&path);
        fs::write(&backup, "before").expect("backup should simulate interrupted install");
        fs::remove_file(&path).expect("primary should be removed for recovery simulation");
        recover_atomic_write(&path).expect("backup should be restored when primary is absent");
        assert_eq!(fs::read_to_string(&path).unwrap(), "before");

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn history_entry_deserializes_without_preference_fields() {
        let legacy = r#"{
          "id": "legacy-1",
          "timestamp": 1710000000,
          "mode": "C",
          "inputText": "",
          "instruction": "Explain this",
          "output": "Answer",
          "provider": "openAi",
          "model": "gpt-4o-mini",
          "favorited": false
        }"#;

        let entry: HistoryEntry =
            serde_json::from_str(legacy).expect("legacy history should deserialize");
        assert_eq!(entry.request_id, None);
        assert_eq!(entry.feedback_rating, None);
        assert_eq!(entry.preference_category_key, None);
        assert_eq!(entry.preference_category_label, None);
        assert_eq!(entry.quick_action_command_id, None);
    }

    #[test]
    fn feedback_rating_round_trips() {
        let encoded = serde_json::to_string(&FeedbackRating::Up).expect("rating should serialize");
        assert_eq!(encoded, "\"up\"");
        let decoded: FeedbackRating =
            serde_json::from_str(&encoded).expect("rating should deserialize");
        assert_eq!(decoded, FeedbackRating::Up);
    }

    #[test]
    fn failed_persistence_rolls_back_history_mutation() {
        let mut entries = vec!["before".to_string()];
        let result = persist_mutation(
            &mut entries,
            |entries| entries.push("after".to_string()),
            |_| Err("write failed".to_string()),
        );

        assert_eq!(result, Err("write failed".to_string()));
        assert_eq!(entries, vec!["before".to_string()]);
    }
}
