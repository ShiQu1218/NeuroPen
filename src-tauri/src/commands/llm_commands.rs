use crate::{llm, stt};

fn llm_api_key_for_provider(provider: &llm::LlmProvider) -> Result<String, String> {
    if matches!(
        provider,
        llm::LlmProvider::Ollama | llm::LlmProvider::LlamaCpp | llm::LlmProvider::LmStudio
    ) {
        if stt::has_api_key() {
            return Ok(stt::get_api_key().unwrap_or_default());
        }
        return Ok(String::new());
    }

    stt::get_api_key()
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAttachmentInput {
    pub image_base64: String,
    pub image_mime_type: Option<String>,
}

/// Call the LLM with streaming and emit token events.
/// All command entry points here normalize frontend-friendly inputs and then
/// delegate to `llm.rs`, which owns provider routing and output behavior.
#[tauri::command]
pub async fn call_llm(
    app: tauri::AppHandle,
    selected_text: String,
    instruction: String,
    output_mode: llm::OutputMode,
    stream_output: Option<bool>,
    provider: llm::LlmProvider,
    model: String,
    preferred_language: Option<String>,
    prompt_mode: Option<String>,
    prompt_override: Option<String>,
    request_id: Option<String>,
) -> Result<(), String> {
    let api_key = llm_api_key_for_provider(&provider)?;
    llm::call_llm(
        &api_key,
        &selected_text,
        &instruction,
        output_mode,
        stream_output.unwrap_or(true),
        provider,
        &model,
        preferred_language,
        prompt_mode,
        prompt_override,
        request_id,
        app,
    )
    .await
}

/// Call the LLM and return final text (non-streaming helper for STT refinement).
#[tauri::command]
pub async fn call_llm_text(
    selected_text: String,
    instruction: String,
    provider: llm::LlmProvider,
    model: String,
    preferred_language: Option<String>,
    prompt_mode: Option<String>,
    prompt_override: Option<String>,
) -> Result<String, String> {
    let api_key = llm_api_key_for_provider(&provider)?;
    llm::call_llm_text(
        &api_key,
        &selected_text,
        &instruction,
        provider,
        &model,
        preferred_language,
        prompt_mode,
        prompt_override,
    )
    .await
}

#[tauri::command]
pub async fn call_llm_with_image(
    app: tauri::AppHandle,
    image_base64: String,
    image_mime_type: Option<String>,
    instruction: String,
    output_mode: llm::OutputMode,
    stream_output: Option<bool>,
    provider: llm::LlmProvider,
    model: String,
    preferred_language: Option<String>,
    prompt_mode: Option<String>,
    prompt_override: Option<String>,
    request_id: Option<String>,
) -> Result<(), String> {
    let api_key = llm_api_key_for_provider(&provider)?;
    llm::call_llm_with_image(
        &api_key,
        &image_base64,
        image_mime_type.as_deref().unwrap_or("image/png"),
        &instruction,
        output_mode,
        stream_output.unwrap_or(true),
        provider,
        &model,
        preferred_language,
        prompt_mode,
        prompt_override,
        request_id,
        app,
    )
    .await
}

#[tauri::command]
pub async fn call_llm_with_images(
    app: tauri::AppHandle,
    images: Vec<ImageAttachmentInput>,
    instruction: String,
    output_mode: llm::OutputMode,
    stream_output: Option<bool>,
    provider: llm::LlmProvider,
    model: String,
    preferred_language: Option<String>,
    prompt_mode: Option<String>,
    prompt_override: Option<String>,
    request_id: Option<String>,
) -> Result<(), String> {
    let api_key = llm_api_key_for_provider(&provider)?;
    // Borrow the decoded payload fields so the shared LLM layer can accept the
    // same `&[(&str, &str)]` shape from single-image and multi-image callers.
    llm::call_llm_with_images(
        &api_key,
        &images
            .iter()
            .map(|image| {
                (
                    image.image_base64.as_str(),
                    image.image_mime_type.as_deref().unwrap_or("image/png"),
                )
            })
            .collect::<Vec<_>>(),
        &instruction,
        output_mode,
        stream_output.unwrap_or(true),
        provider,
        &model,
        preferred_language,
        prompt_mode,
        prompt_override,
        request_id,
        app,
    )
    .await
}

#[tauri::command]
pub async fn list_available_llm_models(provider: llm::LlmProvider) -> Result<Vec<String>, String> {
    let api_key = llm_api_key_for_provider(&provider)?;
    llm::list_available_models(&provider, &api_key).await
}

#[tauri::command]
pub fn clear_conversation() {
    llm::clear_conversation();
}
