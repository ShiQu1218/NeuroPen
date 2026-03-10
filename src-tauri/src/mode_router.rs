//! Mode router — decides between Mode A, B, and C.
//!
//! Routing logic (triggered by Alt+Space hotkey):
//!
//! ```text
//! Alt+Space pressed
//! ├── Text selected?  → Mode B (B1 via Quick Action Icon / B2 via voice command)
//! └── No selection    → Start STT recording
//!       ├── Wake word detected in transcript → Mode C (LLM query)
//!       └── No wake word                    → Mode A (direct STT injection)
//! ```
//!
//! Phase 2: full routing with STT integration and wake word scanning.

use serde::{Deserialize, Serialize};

/// The operating mode selected for a given hotkey trigger.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AppMode {
    /// Direct voice input — STT result injected into focused window.
    A,
    /// Quick Action Icon — preset command on selected text.
    B1,
    /// Voice command on selection — STT instruction passed to LLM with selected text.
    B2,
    /// LLM query — wake word detected, full query sent to LLM.
    C,
}

/// Result of analyzing a completed STT transcript.
#[derive(Debug, Clone, Serialize)]
pub struct RouteResult {
    /// The mode determined by routing logic.
    pub mode: AppMode,
    /// The cleaned transcript (wake word stripped if Mode C).
    pub transcript: String,
    /// Selected text, if any (for Mode B).
    pub selected_text: Option<String>,
    /// Whether incognito mode is active (suppresses LLM).
    pub incognito: bool,
}

/// Determines the initial routing when Alt+Space is pressed.
/// If text is selected → Mode B (the frontend decides B1 vs B2).
/// If no text selected → start recording (Mode A or C determined after STT).
pub fn route_on_trigger(has_selection: bool) -> AppMode {
    if has_selection {
        // B1 or B2 — frontend will differentiate based on user interaction
        AppMode::B2
    } else {
        // Will become A or C after STT completes
        AppMode::A
    }
}

/// After STT transcription is complete, determine final mode based on
/// wake word presence.
///
/// Returns (final_mode, cleaned_transcript):
/// - If wake word found → (Mode C, transcript with wake word removed)
/// - If no wake word    → (Mode A, original transcript)
pub fn route_after_stt(transcript: &str, wake_word: &str) -> (AppMode, String) {
    if let Some(cleaned) = strip_wake_word(transcript, wake_word) {
        (AppMode::C, cleaned)
    } else {
        (AppMode::A, transcript.to_string())
    }
}

/// Check if transcript contains the wake word and strip it.
/// Returns Some(cleaned_transcript) if wake word was found, None otherwise.
///
/// The wake word can appear at the beginning, end, or middle of the transcript.
/// Common patterns:
///   "助理 今天天氣如何" → "今天天氣如何"
///   "今天天氣如何 助理" → "今天天氣如何"
///   "助理今天天氣如何"  → "今天天氣如何"
fn strip_wake_word(transcript: &str, wake_word: &str) -> Option<String> {
    let trimmed = transcript.trim();
    if trimmed.is_empty() || wake_word.is_empty() {
        return None;
    }

    // Case-insensitive search for the wake word
    let lower = trimmed.to_lowercase();
    let wake_lower = wake_word.to_lowercase();

    if let Some(pos) = lower.find(&wake_lower) {
        let before = &trimmed[..pos];
        let after = &trimmed[pos + wake_word.len()..];
        let cleaned = format!("{}{}", before.trim(), after.trim()).trim().to_string();

        if cleaned.is_empty() {
            // User only said the wake word — still Mode C but with empty query
            Some(String::new())
        } else {
            Some(cleaned)
        }
    } else {
        None
    }
}

/// Build a full RouteResult after STT transcription completes.
pub fn build_route_result(
    transcript: &str,
    selected_text: Option<String>,
    wake_word: &str,
    incognito: bool,
) -> RouteResult {
    if selected_text.is_some() {
        // Mode B2 — voice command on selected text
        RouteResult {
            mode: AppMode::B2,
            transcript: transcript.to_string(),
            selected_text,
            incognito,
        }
    } else {
        let (mode, cleaned) = route_after_stt(transcript, wake_word);
        RouteResult {
            mode,
            transcript: cleaned,
            selected_text: None,
            incognito,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_wake_word_beginning() {
        let result = strip_wake_word("助理 今天天氣如何", "助理");
        assert_eq!(result, Some("今天天氣如何".to_string()));
    }

    #[test]
    fn test_strip_wake_word_end() {
        let result = strip_wake_word("今天天氣如何 助理", "助理");
        assert_eq!(result, Some("今天天氣如何".to_string()));
    }

    #[test]
    fn test_strip_wake_word_no_space() {
        let result = strip_wake_word("助理今天天氣如何", "助理");
        assert_eq!(result, Some("今天天氣如何".to_string()));
    }

    #[test]
    fn test_no_wake_word() {
        let result = strip_wake_word("今天天氣如何", "助理");
        assert_eq!(result, None);
    }

    #[test]
    fn test_only_wake_word() {
        let result = strip_wake_word("助理", "助理");
        assert_eq!(result, Some(String::new()));
    }

    #[test]
    fn test_route_after_stt_mode_c() {
        let (mode, text) = route_after_stt("助理 翻譯這段話", "助理");
        assert_eq!(mode, AppMode::C);
        assert_eq!(text, "翻譯這段話");
    }

    #[test]
    fn test_route_after_stt_mode_a() {
        let (mode, text) = route_after_stt("今天天氣很好", "助理");
        assert_eq!(mode, AppMode::A);
        assert_eq!(text, "今天天氣很好");
    }

    #[test]
    fn test_route_on_trigger_with_selection() {
        assert_eq!(route_on_trigger(true), AppMode::B2);
    }

    #[test]
    fn test_route_on_trigger_no_selection() {
        assert_eq!(route_on_trigger(false), AppMode::A);
    }
}
