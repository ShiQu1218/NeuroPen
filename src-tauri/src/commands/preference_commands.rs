use crate::preference_learning;

#[tauri::command]
pub async fn preference_rate_result(
    payload: preference_learning::PreferenceRatePayload,
) -> Result<(), String> {
    preference_learning::rate_result(payload).await
}

#[tauri::command]
pub fn preference_list_summaries() -> Vec<preference_learning::PreferenceSummaryView> {
    preference_learning::list_summaries()
}

#[tauri::command]
pub fn preference_get_summary(category_key: String) -> Option<String> {
    preference_learning::get_summary(&category_key)
}

#[tauri::command]
pub fn preference_clear_summary(category_key: String) -> bool {
    preference_learning::clear_summary(&category_key)
}

#[tauri::command]
pub fn preference_clear_all() {
    preference_learning::clear_all();
}
