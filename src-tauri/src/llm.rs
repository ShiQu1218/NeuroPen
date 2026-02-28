//! OpenAI streaming LLM client.
//!
//! Phase 3 implementation:
//! - POST /v1/chat/completions with `stream: true`
//! - Parse Server-Sent Events (SSE) line by line
//! - Emit Tauri events:
//!     `llm://token(text)` — each streamed token
//!     `llm://done`        — generation complete
//!     `llm://error(msg)`  — API or network failure

/// Controls where LLM output is sent.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
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

/// Calls the OpenAI chat completions API and streams the response.
///
/// # Arguments
/// * `api_key`       — OpenAI API key
/// * `selected_text` — text selected by the user (empty for Mode C)
/// * `instruction`   — voice command or preset prompt
/// * `output_mode`   — where to send the output
/// * `app`           — Tauri app handle for emitting events
#[allow(dead_code)]
pub async fn call_llm(
    api_key: String,
    selected_text: String,
    instruction: String,
    output_mode: OutputMode,
    _app: tauri::AppHandle,
) -> Result<(), String> {
    // TODO Phase 3:
    //   1. Build messages array from selected_text + instruction
    //   2. POST to https://api.openai.com/v1/chat/completions with stream:true
    //   3. Parse SSE, emit llm://token for each delta
    //   4. Emit llm://done on [DONE]
    let _ = (api_key, selected_text, instruction, output_mode);
    Ok(())
}
