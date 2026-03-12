use crate::history::{self, FeedbackRating};
use crate::llm::{self, LlmProvider};
use crate::stt;
use dirs::data_dir;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

const SUMMARY_BATCH_SIZE: usize = 10;
const UPDATE_BATCH_SIZE: usize = 9;
const DEFAULT_APP_LANGUAGE: &str = "zh-TW";
const MAX_SUMMARY_WORDS: usize = 500;
const FEEDBACK_FIELD_LIMIT: usize = 900;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceFeedbackEntry {
    pub id: String,
    pub request_id: String,
    pub timestamp: i64,
    pub mode: String,
    pub input_text: String,
    pub instruction: String,
    pub output: String,
    pub output_provider: String,
    pub output_model: String,
    pub category_key: String,
    pub category_label: String,
    pub quick_action_command_id: Option<String>,
    pub rating: FeedbackRating,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceSummaryEntry {
    pub category_key: String,
    pub category_label: String,
    pub quick_action_command_id: Option<String>,
    pub summary: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreferenceLearningStore {
    #[serde(default)]
    summaries: Vec<PreferenceSummaryEntry>,
    #[serde(default)]
    pending_feedback: Vec<PreferenceFeedbackEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceSummaryView {
    pub category_key: String,
    pub category_label: String,
    pub quick_action_command_id: Option<String>,
    pub summary: Option<String>,
    pub updated_at: Option<i64>,
    pub pending_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceRatePayload {
    pub history_id: Option<String>,
    pub request_id: String,
    pub rating: FeedbackRating,
    pub mode: String,
    pub input_text: String,
    pub instruction: String,
    pub output: String,
    pub output_provider: Option<String>,
    pub output_model: Option<String>,
    pub category_key: String,
    pub category_label: String,
    pub quick_action_command_id: Option<String>,
    pub analysis_provider: LlmProvider,
    pub analysis_model: String,
    pub app_language: Option<String>,
}

#[derive(Debug, Clone)]
struct AnalysisSnapshot {
    category_key: String,
    category_label: String,
    quick_action_command_id: Option<String>,
    existing_summary: Option<String>,
    feedback_entries: Vec<PreferenceFeedbackEntry>,
    request_ids: HashSet<String>,
    analysis_provider: LlmProvider,
    analysis_model: String,
    app_language: String,
}

static PREFERENCE_FILE: Lazy<PathBuf> = Lazy::new(|| {
    let mut p = data_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("com.neuropen.app");
    p.push("preference_learning.json");
    p
});

static PREFERENCE_STORE: Mutex<Option<PreferenceLearningStore>> = Mutex::new(None);

fn lock_store() -> std::sync::MutexGuard<'static, Option<PreferenceLearningStore>> {
    match PREFERENCE_STORE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("[preference_learning] lock poisoned, recovering cached preference state");
            poisoned.into_inner()
        }
    }
}

fn ensure_loaded(
    guard: &mut Option<PreferenceLearningStore>,
) -> &mut PreferenceLearningStore {
    if guard.is_none() {
        *guard = Some(load_from_disk());
    }
    guard.get_or_insert_with(PreferenceLearningStore::default)
}

fn load_from_disk() -> PreferenceLearningStore {
    match fs::read_to_string(&*PREFERENCE_FILE) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => PreferenceLearningStore::default(),
    }
}

fn save_to_disk(store: &PreferenceLearningStore) {
    if let Some(parent) = PREFERENCE_FILE.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(store) {
        let _ = fs::write(&*PREFERENCE_FILE, text);
    }
}

fn unique_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("pref-{}-{:09}", now.as_secs(), now.subsec_nanos())
}

fn unix_now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn normalize_required(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} is required"));
    }
    Ok(trimmed.to_string())
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(|candidate| candidate.to_string())
}

fn category_threshold(has_summary: bool) -> usize {
    if has_summary {
        UPDATE_BATCH_SIZE
    } else {
        SUMMARY_BATCH_SIZE
    }
}

fn upsert_pending_feedback(
    store: &mut PreferenceLearningStore,
    payload: &PreferenceRatePayload,
) -> Result<(), String> {
    let request_id = normalize_required(&payload.request_id, "requestId")?;
    let category_key = normalize_required(&payload.category_key, "categoryKey")?;
    let category_label = normalize_required(&payload.category_label, "categoryLabel")?;
    let timestamp = unix_now();

    if let Some(existing) = store
        .pending_feedback
        .iter_mut()
        .find(|entry| entry.request_id == request_id)
    {
        existing.timestamp = timestamp;
        existing.mode = payload.mode.trim().to_string();
        existing.input_text = payload.input_text.clone();
        existing.instruction = payload.instruction.clone();
        existing.output = payload.output.clone();
        existing.output_provider = payload
            .output_provider
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_string();
        existing.output_model = payload
            .output_model
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_string();
        existing.category_key = category_key;
        existing.category_label = category_label;
        existing.quick_action_command_id = normalize_optional(payload.quick_action_command_id.as_deref());
        existing.rating = payload.rating;
        return Ok(());
    }

    store.pending_feedback.push(PreferenceFeedbackEntry {
        id: unique_id(),
        request_id,
        timestamp,
        mode: payload.mode.trim().to_string(),
        input_text: payload.input_text.clone(),
        instruction: payload.instruction.clone(),
        output: payload.output.clone(),
        output_provider: payload
            .output_provider
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_string(),
        output_model: payload
            .output_model
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_string(),
        category_key,
        category_label,
        quick_action_command_id: normalize_optional(payload.quick_action_command_id.as_deref()),
        rating: payload.rating,
    });

    Ok(())
}

fn build_analysis_snapshot(
    store: &PreferenceLearningStore,
    payload: &PreferenceRatePayload,
) -> Option<AnalysisSnapshot> {
    let category_key = payload.category_key.trim();
    if category_key.is_empty() {
        return None;
    }

    let existing_summary = store
        .summaries
        .iter()
        .find(|summary| summary.category_key == category_key)
        .cloned();
    let feedback_entries = store
        .pending_feedback
        .iter()
        .filter(|entry| entry.category_key == category_key)
        .cloned()
        .collect::<Vec<_>>();
    if feedback_entries.len() < category_threshold(existing_summary.is_some()) {
        return None;
    }

    let latest_feedback = feedback_entries.iter().max_by_key(|entry| entry.timestamp);
    Some(AnalysisSnapshot {
        category_key: category_key.to_string(),
        category_label: payload
            .category_label
            .trim()
            .to_string(),
        quick_action_command_id: normalize_optional(payload.quick_action_command_id.as_deref())
            .or_else(|| latest_feedback.and_then(|entry| entry.quick_action_command_id.clone()))
            .or_else(|| existing_summary.as_ref().and_then(|summary| summary.quick_action_command_id.clone())),
        existing_summary: existing_summary.as_ref().map(|summary| summary.summary.clone()),
        request_ids: feedback_entries
            .iter()
            .map(|entry| entry.request_id.clone())
            .collect::<HashSet<_>>(),
        feedback_entries,
        analysis_provider: payload.analysis_provider.clone(),
        analysis_model: payload.analysis_model.trim().to_string(),
        app_language: normalize_optional(payload.app_language.as_deref())
            .unwrap_or_else(|| DEFAULT_APP_LANGUAGE.to_string()),
    })
}

fn truncate_feedback_text(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= FEEDBACK_FIELD_LIMIT {
        return trimmed.to_string();
    }
    let mut out = String::new();
    for (index, ch) in trimmed.chars().enumerate() {
        if index >= FEEDBACK_FIELD_LIMIT {
            break;
        }
        out.push(ch);
    }
    format!("{out}…")
}

fn app_language_name(code: &str) -> &str {
    match code {
        "zh-TW" => "Traditional Chinese",
        "zh-CN" => "Simplified Chinese",
        "en-US" => "English",
        "ja-JP" => "Japanese",
        "es-ES" => "Spanish",
        "ko-KR" => "Korean",
        "de-DE" => "German",
        "fr-FR" => "French",
        "ar-SA" => "Arabic",
        "ru-RU" => "Russian",
        _ => "English",
    }
}

fn build_analysis_prompt(snapshot: &AnalysisSnapshot) -> (String, String) {
    let system_prompt = format!(
        "You analyze a user's preferences for AI-generated text output. \
         Write the final summary in {}. \
         Return plain text only. Do not use markdown, bullet lists, code fences, or headings. \
         Keep the summary at or below {} words. \
         Make the preference signal explicit by covering what the user tends to prefer and what the user tends to dislike. \
         Focus only on output style and behavior: structure, tone, formatting, verbosity, translation direction, faithfulness, clarity, and whether the reply should transform text or answer directly. \
         Do not mention the batch process or individual record numbers.",
        app_language_name(&snapshot.app_language),
        MAX_SUMMARY_WORDS,
    );
    let existing_summary = snapshot
        .existing_summary
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("None yet.");
    let feedback_text = snapshot
        .feedback_entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let rating = match entry.rating {
                FeedbackRating::Up => "thumbs up",
                FeedbackRating::Down => "thumbs down",
            };
            format!(
                "Feedback {} ({rating})\nMode: {}\nInput: {}\nInstruction: {}\nOutput: {}\n",
                index + 1,
                entry.mode,
                truncate_feedback_text(&entry.input_text),
                truncate_feedback_text(&entry.instruction),
                truncate_feedback_text(&entry.output),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let user_message = format!(
        "Category: {}\nExisting preference summary:\n{}\n\nNew rated feedback:\n{}\n\nWrite a single plain-text preference summary for future prompts. The summary must remain useful on its own without referencing specific records.",
        snapshot.category_label,
        existing_summary,
        feedback_text,
    );
    (system_prompt, user_message)
}

fn normalize_summary(summary: &str) -> String {
    let normalized = summary
        .replace('\r', "\n")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| {
            line.trim_start_matches("- ")
                .trim_start_matches("* ")
                .trim_start()
                .to_string()
        })
        .collect::<Vec<_>>()
        .join(" ");

    let mut words = normalized.split_whitespace();
    let truncated = words
        .by_ref()
        .take(MAX_SUMMARY_WORDS)
        .collect::<Vec<_>>()
        .join(" ");
    truncated.trim().to_string()
}

async fn analyze_snapshot(snapshot: &AnalysisSnapshot) -> Result<String, String> {
    let api_key = if matches!(snapshot.analysis_provider, LlmProvider::Ollama) {
        String::new()
    } else {
        stt::get_api_key()?
    };
    let (system_prompt, user_message) = build_analysis_prompt(snapshot);
    let summary = llm::call_custom_prompt_text(
        &api_key,
        snapshot.analysis_provider.clone(),
        &snapshot.analysis_model,
        &system_prompt,
        &user_message,
    )
    .await?;
    let normalized = normalize_summary(&summary);
    if normalized.is_empty() {
        return Err("Preference analysis returned an empty summary".to_string());
    }
    Ok(normalized)
}

fn apply_analysis_result(
    store: &mut PreferenceLearningStore,
    snapshot: &AnalysisSnapshot,
    summary: String,
) {
    store.pending_feedback.retain(|entry| {
        entry.category_key != snapshot.category_key || !snapshot.request_ids.contains(&entry.request_id)
    });

    if let Some(existing) = store
        .summaries
        .iter_mut()
        .find(|entry| entry.category_key == snapshot.category_key)
    {
        existing.category_label = snapshot.category_label.clone();
        existing.quick_action_command_id = snapshot.quick_action_command_id.clone();
        existing.summary = summary;
        existing.updated_at = unix_now();
        return;
    }

    store.summaries.push(PreferenceSummaryEntry {
        category_key: snapshot.category_key.clone(),
        category_label: snapshot.category_label.clone(),
        quick_action_command_id: snapshot.quick_action_command_id.clone(),
        summary,
        updated_at: unix_now(),
    });
}

pub async fn rate_result(payload: PreferenceRatePayload) -> Result<(), String> {
    let snapshot = {
        let mut guard = lock_store();
        let store = ensure_loaded(&mut guard);
        upsert_pending_feedback(store, &payload)?;
        save_to_disk(store);
        build_analysis_snapshot(store, &payload)
    };

    let _ = history::set_feedback(
        payload.history_id.as_deref(),
        Some(payload.request_id.as_str()),
        payload.rating,
        Some(payload.category_key.as_str()),
        Some(payload.category_label.as_str()),
        payload.quick_action_command_id.as_deref(),
    );

    let Some(snapshot) = snapshot else {
        return Ok(());
    };

    match analyze_snapshot(&snapshot).await {
        Ok(summary) => {
            let mut guard = lock_store();
            let store = ensure_loaded(&mut guard);
            apply_analysis_result(store, &snapshot, summary);
            save_to_disk(store);
        }
        Err(error) => {
            eprintln!(
                "[preference_learning] analysis failed for category {}: {}",
                snapshot.category_key, error
            );
        }
    }

    Ok(())
}

pub fn list_summaries() -> Vec<PreferenceSummaryView> {
    let mut guard = lock_store();
    let store = ensure_loaded(&mut guard);

    let mut pending_counts = HashMap::<String, usize>::new();
    let mut pending_labels = HashMap::<String, (String, Option<String>)>::new();
    for entry in &store.pending_feedback {
        *pending_counts.entry(entry.category_key.clone()).or_insert(0) += 1;
        pending_labels.insert(
            entry.category_key.clone(),
            (entry.category_label.clone(), entry.quick_action_command_id.clone()),
        );
    }

    let mut views = HashMap::<String, PreferenceSummaryView>::new();
    for summary in &store.summaries {
        views.insert(
            summary.category_key.clone(),
            PreferenceSummaryView {
                category_key: summary.category_key.clone(),
                category_label: summary.category_label.clone(),
                quick_action_command_id: summary.quick_action_command_id.clone(),
                summary: Some(summary.summary.clone()),
                updated_at: Some(summary.updated_at),
                pending_count: *pending_counts.get(&summary.category_key).unwrap_or(&0),
            },
        );
    }

    for (category_key, pending_count) in pending_counts {
        views.entry(category_key.clone()).or_insert_with(|| {
            let (category_label, quick_action_command_id) = pending_labels
                .get(&category_key)
                .cloned()
                .unwrap_or_else(|| (category_key.clone(), None));
            PreferenceSummaryView {
                category_key,
                category_label,
                quick_action_command_id,
                summary: None,
                updated_at: None,
                pending_count,
            }
        });
    }

    let mut items = views.into_values().collect::<Vec<_>>();
    items.sort_by(|left, right| {
        left.category_label
            .to_lowercase()
            .cmp(&right.category_label.to_lowercase())
            .then_with(|| left.category_key.cmp(&right.category_key))
    });
    items
}

pub fn get_summary(category_key: &str) -> Option<String> {
    let trimmed = category_key.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut guard = lock_store();
    let store = ensure_loaded(&mut guard);
    store
        .summaries
        .iter()
        .find(|entry| entry.category_key == trimmed)
        .map(|entry| entry.summary.clone())
}

pub fn clear_summary(category_key: &str) -> bool {
    let trimmed = category_key.trim();
    if trimmed.is_empty() {
        return false;
    }

    let mut guard = lock_store();
    let store = ensure_loaded(&mut guard);
    let before_summaries = store.summaries.len();
    let before_pending = store.pending_feedback.len();
    store
        .summaries
        .retain(|entry| entry.category_key != trimmed);
    store
        .pending_feedback
        .retain(|entry| entry.category_key != trimmed);
    let changed = store.summaries.len() != before_summaries || store.pending_feedback.len() != before_pending;
    if changed {
        save_to_disk(store);
    }
    changed
}

pub fn clear_all() {
    let mut guard = lock_store();
    *guard = Some(PreferenceLearningStore::default());
    save_to_disk(&PreferenceLearningStore::default());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload(category_key: &str, request_id: &str) -> PreferenceRatePayload {
        PreferenceRatePayload {
            history_id: None,
            request_id: request_id.to_string(),
            rating: FeedbackRating::Up,
            mode: "B1".to_string(),
            input_text: "selected text".to_string(),
            instruction: "Translate".to_string(),
            output: "translated output".to_string(),
            output_provider: Some("openAi".to_string()),
            output_model: Some("gpt-4o-mini".to_string()),
            category_key: category_key.to_string(),
            category_label: "Translate".to_string(),
            quick_action_command_id: Some("cmd-1".to_string()),
            analysis_provider: LlmProvider::OpenAi,
            analysis_model: "gpt-4o-mini".to_string(),
            app_language: Some("zh-TW".to_string()),
        }
    }

    #[test]
    fn upsert_pending_feedback_separates_categories() {
        let mut store = PreferenceLearningStore::default();
        let payload_a = sample_payload("quickAction:cmd-1:a", "req-1");
        let mut payload_b = sample_payload("other", "req-2");
        payload_b.category_label = "Other".to_string();

        upsert_pending_feedback(&mut store, &payload_a).expect("first payload should insert");
        upsert_pending_feedback(&mut store, &payload_b).expect("second payload should insert");

        assert_eq!(store.pending_feedback.len(), 2);
        assert_eq!(store.pending_feedback[0].category_key, "quickAction:cmd-1:a");
        assert_eq!(store.pending_feedback[1].category_key, "other");
    }

    #[test]
    fn no_summary_requires_ten_pending_feedback_entries() {
        let mut store = PreferenceLearningStore::default();
        let category_key = "quickAction:cmd-1:a";
        for index in 0..9 {
            let payload = sample_payload(category_key, &format!("req-{index}"));
            upsert_pending_feedback(&mut store, &payload).expect("pending feedback should insert");
        }
        let snapshot = build_analysis_snapshot(&store, &sample_payload(category_key, "req-8"));
        assert!(snapshot.is_none());

        let payload = sample_payload(category_key, "req-9");
        upsert_pending_feedback(&mut store, &payload).expect("tenth payload should insert");
        let snapshot = build_analysis_snapshot(&store, &payload).expect("tenth item should trigger analysis");
        assert_eq!(snapshot.feedback_entries.len(), 10);
        assert!(snapshot.existing_summary.is_none());
    }

    #[test]
    fn existing_summary_requires_nine_pending_feedback_entries() {
        let mut store = PreferenceLearningStore::default();
        store.summaries.push(PreferenceSummaryEntry {
            category_key: "other".to_string(),
            category_label: "Other".to_string(),
            quick_action_command_id: None,
            summary: "Prefer concise direct answers.".to_string(),
            updated_at: unix_now(),
        });
        for index in 0..8 {
            let mut payload = sample_payload("other", &format!("req-{index}"));
            payload.category_label = "Other".to_string();
            upsert_pending_feedback(&mut store, &payload).expect("pending feedback should insert");
        }
        assert!(build_analysis_snapshot(&store, &sample_payload("other", "req-7")).is_none());

        let mut ninth = sample_payload("other", "req-8");
        ninth.category_label = "Other".to_string();
        upsert_pending_feedback(&mut store, &ninth).expect("ninth update payload should insert");
        let snapshot = build_analysis_snapshot(&store, &ninth).expect("ninth new record should trigger re-analysis");
        assert_eq!(snapshot.feedback_entries.len(), 9);
        assert_eq!(snapshot.existing_summary.as_deref(), Some("Prefer concise direct answers."));
    }

    #[test]
    fn apply_analysis_result_replaces_summary_and_clears_consumed_feedback() {
        let mut store = PreferenceLearningStore::default();
        let payload = sample_payload("other", "req-1");
        upsert_pending_feedback(&mut store, &payload).expect("payload should insert");
        let snapshot = AnalysisSnapshot {
            category_key: "other".to_string(),
            category_label: "Other".to_string(),
            quick_action_command_id: None,
            existing_summary: Some("Old summary".to_string()),
            feedback_entries: store.pending_feedback.clone(),
            request_ids: store
                .pending_feedback
                .iter()
                .map(|entry| entry.request_id.clone())
                .collect(),
            analysis_provider: LlmProvider::OpenAi,
            analysis_model: "gpt-4o-mini".to_string(),
            app_language: "zh-TW".to_string(),
        };
        store.summaries.push(PreferenceSummaryEntry {
            category_key: "other".to_string(),
            category_label: "Other".to_string(),
            quick_action_command_id: None,
            summary: "Old summary".to_string(),
            updated_at: unix_now(),
        });

        apply_analysis_result(&mut store, &snapshot, "New summary".to_string());

        assert!(store.pending_feedback.is_empty());
        assert_eq!(store.summaries.len(), 1);
        assert_eq!(store.summaries[0].summary, "New summary");
    }

    #[test]
    fn normalize_summary_limits_word_count() {
        let summary = (0..550).map(|index| format!("word{index}")).collect::<Vec<_>>().join(" ");
        let normalized = normalize_summary(&summary);
        assert_eq!(normalized.split_whitespace().count(), MAX_SUMMARY_WORDS);
    }
}
