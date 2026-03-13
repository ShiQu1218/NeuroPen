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
//!   `llm://token(text)` — output chunk (true stream when provider supports it)
//!   `llm://result`      — finalized output for the completed request
//!   `llm://done`        — generation complete
//!   `llm://error(msg)`  — API/network failure

use futures_util::StreamExt;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

mod formatting;

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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LlmToken {
    pub text: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LlmError {
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LlmResult {
    pub text: String,
    pub output_mode: OutputMode,
    pub request_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LlmDone {
    pub request_id: Option<String>,
}

async fn emit_output_stream(app: &tauri::AppHandle, full_output: &str, request_id: Option<&str>) {
    const CHUNK_CHARS: usize = 24;
    const CHUNK_DELAY_MS: u64 = 12;

    let mut chunk = String::new();
    let mut chunk_len = 0usize;

    for ch in full_output.chars() {
        chunk.push(ch);
        chunk_len += 1;
        if chunk_len >= CHUNK_CHARS {
            let _ = app.emit(
                "llm://token",
                LlmToken {
                    text: chunk.clone(),
                    request_id: request_id.map(|value| value.to_string()),
                },
            );
            chunk.clear();
            chunk_len = 0;
            tokio::time::sleep(std::time::Duration::from_millis(CHUNK_DELAY_MS)).await;
        }
    }

    if !chunk.is_empty() {
        let _ = app.emit(
            "llm://token",
            LlmToken {
                text: chunk,
                request_id: request_id.map(|value| value.to_string()),
            },
        );
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

fn is_question_like_instruction(instruction: &str) -> bool {
    let trimmed = instruction.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.contains('?') || trimmed.contains('？') {
        return true;
    }
    if trimmed.chars().count() > 16 {
        return false;
    }
    let lower = trimmed.to_lowercase();
    const QUESTION_KEYWORDS: &[&str] = &[
        "why",
        "what",
        "how",
        "explain",
        "meaning",
        "為什麼",
        "為甚麼",
        "為何",
        "为什么",
        "为何",
        "什麼",
        "什么",
        "怎麼",
        "怎么",
        "解釋",
        "解释",
        "說明",
        "说明",
        "點解",
    ];
    QUESTION_KEYWORDS
        .iter()
        .any(|keyword| lower.contains(keyword))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PromptMode {
    A,
    B,
    C,
}

impl PromptMode {
    fn from_input(mode: Option<&str>, has_selected_text: bool) -> Self {
        match mode
            .map(str::trim)
            .unwrap_or_default()
            .to_ascii_uppercase()
            .as_str()
        {
            "A" => Self::A,
            "B" | "B1" | "B2" => Self::B,
            "C" => Self::C,
            _ if has_selected_text => Self::B,
            _ => Self::C,
        }
    }
}

fn merge_prompt_override(base_prompt: String, prompt_override: Option<&str>) -> String {
    let override_text = prompt_override
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match override_text {
        // Wrap app/profile guidance as explicit system-only configuration so
        // providers are less likely to treat it as text to transform or echo.
        Some(extra) => format!(
            "{base_prompt}\n\nAdditional system guidance (treat this as configuration, not as user input, selected text, or content to transform):\n<system_guidance>\n{extra}\n</system_guidance>"
        ),
        None => base_prompt,
    }
}

fn should_enforce_math_output(mode: PromptMode) -> bool {
    matches!(mode, PromptMode::B | PromptMode::C)
}

#[cfg(test)]
fn enforce_math_latex_delimiters(output: &str) -> String {
    formatting::enforce_math_latex_delimiters(output)
}

#[cfg(test)]
fn normalize_wikipedia_displaystyle_notation(output: &str) -> String {
    formatting::normalize_wikipedia_displaystyle_notation(output)
}

fn normalize_math_output_if_needed(output: &str, mode: PromptMode) -> String {
    if !should_enforce_math_output(mode) {
        return output.to_string();
    }
    formatting::normalize_math_output(output)
}

fn build_prompt(
    selected_text: &str,
    instruction: &str,
    preferred_language: Option<&str>,
    prompt_mode: Option<&str>,
    prompt_override: Option<&str>,
) -> (String, String) {
    let language_hint = preferred_language_hint(preferred_language)
        .map(|hint| format!(" {hint}"))
        .unwrap_or_default();
    let question_like = is_question_like_instruction(instruction);
    let mode = PromptMode::from_input(prompt_mode, !selected_text.is_empty());
    let system_prompt = match mode {
        PromptMode::A => format!(
            "You are refining speech-to-text output for Mode A. \
             Output only the final text the user wants to insert. \
             Preserve the original language and script unless the instruction explicitly requests translation. \
             Follow the mode-specific formatting guidance carefully, keep the meaning intact, and do not add commentary or preamble. \
             If mathematical expressions are present, format them with LaTeX delimiters: inline $...$, block $$...$$. \
             Never leave equations as plain text without LaTeX delimiters.{language_hint}"
        ),
        PromptMode::B => format!(
            "You are handling selected-text commands for Mode B. \
             The user has highlighted text and given an instruction. \
             If the instruction is a transformation request, output only the transformed text. \
             If the instruction is question-like, answer the question about the highlighted text directly. \
             Never transform, translate, summarize, or echo the instruction text itself unless the highlighted text explicitly asks for that. \
             Always apply the instruction to the highlighted text. \
             When answering, reply directly and clearly in natural text. \
             Use short paragraphs or lists only when they genuinely help. \
             If mathematical expressions are present, format them with LaTeX delimiters: inline $...$, block $$...$$. \
             Never leave equations as plain text without LaTeX delimiters.{language_hint}"
        ),
        PromptMode::C => format!(
            "You are handling spoken assistant queries for Mode C. \
             Reply directly and clearly in natural text. \
             Keep short paragraphs when helpful, use lists only when they genuinely improve clarity, and avoid filler opening lines. \
             Avoid unnecessary headings for simple answers, but structure longer answers clearly when needed. \
             If mathematical expressions are present, format them with LaTeX delimiters: inline $...$, block $$...$$. \
             Never leave equations as plain text without LaTeX delimiters.{language_hint}"
        ),
    };
    let system_prompt = merge_prompt_override(system_prompt, prompt_override);

    let user_message = match mode {
        PromptMode::A => {
            if selected_text.trim().is_empty() {
                instruction.to_string()
            } else {
                format!("Speech transcript:\n{selected_text}\n\nTask:\n{instruction}")
            }
        }
        PromptMode::B => {
            if selected_text.trim().is_empty() {
                instruction.to_string()
            } else {
                // Separate highlighted text from the command so non-English
                // instructions are applied to the selection instead of echoed.
                format!(
                    "Highlighted text (operate on this text, not on the instruction itself):\n<selected_text>\n{selected_text}\n</selected_text>\n\nInstruction to apply to the highlighted text:\n<instruction>\n{instruction}\n</instruction>\n\nQuestion-like: {}",
                    if question_like { "yes" } else { "no" }
                )
            }
        }
        PromptMode::C => instruction.to_string(),
    };

    (system_prompt, user_message)
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

fn emit_token_chunk(
    app: &tauri::AppHandle,
    full_output: &mut String,
    token: &str,
    request_id: Option<&str>,
) {
    if token.is_empty() {
        return;
    }
    full_output.push_str(token);
    let _ = app.emit(
        "llm://token",
        LlmToken {
            text: token.to_string(),
            request_id: request_id.map(|value| value.to_string()),
        },
    );
}

fn handle_openai_stream_data(
    data: &str,
    app: &tauri::AppHandle,
    full_output: &mut String,
    request_id: Option<&str>,
) {
    if data.is_empty() || data == "[DONE]" {
        return;
    }
    let parsed: serde_json::Value = match serde_json::from_str(data) {
        Ok(value) => value,
        Err(_) => return,
    };
    if let Some(token) = parsed["choices"][0]["delta"]["content"].as_str() {
        emit_token_chunk(app, full_output, token, request_id);
        return;
    }
    if let Some(parts) = parsed["choices"][0]["delta"]["content"].as_array() {
        for part in parts {
            if let Some(token) = part["text"].as_str() {
                emit_token_chunk(app, full_output, token, request_id);
            } else if let Some(token) = part.as_str() {
                emit_token_chunk(app, full_output, token, request_id);
            }
        }
        return;
    }
    if let Some(token) = parsed["choices"][0]["message"]["content"].as_str() {
        emit_token_chunk(app, full_output, token, request_id);
    }
}

async fn call_openai_compatible_streaming(
    base_url: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
    app: &tauri::AppHandle,
    request_id: Option<&str>,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "stream": true,
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
    if !status.is_success() {
        let body = resp
            .text()
            .await
            .map_err(|e| format!("LLM API read failed: {e}"))?;
        return Err(format!("LLM API error ({status}): {body}"));
    }

    let mut stream = resp.bytes_stream();
    let mut pending = String::new();
    let mut full_output = String::new();

    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| format!("LLM stream read failed: {e}"))?;
        pending.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(newline_idx) = pending.find('\n') {
            let line = pending[..newline_idx].trim().to_string();
            pending.drain(..=newline_idx);
            if !line.starts_with("data:") {
                continue;
            }
            let data = line["data:".len()..].trim();
            handle_openai_stream_data(data, app, &mut full_output, request_id);
        }
    }

    for line in pending.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            continue;
        }
        let data = trimmed["data:".len()..].trim();
        handle_openai_stream_data(data, app, &mut full_output, request_id);
    }

    if full_output.is_empty() {
        return Err("LLM streamed empty response".to_string());
    }
    Ok(full_output)
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

async fn call_ollama(
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
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

async fn call_ollama_streaming(
    model: &str,
    system_prompt: &str,
    user_message: &str,
    app: &tauri::AppHandle,
    request_id: Option<&str>,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "stream": true,
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
    if !status.is_success() {
        let body = resp
            .text()
            .await
            .map_err(|e| format!("Ollama response read failed: {e}"))?;
        return Err(format!("Ollama API error ({status}): {body}"));
    }

    let mut stream = resp.bytes_stream();
    let mut pending = String::new();
    let mut full_output = String::new();

    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| format!("Ollama stream read failed: {e}"))?;
        pending.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(newline_idx) = pending.find('\n') {
            let line = pending[..newline_idx].trim().to_string();
            pending.drain(..=newline_idx);
            if line.is_empty() {
                continue;
            }
            let parsed: serde_json::Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if let Some(token) = parsed["message"]["content"].as_str() {
                emit_token_chunk(app, &mut full_output, token, request_id);
            }
        }
    }

    for line in pending.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if let Some(token) = parsed["message"]["content"].as_str() {
            emit_token_chunk(app, &mut full_output, token, request_id);
        }
    }

    if full_output.is_empty() {
        return Err("Unexpected Ollama streaming response: empty content".to_string());
    }
    Ok(full_output)
}

fn openai_compatible_url(provider: &LlmProvider) -> Option<&'static str> {
    // Several providers expose an OpenAI-compatible chat surface, so keep the
    // transport code shared and only branch where the wire format differs.
    match provider {
        LlmProvider::OpenAi => Some("https://api.openai.com/v1/chat/completions"),
        LlmProvider::Grok => Some("https://api.x.ai/v1/chat/completions"),
        LlmProvider::Qwen => {
            Some("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions")
        }
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
        return call_openai_compatible(url, api_key, chosen_model, system_prompt, user_message)
            .await;
    }
    match provider {
        LlmProvider::Gemini => {
            call_gemini(api_key, chosen_model, system_prompt, user_message).await
        }
        LlmProvider::Claude => {
            call_claude(api_key, chosen_model, system_prompt, user_message).await
        }
        LlmProvider::Ollama => call_ollama(chosen_model, system_prompt, user_message).await,
        _ => unreachable!(),
    }
}

async fn call_provider_preview_stream(
    api_key: &str,
    provider: &LlmProvider,
    chosen_model: &str,
    system_prompt: &str,
    user_message: &str,
    app: &tauri::AppHandle,
    request_id: Option<&str>,
) -> Result<String, String> {
    if let Some(url) = openai_compatible_url(provider) {
        return call_openai_compatible_streaming(
            url,
            api_key,
            chosen_model,
            system_prompt,
            user_message,
            app,
            request_id,
        )
        .await;
    }
    match provider {
        LlmProvider::Ollama => {
            call_ollama_streaming(chosen_model, system_prompt, user_message, app, request_id).await
        }
        _ => {
            // Providers without a streaming API still flow through preview mode by
            // emitting synthetic chunks from the completed response.
            let full_output =
                call_provider(api_key, provider, chosen_model, system_prompt, user_message).await?;
            if !full_output.is_empty() {
                emit_output_stream(app, &full_output, request_id).await;
            }
            Ok(full_output)
        }
    }
}

pub async fn call_llm(
    api_key: &str,
    selected_text: &str,
    instruction: &str,
    output_mode: OutputMode,
    stream_output: bool,
    provider: LlmProvider,
    model: &str,
    preferred_language: Option<String>,
    prompt_mode: Option<String>,
    prompt_override: Option<String>,
    request_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let resolved_prompt_mode =
        PromptMode::from_input(prompt_mode.as_deref(), !selected_text.is_empty());
    let should_force_math_normalization = should_enforce_math_output(resolved_prompt_mode);
    let (system_prompt, user_message) = build_prompt(
        selected_text,
        instruction,
        preferred_language.as_deref(),
        prompt_mode.as_deref(),
        prompt_override.as_deref(),
    );
    let chosen_model = resolve_model(model, &provider);

    // Preview conversations are multi-turn. Prefix prior turns only for preview
    // requests so direct-inject flows stay single-shot and deterministic.
    let effective_user_message = if output_mode == OutputMode::PreviewStream {
        let history = {
            let guard = CONVERSATION_HISTORY.lock().unwrap();
            guard.clone()
        };
        if history.is_empty() {
            user_message.clone()
        } else {
            let context = history
                .iter()
                .map(|m| format!("[{}]: {}", m.role, m.content))
                .collect::<Vec<_>>()
                .join("\n");
            format!("Previous conversation context:\n{context}\n\n---\n\n{user_message}")
        }
    } else {
        user_message.clone()
    };

    let used_native_streaming = output_mode == OutputMode::PreviewStream
        && stream_output
        && !should_force_math_normalization;

    // If the response must be post-processed for math formatting, wait for the full
    // text first; otherwise streamed partials could expose unnormalized equations.
    let raw_output = if used_native_streaming {
        call_provider_preview_stream(
            api_key,
            &provider,
            &chosen_model,
            &system_prompt,
            &effective_user_message,
            &app,
            request_id.as_deref(),
        )
        .await
    } else {
        call_provider(
            api_key,
            &provider,
            &chosen_model,
            &system_prompt,
            &effective_user_message,
        )
        .await
    }
    .map_err(|e| {
        let _ = app.emit(
            "llm://error",
            LlmError {
                message: e.clone(),
                request_id: request_id.clone(),
            },
        );
        e
    })?;

    let full_output = normalize_math_output_if_needed(&raw_output, resolved_prompt_mode);

    if output_mode == OutputMode::PreviewStream && !full_output.is_empty() {
        if stream_output {
            if !used_native_streaming {
                emit_output_stream(&app, &full_output, request_id.as_deref()).await;
            }
        } else {
            let _ = app.emit(
                "llm://token",
                LlmToken {
                    text: full_output.clone(),
                    request_id: request_id.clone(),
                },
            );
        }
    }

    // Save to conversation history in PreviewStream mode for multi-turn support
    if output_mode == OutputMode::PreviewStream && !full_output.is_empty() {
        let mut guard = CONVERSATION_HISTORY.lock().unwrap();
        guard.push(ConversationMessage {
            role: "user".to_string(),
            content: user_message,
        });
        guard.push(ConversationMessage {
            role: "assistant".to_string(),
            content: full_output.clone(),
        });
        // Keep at most 10 turns (20 messages)
        const MAX_MSGS: usize = 20;
        if guard.len() > MAX_MSGS {
            let drain_count = guard.len() - MAX_MSGS;
            guard.drain(..drain_count);
        }
    }

    if output_mode == OutputMode::DirectInject && !full_output.is_empty() {
        if let Err(e) = crate::injection::inject_text_with_undo(&full_output, true) {
            let msg = format!("Injection failed: {e}");
            let _ = app.emit(
                "llm://error",
                LlmError {
                    message: msg.clone(),
                    request_id: request_id.clone(),
                },
            );
            return Err(msg);
        }
    }

    if !full_output.is_empty() {
        let _ = app.emit(
            "llm://result",
            LlmResult {
                text: full_output.clone(),
                output_mode: output_mode.clone(),
                request_id: request_id.clone(),
            },
        );
    }

    let _ = app.emit(
        "llm://done",
        LlmDone {
            request_id: request_id.clone(),
        },
    );

    Ok(())
}

pub async fn call_llm_text(
    api_key: &str,
    selected_text: &str,
    instruction: &str,
    provider: LlmProvider,
    model: &str,
    preferred_language: Option<String>,
    prompt_mode: Option<String>,
    prompt_override: Option<String>,
) -> Result<String, String> {
    let resolved_prompt_mode =
        PromptMode::from_input(prompt_mode.as_deref(), !selected_text.is_empty());
    let (system_prompt, user_message) = build_prompt(
        selected_text,
        instruction,
        preferred_language.as_deref(),
        prompt_mode.as_deref(),
        prompt_override.as_deref(),
    );
    let chosen_model = resolve_model(model, &provider);
    let raw_output = call_provider(
        api_key,
        &provider,
        &chosen_model,
        &system_prompt,
        &user_message,
    )
    .await?;
    Ok(normalize_math_output_if_needed(
        &raw_output,
        resolved_prompt_mode,
    ))
}

pub async fn call_custom_prompt_text(
    api_key: &str,
    provider: LlmProvider,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let chosen_model = resolve_model(model, &provider);
    call_provider(
        api_key,
        &provider,
        &chosen_model,
        system_prompt,
        user_message,
    )
    .await
}

// ── Multimodal (image + text) support ───────────────────────────────────

async fn call_openai_compatible_with_images(
    base_url: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_text: &str,
    images: &[(&str, &str)],
) -> Result<String, String> {
    let mut content = vec![serde_json::json!({ "type": "text", "text": user_text })];
    for (image_base64, image_mime_type) in images {
        content.push(serde_json::json!({
            "type": "image_url",
            "image_url": { "url": format!("data:{image_mime_type};base64,{image_base64}") }
        }));
    }
    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": content }
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
        serde_json::from_str(&body).map_err(|e| format!("Parse failed: {e}"))?;
    extract_openai_text(&parsed).ok_or_else(|| format!("Unexpected response: {body}"))
}

async fn call_gemini_with_images(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_text: &str,
    images: &[(&str, &str)],
) -> Result<String, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model
    );
    let mut parts = vec![serde_json::json!({ "text": user_text })];
    for (image_base64, image_mime_type) in images {
        parts.push(serde_json::json!({
            "inline_data": { "mime_type": image_mime_type, "data": image_base64 }
        }));
    }
    let body = serde_json::json!({
        "system_instruction": { "parts": [{ "text": system_prompt }] },
        "contents": [{ "parts": parts }],
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
        .map_err(|e| format!("Gemini read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("Gemini API error ({status}): {body}"));
    }
    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Parse failed: {e}"))?;
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

async fn call_claude_with_images(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_text: &str,
    images: &[(&str, &str)],
) -> Result<String, String> {
    let mut content = Vec::with_capacity(images.len() + 1);
    for (image_base64, image_mime_type) in images {
        content.push(serde_json::json!({
            "type": "image",
            "source": { "type": "base64", "media_type": image_mime_type, "data": image_base64 }
        }));
    }
    content.push(serde_json::json!({ "type": "text", "text": user_text }));
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "system": system_prompt,
        "messages": [{ "role": "user", "content": content }],
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
        .map_err(|e| format!("Claude read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("Claude API error ({status}): {body}"));
    }
    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Parse failed: {e}"))?;
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

async fn call_ollama_with_images(
    model: &str,
    system_prompt: &str,
    user_text: &str,
    images: &[(&str, &str)],
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_text, "images": images.iter().map(|(image_base64, _)| *image_base64).collect::<Vec<_>>() }
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
        .map_err(|e| format!("Ollama read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("Ollama API error ({status}): {body}"));
    }
    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Parse failed: {e}"))?;
    if let Some(text) = parsed["message"]["content"].as_str() {
        if !text.is_empty() {
            return Ok(text.to_string());
        }
    }
    Err(format!("Unexpected Ollama response: {body}"))
}

async fn call_provider_with_images(
    api_key: &str,
    provider: &LlmProvider,
    chosen_model: &str,
    system_prompt: &str,
    user_text: &str,
    images: &[(&str, &str)],
) -> Result<String, String> {
    if let Some(url) = openai_compatible_url(provider) {
        return call_openai_compatible_with_images(
            url,
            api_key,
            chosen_model,
            system_prompt,
            user_text,
            images,
        )
        .await;
    }
    match provider {
        LlmProvider::Gemini => {
            call_gemini_with_images(api_key, chosen_model, system_prompt, user_text, images).await
        }
        LlmProvider::Claude => {
            call_claude_with_images(api_key, chosen_model, system_prompt, user_text, images).await
        }
        LlmProvider::Ollama => {
            call_ollama_with_images(chosen_model, system_prompt, user_text, images).await
        }
        _ => unreachable!(),
    }
}

pub async fn call_llm_with_image(
    api_key: &str,
    image_base64: &str,
    image_mime_type: &str,
    instruction: &str,
    output_mode: OutputMode,
    stream_output: bool,
    provider: LlmProvider,
    model: &str,
    preferred_language: Option<String>,
    prompt_mode: Option<String>,
    prompt_override: Option<String>,
    request_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    call_llm_with_images(
        api_key,
        &[(image_base64, image_mime_type)],
        instruction,
        output_mode,
        stream_output,
        provider,
        model,
        preferred_language,
        prompt_mode,
        prompt_override,
        request_id,
        app,
    )
    .await
}

pub async fn call_llm_with_images(
    api_key: &str,
    images: &[(&str, &str)],
    instruction: &str,
    output_mode: OutputMode,
    stream_output: bool,
    provider: LlmProvider,
    model: &str,
    preferred_language: Option<String>,
    prompt_mode: Option<String>,
    prompt_override: Option<String>,
    request_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let language_hint = preferred_language_hint(preferred_language.as_deref())
        .map(|h| format!(" {h}"))
        .unwrap_or_default();
    let mode = PromptMode::from_input(prompt_mode.as_deref(), false);
    let image_count = images.len();
    let base_prompt = format!(
        "You are a helpful assistant. The user has sent {image_count} image attachment(s) and a question about them. \
         Answer concisely based on the image content. \
         If there are multiple images, compare and synthesize across all relevant images. \
         If mathematical expressions are present, format them with LaTeX delimiters: inline $...$, block $$...$$. \
         Never leave equations as plain text without LaTeX delimiters.{language_hint}"
    );
    let system_prompt = if mode == PromptMode::C {
        merge_prompt_override(
            format!(
                "You are handling a Mode C image-attachment query. \
                 Answer based on the image content directly and clearly in natural text. \
                 Use short paragraphs or lists only when they genuinely help. \
                 If there are multiple images, use all of them and call out disagreements or comparisons explicitly. \
                 OCR may produce imperfect symbols, so normalize detected formulas into valid LaTeX. \
                 If mathematical expressions are present, format them with LaTeX delimiters: inline $...$, block $$...$$. \
                 Never leave equations as plain text without LaTeX delimiters.{language_hint}"
            ),
            prompt_override.as_deref(),
        )
    } else {
        merge_prompt_override(base_prompt, prompt_override.as_deref())
    };
    let chosen_model = resolve_model(model, &provider);

    // Multimodal requests currently normalize after the provider returns, so all
    // image answers stream from the finalized text rather than provider-native chunks.
    let raw_output = call_provider_with_images(
        api_key,
        &provider,
        &chosen_model,
        &system_prompt,
        instruction,
        images,
    )
    .await
    .map_err(|e| {
        let _ = app.emit(
            "llm://error",
            LlmError {
                message: e.clone(),
                request_id: request_id.clone(),
            },
        );
        e
    })?;
    let full_output = normalize_math_output_if_needed(&raw_output, mode);

    // Image requests can also target DirectInject. Emit preview events only for
    // preview sessions so direct-insert flows do not wake preview listeners.
    if output_mode == OutputMode::PreviewStream && !full_output.is_empty() {
        if stream_output {
            emit_output_stream(&app, &full_output, request_id.as_deref()).await;
        } else {
            let _ = app.emit(
                "llm://token",
                LlmToken {
                    text: full_output.clone(),
                    request_id: request_id.clone(),
                },
            );
        }
    }
    if output_mode == OutputMode::PreviewStream && !full_output.is_empty() {
        let mut guard = CONVERSATION_HISTORY.lock().unwrap();
        guard.push(ConversationMessage {
            role: "user".to_string(),
            content: format!("[{} image attachment(s)] {}", images.len(), instruction),
        });
        guard.push(ConversationMessage {
            role: "assistant".to_string(),
            content: full_output.clone(),
        });
        const MAX_MSGS: usize = 20;
        if guard.len() > MAX_MSGS {
            let drain_count = guard.len() - MAX_MSGS;
            guard.drain(..drain_count);
        }
    }

    if output_mode == OutputMode::DirectInject && !full_output.is_empty() {
        if let Err(e) = crate::injection::inject_text(&full_output) {
            let msg = format!("Injection failed: {e}");
            let _ = app.emit(
                "llm://error",
                LlmError {
                    message: msg.clone(),
                    request_id: request_id.clone(),
                },
            );
            return Err(msg);
        }
    }

    if !full_output.is_empty() {
        let _ = app.emit(
            "llm://result",
            LlmResult {
                text: full_output.clone(),
                output_mode: output_mode.clone(),
                request_id: request_id.clone(),
            },
        );
    }

    if output_mode == OutputMode::PreviewStream {
        let _ = app.emit(
            "llm://done",
            LlmDone {
                request_id: request_id.clone(),
            },
        );
    }

    Ok(())
}

// ── Conversation context (multi-turn) ───────────────────────────────────

/// A conversation message for multi-turn context.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
}

static CONVERSATION_HISTORY: std::sync::Mutex<Vec<ConversationMessage>> =
    std::sync::Mutex::new(Vec::new());

/// Clear conversation history (for new session).
pub fn clear_conversation() {
    let mut guard = CONVERSATION_HISTORY.lock().unwrap();
    guard.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_short_question_like_instruction() {
        assert!(is_question_like_instruction("為甚麼"));
        assert!(is_question_like_instruction("why"));
    }

    #[test]
    fn keeps_transform_instruction_non_question_like() {
        assert!(!is_question_like_instruction(
            "Translate the selected text to English."
        ));
    }

    #[test]
    fn maps_b_variants_to_prompt_mode_b() {
        assert_eq!(PromptMode::from_input(Some("B1"), true), PromptMode::B);
        assert_eq!(PromptMode::from_input(Some("B2"), true), PromptMode::B);
    }

    #[test]
    fn mode_a_prompt_uses_transcript_and_task_format() {
        let (_, user_message) = build_prompt(
            "幫我整理這段逐字稿",
            "Rewrite this speech-to-text transcript into a clean final version.",
            None,
            Some("A"),
            None,
        );

        assert!(user_message.contains("Speech transcript:\n幫我整理這段逐字稿"));
        assert!(user_message.contains("Task:\nRewrite this speech-to-text transcript"));
        assert!(!user_message.contains("Highlighted text"));
    }

    #[test]
    fn mode_b_prompt_wraps_selected_text_and_instruction_separately() {
        let (_, user_message) =
            build_prompt("Hello world", "翻譯成繁體中文", None, Some("B"), None);

        assert!(user_message.contains("<selected_text>\nHello world\n</selected_text>"));
        assert!(user_message.contains("<instruction>\n翻譯成繁體中文\n</instruction>"));
        assert!(user_message.contains("not on the instruction itself"));
    }

    #[test]
    fn prompt_override_is_marked_as_system_guidance() {
        let (system_prompt, _) = build_prompt(
            "Hello world",
            "翻譯成繁體中文",
            None,
            Some("B"),
            Some("在結尾要加喵"),
        );

        assert!(system_prompt.contains("Additional system guidance"));
        assert!(system_prompt.contains("not as user input"));
        assert!(system_prompt.contains("<system_guidance>\n在結尾要加喵\n</system_guidance>"));
    }

    #[test]
    fn wraps_plain_equation_line_with_display_latex() {
        let input = "x^2 + y^2 = z^2";
        let output = enforce_math_latex_delimiters(input);
        assert_eq!(output, "$$x^2 + y^2 = z^2$$");
    }

    #[test]
    fn preserves_existing_latex_equation() {
        let input = "$$x^2 + y^2 = z^2$$";
        let output = enforce_math_latex_delimiters(input);
        assert_eq!(output, input);
    }

    #[test]
    fn normalizes_wikipedia_displaystyle_block() {
        let input =
            "{\\displaystyle f(n)=\\Theta \\left(n^{\\log _{b}a}\\log ^{\\epsilon }n\\right)}";
        let output = normalize_wikipedia_displaystyle_notation(input);
        assert_eq!(
            output,
            "$$f(n)=\\Theta \\left(n^{\\log _{b}a}\\log ^{\\epsilon }n\\right)$$"
        );
    }

    #[test]
    fn normalizes_wikipedia_displaystyle_inline() {
        let input = "主定理形式：{\\displaystyle f(n)=\\Theta(n)}。";
        let output = normalize_wikipedia_displaystyle_notation(input);
        assert_eq!(output, "主定理形式：$f(n)=\\Theta(n)$。");
    }
}
