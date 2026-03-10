use crate::history;

#[tauri::command]
pub fn history_list() -> Vec<history::HistoryEntry> {
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
) {
    history::save(&mode, &input_text, &instruction, &output, &provider, &model);
}

#[tauri::command]
pub fn history_delete(id: String) -> bool {
    history::delete(&id)
}

#[tauri::command]
pub fn history_clear() {
    history::clear_all();
}

#[tauri::command]
pub fn history_search(query: String) -> Vec<history::HistoryEntry> {
    history::search(&query)
}

#[tauri::command]
pub fn history_toggle_favorite(id: String) -> Option<bool> {
    history::toggle_favorite(&id)
}
