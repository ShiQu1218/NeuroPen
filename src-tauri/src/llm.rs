//! Multi-provider LLM client.
//!
//! Supported providers:
//! - OpenAI
//! - Gemini
//! - Claude
//! - Grok
//! - Ollama (local)
//!
//! Emits:
//!   `llm://token(text)` — output chunk (single full chunk in current implementation)
//!   `llm://done`        — generation complete
//!   `llm://error(msg)`  — API/network failure

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// Shared HTTP client — reuses TCP/TLS connections across LLM calls.
static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("Failed to build HTTP client")
});

/// Controls where LLM output is sent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum OutputMode {
    /// Inject text directly into the focused window without showing Preview Window.
    DirectInject,
    /// Open the Preview Window and stream tokens there.
    PreviewStream,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LlmProvider {
    OpenAi,
    Gemini,
    Claude,
    Grok,
    Qwen,
    Doubao,
    Deepseek,
    Ollama,
}

/// Preset B1 quick-action prompts.
pub const PRESETS: &[(&str, &str)] = &[
    ("translate", "Translate the selected text to English."),
    ("summarize", "Summarize the selected text concisely."),
    ("grammar", "Fix grammar and spelling errors in the selected text."),
    ("formalize", "Rewrite the selected text in a formal tone."),
];

#[derive(Serialize, Clone)]
pub struct LlmToken {
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct LlmError {
    pub message: String,
}

async fn emit_output_stream(app: &tauri::AppHandle, full_output: &str) {
    const CHUNK_CHARS: usize = 24;
    const CHUNK_DELAY_MS: u64 = 12;

    let mut chunk = String::new();
    let mut chunk_len = 0usize;

    for ch in full_output.chars() {
        chunk.push(ch);
        chunk_len += 1;
        if chunk_len >= CHUNK_CHARS {
            let _ = app.emit("llm://token", LlmToken { text: chunk.clone() });
            chunk.clear();
            chunk_len = 0;
            tokio::time::sleep(std::time::Duration::from_millis(CHUNK_DELAY_MS)).await;
        }
    }

    if !chunk.is_empty() {
        let _ = app.emit("llm://token", LlmToken { text: chunk });
    }
}

fn default_model(provider: &LlmProvider) -> &'static str {
    match provider {
        LlmProvider::OpenAi => "gpt-4o-mini",
        LlmProvider::Gemini => "gemini-1.5-flash",
        LlmProvider::Claude => "claude-3-5-sonnet-latest",
        LlmProvider::Grok => "grok-2-latest",
        LlmProvider::Qwen => "qwen-plus",
        LlmProvider::Doubao => "doubao-seed-1-6-250615",
        LlmProvider::Deepseek => "deepseek-chat",
        LlmProvider::Ollama => "llama3.2",
    }
}

const AUTO_LANGUAGE: &str = "auto";

fn preferred_language_hint(preferred_language: Option<&str>) -> Option<String> {
    let code = preferred_language
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case(AUTO_LANGUAGE))?;
    let name = match code {
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
        _ => code,
    };
    Some(format!(
        "Always respond in {name} unless the user explicitly requests another language."
    ))
}

fn build_prompt(selected_text: &str, instruction: &str, preferred_language: Option<&str>) -> (String, String) {
    let language_hint = preferred_language_hint(preferred_language)
        .map(|hint| format!(" {hint}"))
        .unwrap_or_default();
    if selected_text.is_empty() {
        (
            format!(
                "You are a helpful assistant. Answer the user's question concisely in the same language they use.{language_hint}"
            ),
            instruction.to_string(),
        )
    } else {
        (
            format!(
                "You are a helpful assistant. Process the user's selected text according to their instruction. Keep the output in the same language and writing system as the selected text by default, and never translate unless the instruction explicitly asks for translation.{language_hint} Reply with only the processed result, no explanation."
            ),
            format!("Selected text:\n\n{selected_text}\n\nInstruction: {instruction}"),
        )
    }
}

fn extract_openai_text(parsed: &serde_json::Value) -> Option<String> {
    if let Some(content) = parsed["choices"][0]["message"]["content"].as_str() {
        return Some(content.to_string());
    }
    if let Some(arr) = parsed["choices"][0]["message"]["content"].as_array() {
        let mut out = String::new();
        for part in arr {
            if let Some(text) = part["text"].as_str() {
                out.push_str(text);
            }
        }
        if !out.is_empty() {
            return Some(out);
        }
    }
    None
}

async fn call_openai_compatible(
    base_url: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_message },
        ]
    });

    let resp = HTTP_CLIENT
        .post(base_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("LLM API request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("LLM API read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("LLM API error ({status}): {body}"));
    }
    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("LLM API parse failed: {e}"))?;
    extract_openai_text(&parsed).ok_or_else(|| format!("Unexpected LLM response: {body}"))
}

async fn call_gemini(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model
    );
    let body = serde_json::json!({
        "system_instruction": { "parts": [{ "text": system_prompt }] },
        "contents": [{ "parts": [{ "text": user_message }] }],
    });

    let resp = HTTP_CLIENT
        .post(url)
        .header("x-goog-api-key", api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini API request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Gemini API read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("Gemini API error ({status}): {body}"));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Gemini API parse failed: {e}"))?;
    let mut out = String::new();
    if let Some(parts) = parsed["candidates"][0]["content"]["parts"].as_array() {
        for part in parts {
            if let Some(text) = part["text"].as_str() {
                out.push_str(text);
            }
        }
    }
    if out.is_empty() {
        return Err(format!("Unexpected Gemini response: {body}"));
    }
    Ok(out)
}

async fn call_claude(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "system": system_prompt,
        "messages": [{ "role": "user", "content": user_message }],
    });

    let resp = HTTP_CLIENT
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude API request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Claude API read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("Claude API error ({status}): {body}"));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Claude API parse failed: {e}"))?;
    let mut out = String::new();
    if let Some(arr) = parsed["content"].as_array() {
        for part in arr {
            if part["type"].as_str() == Some("text") {
                if let Some(text) = part["text"].as_str() {
                    out.push_str(text);
                }
            }
        }
    }
    if out.is_empty() {
        return Err(format!("Unexpected Claude response: {body}"));
    }
    Ok(out)
}

async fn call_ollama(model: &str, system_prompt: &str, user_message: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_message }
        ]
    });

    let resp = HTTP_CLIENT
        .post("http://127.0.0.1:11434/api/chat")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Ollama response read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("Ollama API error ({status}): {body}"));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Ollama response parse failed: {e}"))?;
    if let Some(text) = parsed["message"]["content"].as_str() {
        if !text.is_empty() {
            return Ok(text.to_string());
        }
    }
    Err(format!("Unexpected Ollama response: {body}"))
}

fn openai_compatible_url(provider: &LlmProvider) -> Option<&'static str> {
    match provider {
        LlmProvider::OpenAi => Some("https://api.openai.com/v1/chat/completions"),
        LlmProvider::Grok => Some("https://api.x.ai/v1/chat/completions"),
        LlmProvider::Qwen => Some("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"),
        LlmProvider::Doubao => Some("https://ark.cn-beijing.volces.com/api/v3/chat/completions"),
        LlmProvider::Deepseek => Some("https://api.deepseek.com/v1/chat/completions"),
        _ => None,
    }
}

fn resolve_model(model: &str, provider: &LlmProvider) -> String {
    if model.trim().is_empty() {
        default_model(provider).to_string()
    } else {
        model.trim().to_string()
    }
}

async fn call_provider(
    api_key: &str,
    provider: &LlmProvider,
    chosen_model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    if let Some(url) = openai_compatible_url(provider) {
        return call_openai_compatible(url, api_key, chosen_model, system_prompt, user_message).await;
    }
    match provider {
        LlmProvider::Gemini => call_gemini(api_key, chosen_model, system_prompt, user_message).await,
        LlmProvider::Claude => call_claude(api_key, chosen_model, system_prompt, user_message).await,
        LlmProvider::Ollama => call_ollama(chosen_model, system_prompt, user_message).await,
        _ => unreachable!(),
    }
}

pub async fn call_llm(
    api_key: &str,
    selected_text: &str,
    instruction: &str,
    output_mode: OutputMode,
    provider: LlmProvider,
    model: &str,
    preferred_language: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let (system_prompt, user_message) = build_prompt(selected_text, instruction, preferred_language.as_deref());
    let chosen_model = resolve_model(model, &provider);

    let full_output = call_provider(api_key, &provider, &chosen_model, &system_prompt, &user_message)
    .await
    .map_err(|e| {
        let _ = app.emit("llm://error", LlmError { message: e.clone() });
        e
    })?;

    if !full_output.is_empty() {
        emit_output_stream(&app, &full_output).await;
    }
    let _ = app.emit("llm://done", ());

    if output_mode == OutputMode::DirectInject && !full_output.is_empty() {
        if let Err(e) = crate::injection::inject_text(&full_output) {
            let msg = format!("Injection failed: {e}");
            let _ = app.emit("llm://error", LlmError { message: msg.clone() });
            return Err(msg);
        }
    }

    Ok(())
}

pub async fn call_llm_text(
    api_key: &str,
    selected_text: &str,
    instruction: &str,
    provider: LlmProvider,
    model: &str,
    preferred_language: Option<String>,
) -> Result<String, String> {
    let (system_prompt, user_message) = build_prompt(selected_text, instruction, preferred_language.as_deref());
    let chosen_model = resolve_model(model, &provider);
    call_provider(api_key, &provider, &chosen_model, &system_prompt, &user_message).await
}
