//! OpenAI streaming LLM client.
//!
//! Phase 3 implementation:
//! - POST /v1/chat/completions with `stream: true`
//! - Parse Server-Sent Events (SSE) line by line
//! - Emit Tauri events:
//!     `llm://token(text)` — each streamed token
//!     `llm://done`        — generation complete
//!     `llm://error(msg)`  — API or network failure

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// Controls where LLM output is sent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum OutputMode {
    /// Inject text directly into the focused window without showing Preview Window.
    DirectInject,
    /// Open the Preview Window and stream tokens there.
    PreviewStream,
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

/// Calls the OpenAI chat completions API and streams the response.
///
/// Emits `llm://token`, `llm://done`, and `llm://error` events.
/// In `DirectInject` mode, injects the full output into the locked window after streaming.
pub async fn call_llm(
    api_key: &str,
    selected_text: &str,
    instruction: &str,
    output_mode: OutputMode,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Build messages based on whether we have selected text (B1/B2) or not (C)
    let (system_prompt, user_message) = if selected_text.is_empty() {
        (
            "You are a helpful assistant. Answer the user's question concisely in the same language they use.",
            instruction.to_string(),
        )
    } else {
        (
            "You are a helpful assistant. Process the user's selected text according to their instruction. Reply with only the processed result, no explanation.",
            format!("Selected text:\n\n{selected_text}\n\nInstruction: {instruction}"),
        )
    };

    let body = serde_json::json!({
        "model": "gpt-4o-mini",
        "stream": true,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_message },
        ]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let msg = format!("LLM API request failed: {e}");
            let _ = app.emit("llm://error", LlmError { message: msg.clone() });
            msg
        })?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        let msg = format!("LLM API error ({status}): {error_body}");
        let _ = app.emit("llm://error", LlmError { message: msg.clone() });
        return Err(msg);
    }

    // Stream SSE response
    let mut stream = resp.bytes_stream();
    let mut line_buf = String::new();
    let mut full_output = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let msg = format!("Stream read error: {e}");
            let _ = app.emit("llm://error", LlmError { message: msg.clone() });
            msg
        })?;

        let text = String::from_utf8_lossy(&chunk);
        line_buf.push_str(&text);

        // Process complete lines
        while let Some(newline_pos) = line_buf.find('\n') {
            let line = line_buf[..newline_pos].trim_end_matches('\r').to_string();
            line_buf = line_buf[newline_pos + 1..].to_string();

            // Skip empty lines and SSE comment lines
            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            // Strip "data: " prefix
            let data = if let Some(stripped) = line.strip_prefix("data: ") {
                stripped
            } else {
                continue;
            };

            // Check for stream end
            if data == "[DONE]" {
                let _ = app.emit("llm://done", ());
                println!("[llm] Stream complete, {} chars total", full_output.len());

                // DirectInject: inject full output into locked window
                if output_mode == OutputMode::DirectInject && !full_output.is_empty() {
                    if let Err(e) = crate::injection::inject_text(&full_output) {
                        let msg = format!("Injection failed: {e}");
                        let _ = app.emit("llm://error", LlmError { message: msg.clone() });
                        return Err(msg);
                    }
                    println!("[llm] DirectInject: injected {} chars", full_output.len());
                }

                return Ok(());
            }

            // Parse JSON to extract delta content
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                    if !content.is_empty() {
                        full_output.push_str(content);
                        let _ = app.emit("llm://token", LlmToken { text: content.to_string() });
                    }
                }
            }
        }
    }

    // If we get here without [DONE], the stream ended unexpectedly
    if !full_output.is_empty() {
        let _ = app.emit("llm://done", ());

        if output_mode == OutputMode::DirectInject {
            if let Err(e) = crate::injection::inject_text(&full_output) {
                let msg = format!("Injection failed: {e}");
                let _ = app.emit("llm://error", LlmError { message: msg.clone() });
                return Err(msg);
            }
        }
    }

    Ok(())
}
