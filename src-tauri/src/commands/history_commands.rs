use crate::history;

#[tauri::command]
pub fn history_list() -> Result<Vec<history::HistoryEntry>, String> {
    history::list()
}

#[tauri::command]
pub fn history_save(
    mode: String,
    input_text: String,
    instruction: String,
    output: String,
    provider: String,
    model: String,
    request_id: Option<String>,
    preference_category_key: Option<String>,
    preference_category_label: Option<String>,
    quick_action_command_id: Option<String>,
) -> Result<(), String> {
    history::save(
        &mode,
        &input_text,
        &instruction,
        &output,
        &provider,
        &model,
        request_id.as_deref(),
        preference_category_key.as_deref(),
        preference_category_label.as_deref(),
        quick_action_command_id.as_deref(),
    )
}

#[tauri::command]
pub fn history_delete(id: String) -> Result<bool, String> {
    history::delete(&id)
}

#[tauri::command]
pub fn history_clear() -> Result<(), String> {
    history::clear_all()
}

#[tauri::command]
pub fn history_search(query: String) -> Result<Vec<history::HistoryEntry>, String> {
    history::search(&query)
}

#[tauri::command]
pub fn history_toggle_favorite(id: String) -> Result<Option<bool>, String> {
    history::toggle_favorite(&id)
}
