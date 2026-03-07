use crate::{audio_capture, stt};

/// Store the OpenAI API key (in OS credential store + in-process cache).
#[tauri::command]
pub fn set_api_key(key: String) -> Result<(), String> {
    stt::set_api_key(key)
}

/// Check whether an API key has been configured.
#[tauri::command]
pub fn has_api_key() -> bool {
    stt::has_api_key()
}

#[tauri::command]
pub fn set_stt_api_key(key: String) -> Result<(), String> {
    stt::set_stt_api_key(key)
}

#[tauri::command]
pub fn has_stt_api_key() -> bool {
    stt::has_stt_api_key()
}

/// Return which STT engines are compiled into this binary.
#[tauri::command]
pub fn get_stt_capabilities() -> stt::SttCapabilities {
    stt::get_capabilities()
}

/// List local STT catalog with installed/active status.
#[tauri::command]
pub fn list_local_stt_models() -> Result<Vec<stt::LocalSttModel>, String> {
    stt::list_local_stt_models()
}

/// Install a local STT model file.
#[tauri::command]
pub async fn install_local_stt_model(
    app: tauri::AppHandle,
    model_id: String,
) -> Result<stt::LocalSttModel, String> {
    stt::install_local_stt_model(app, model_id).await
}

#[tauri::command]
pub fn cancel_local_stt_download() -> bool {
    stt::cancel_local_stt_download()
}

/// Delete an installed local STT model file.
#[tauri::command]
pub fn delete_local_stt_model(model_id: String) -> Result<(), String> {
    stt::delete_local_stt_model(model_id)
}

/// Select one installed local STT model as active and return its path.
#[tauri::command]
pub fn select_local_stt_model(model_id: String) -> Result<String, String> {
    stt::select_local_stt_model(model_id)
}

/// Check if currently recording.
#[tauri::command]
pub fn is_recording() -> bool {
    stt::is_recording()
}

/// List available audio input devices.
#[tauri::command]
pub fn list_audio_devices() -> Vec<String> {
    audio_capture::list_input_devices()
}

#[tauri::command]
pub fn set_audio_device(name: String) {
    audio_capture::set_input_device(name);
}
