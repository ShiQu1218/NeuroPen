use crate::preference_learning;

#[tauri::command]
pub async fn preference_rate_result(
    payload: preference_learning::PreferenceRatePayload,
) -> Result<(), String> {
    preference_learning::rate_result(payload).await
}

#[tauri::command]
pub fn preference_list_summaries() -> Result<Vec<preference_learning::PreferenceSummaryView>, String>
{
    preference_learning::list_summaries()
}

#[tauri::command]
pub fn preference_get_summary(category_key: String) -> Result<Option<String>, String> {
    preference_learning::get_summary(&category_key)
}

#[tauri::command]
pub fn preference_clear_summary(category_key: String) -> Result<bool, String> {
    preference_learning::clear_summary(&category_key)
}

#[tauri::command]
pub fn preference_clear_all() -> Result<(), String> {
    preference_learning::clear_all()
}
