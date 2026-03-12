//! History module — persists NeuroPen session records to disk.
//!
//! Storage: `%APPDATA%/com.neuropen.app/history.json` (max 200 entries).
//! Each entry captures mode, input, instruction, output, provider/model, timestamp.

use dirs::data_dir;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

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

fn lock_history() -> std::sync::MutexGuard<'static, Option<Vec<HistoryEntry>>> {
    match HISTORY.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("[history] lock poisoned, recovering cached history state");
            poisoned.into_inner()
        }
    }
}

fn ensure_loaded(guard: &mut Option<Vec<HistoryEntry>>) -> &mut Vec<HistoryEntry> {
    if guard.is_none() {
        *guard = Some(load_from_disk());
    }
    let entries = guard.get_or_insert_with(Vec::new);
    if prune_expired(entries) {
        save_to_disk(entries);
    }
    entries
}

fn load_from_disk() -> Vec<HistoryEntry> {
    match fs::read_to_string(&*HISTORY_FILE) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_to_disk(entries: &[HistoryEntry]) {
    if let Some(parent) = HISTORY_FILE.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(entries) {
        let _ = fs::write(&*HISTORY_FILE, text);
    }
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
) {
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
    let entries = ensure_loaded(&mut guard);
    prune_expired(entries);
    entries.insert(0, entry); // newest first
    if entries.len() > MAX_ENTRIES {
        entries.truncate(MAX_ENTRIES);
    }
    save_to_disk(entries);
}

/// Return all history entries (newest first).
pub fn list() -> Vec<HistoryEntry> {
    let mut guard = lock_history();
    ensure_loaded(&mut guard).clone()
}

/// Delete a single entry by id. Returns true if found.
pub fn delete(id: &str) -> bool {
    let mut guard = lock_history();
    let entries = ensure_loaded(&mut guard);
    let before = entries.len();
    entries.retain(|e| e.id != id);
    let removed = entries.len() < before;
    if removed {
        save_to_disk(entries);
    }
    removed
}

/// Update feedback metadata for an entry. Returns true if a matching entry was found.
pub fn set_feedback(
    id: Option<&str>,
    request_id: Option<&str>,
    feedback_rating: FeedbackRating,
    preference_category_key: Option<&str>,
    preference_category_label: Option<&str>,
    quick_action_command_id: Option<&str>,
) -> bool {
    let trimmed_id = id.map(str::trim).filter(|value| !value.is_empty());
    let trimmed_request_id = request_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if trimmed_id.is_none() && trimmed_request_id.is_none() {
        return false;
    }

    let mut guard = lock_history();
    let entries = ensure_loaded(&mut guard);
    let mut updated = false;
    for entry in entries.iter_mut() {
        let matches_id = trimmed_id.is_some_and(|value| entry.id == value);
        let matches_request_id = trimmed_request_id
            .and_then(|value| entry.request_id.as_deref().map(|entry_request_id| entry_request_id == value))
            .unwrap_or(false);
        if !matches_id && !matches_request_id {
            continue;
        }

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
        updated = true;
        break;
    }

    if updated {
        save_to_disk(entries);
    }

    updated
}

/// Clear all history.
pub fn clear_all() {
    let mut guard = lock_history();
    *guard = Some(Vec::new());
    save_to_disk(&[]);
}

/// Toggle the favorited flag on an entry. Returns the new favorited state, or None if not found.
pub fn toggle_favorite(id: &str) -> Option<bool> {
    let mut guard = lock_history();
    let entries = ensure_loaded(&mut guard);
    if let Some(entry) = entries.iter_mut().find(|e| e.id == id) {
        entry.favorited = !entry.favorited;
        let new_state = entry.favorited;
        save_to_disk(entries);
        Some(new_state)
    } else {
        None
    }
}

/// Search history entries — matches input_text, instruction, or output.
pub fn search(query: &str) -> Vec<HistoryEntry> {
    let lower = query.to_lowercase();
    let mut guard = lock_history();
    ensure_loaded(&mut guard)
        .iter()
        .filter(|e| {
            e.input_text.to_lowercase().contains(&lower)
                || e.instruction.to_lowercase().contains(&lower)
                || e.output.to_lowercase().contains(&lower)
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{FeedbackRating, HistoryEntry};

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

        let entry: HistoryEntry = serde_json::from_str(legacy).expect("legacy history should deserialize");
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
        let decoded: FeedbackRating = serde_json::from_str(&encoded).expect("rating should deserialize");
        assert_eq!(decoded, FeedbackRating::Up);
    }
}
