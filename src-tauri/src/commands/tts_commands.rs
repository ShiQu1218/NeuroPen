use crate::tts;

#[tauri::command]
pub fn list_local_tts_models() -> Result<Vec<tts::LocalTtsModel>, String> {
    tts::list_local_tts_models()
}

#[tauri::command]
pub async fn install_local_tts_model(
    app: tauri::AppHandle,
    model_id: String,
) -> Result<tts::LocalTtsModel, String> {
    tts::install_local_tts_model(app, model_id).await
}

#[tauri::command]
pub fn cancel_local_tts_download() -> bool {
    tts::cancel_local_tts_download()
}

#[tauri::command]
pub fn delete_local_tts_model(model_id: String) -> Result<(), String> {
    tts::delete_local_tts_model(model_id)
}

#[tauri::command]
pub fn select_local_tts_model(model_id: String) -> Result<String, String> {
    tts::select_local_tts_model(model_id)
}
