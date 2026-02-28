//! Mode router — decides between Mode A, B, and C.
//!
//! Routing logic (triggered by Alt+Space hotkey):
//!
//! ```
//! Alt+Space pressed
//! ├── Text selected?  → Mode B (B1 via Quick Action Icon / B2 via voice command)
//! └── No selection    → Start STT
//!       ├── Wake word detected mid-stream → Mode C (LLM query)
//!       └── No wake word                 → Mode A (direct STT injection)
//! ```
//!
//! Phase 2 implementation: wire to stt.rs and selection.rs.

/// The operating mode selected for a given hotkey trigger.
#[derive(Debug, Clone, PartialEq)]
pub enum AppMode {
    /// Direct voice input — STT result injected into focused window.
    A,
    /// Voice command on selection — STT instruction passed to LLM with selected text.
    B2,
    /// LLM query — wake word detected, full query sent to LLM.
    C,
}

/// Default wake word (user-configurable in settings).
pub const DEFAULT_WAKE_WORD: &str = "助理";

/// Determines which mode to activate when `Alt+Space` is pressed.
/// `selected_text` is `Some(text)` when UI Automation found a selection.
/// `incognito` suppresses all LLM calls.
#[allow(dead_code)]
pub fn route(selected_text: Option<String>, incognito: bool) -> AppMode {
    // TODO Phase 2: integrate with stt::start_recording and wake word scanner
    let _ = (selected_text, incognito);
    AppMode::A
}

/// Scans a partial STT transcript for the wake word.
/// Returns true and immediately switches routing to Mode C when found.
#[allow(dead_code)]
pub fn contains_wake_word(transcript: &str, wake_word: &str) -> bool {
    transcript.contains(wake_word)
}
