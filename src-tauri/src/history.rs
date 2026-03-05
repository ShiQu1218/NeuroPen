//! History module — persists TalkFlow session records to disk.
//!
//! Storage: `%APPDATA%/com.talkflow.app/history.json` (max 200 entries).
//! Each entry captures mode, input, instruction, output, provider/model, timestamp.

use dirs::data_dir;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

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
}

const MAX_ENTRIES: usize = 200;

static HISTORY_FILE: Lazy<PathBuf> = Lazy::new(|| {
    let mut p = data_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("com.talkflow.app");
    p.push("history.json");
    p
});

static HISTORY: Mutex<Option<Vec<HistoryEntry>>> = Mutex::new(None);

fn ensure_loaded(guard: &mut Option<Vec<HistoryEntry>>) {
    if guard.is_none() {
        *guard = Some(load_from_disk());
    }
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

/// Append a new history entry. Automatically truncates to `MAX_ENTRIES`.
pub fn save(
    mode: &str,
    input_text: &str,
    instruction: &str,
    output: &str,
    provider: &str,
    model: &str,
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
    };

    let mut guard = HISTORY.lock().expect("history lock poisoned");
    ensure_loaded(&mut *guard);
    let entries = guard.as_mut().unwrap();
    entries.insert(0, entry); // newest first
    if entries.len() > MAX_ENTRIES {
        entries.truncate(MAX_ENTRIES);
    }
    save_to_disk(entries);
}

/// Return all history entries (newest first).
pub fn list() -> Vec<HistoryEntry> {
    let mut guard = HISTORY.lock().expect("history lock poisoned");
    ensure_loaded(&mut *guard);
    guard.as_ref().unwrap().clone()
}

/// Delete a single entry by id. Returns true if found.
pub fn delete(id: &str) -> bool {
    let mut guard = HISTORY.lock().expect("history lock poisoned");
    ensure_loaded(&mut *guard);
    let entries = guard.as_mut().unwrap();
    let before = entries.len();
    entries.retain(|e| e.id != id);
    let removed = entries.len() < before;
    if removed {
        save_to_disk(entries);
    }
    removed
}

/// Clear all history.
pub fn clear_all() {
    let mut guard = HISTORY.lock().expect("history lock poisoned");
    *guard = Some(Vec::new());
    save_to_disk(&[]);
}

/// Search history entries — matches input_text, instruction, or output.
pub fn search(query: &str) -> Vec<HistoryEntry> {
    let lower = query.to_lowercase();
    let mut guard = HISTORY.lock().expect("history lock poisoned");
    ensure_loaded(&mut *guard);
    guard
        .as_ref()
        .unwrap()
        .iter()
        .filter(|e| {
            e.input_text.to_lowercase().contains(&lower)
                || e.instruction.to_lowercase().contains(&lower)
                || e.output.to_lowercase().contains(&lower)
        })
        .cloned()
        .collect()
}
