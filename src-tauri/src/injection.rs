//! Text injection engine.
//!
//! Phase 1 implementation:
//! - Write `text` to clipboard
//! - Simulate Ctrl+V on the locked foreground window
//! - On failure return `InjectionError::Blocked` — do NOT retry
//!
//! Text injection flow (per spec):
//!   cache clipboard → lock window → (Mode B: Ctrl+C) →
//!   STT/LLM → verify focus → write clipboard → Ctrl+V → restore clipboard

use crate::clipboard;
use crate::window_focus;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub enum InjectionError {
    /// The target application blocked simulated Ctrl+V input.
    Blocked,
    /// The foreground window changed between trigger and injection.
    FocusChanged,
    /// Clipboard operation failed.
    ClipboardError(String),
}

impl std::fmt::Display for InjectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InjectionError::Blocked => write!(f, "此應用程式不支援自動輸入"),
            InjectionError::FocusChanged => write!(f, "輸入目標已改變，請重試"),
            InjectionError::ClipboardError(e) => write!(f, "剪貼簿錯誤: {e}"),
        }
    }
}

/// Simulate Ctrl+V keystroke via Win32 SendInput.
#[cfg(target_os = "windows")]
fn simulate_ctrl_v() -> Result<(), InjectionError> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };

    const VK_CONTROL: u16 = 0x11;
    const VK_V: u16 = 0x56;

    let inputs = [
        // Ctrl down
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_CONTROL),
                    wScan: 0,
                    dwFlags: Default::default(),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        // V down
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_V),
                    wScan: 0,
                    dwFlags: Default::default(),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        // V up
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_V),
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        // Ctrl up
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_CONTROL),
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];

    let sent = unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32)
    };
    if sent != inputs.len() as u32 {
        return Err(InjectionError::Blocked);
    }
    // Small delay to let the target app process the paste
    std::thread::sleep(std::time::Duration::from_millis(100));
    Ok(())
}

/// Simulate Ctrl+C keystroke via Win32 SendInput.
#[cfg(target_os = "windows")]
pub fn simulate_ctrl_c() -> Result<(), InjectionError> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };

    const VK_CONTROL: u16 = 0x11;
    const VK_C: u16 = 0x43;

    let inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_CONTROL),
                    wScan: 0,
                    dwFlags: Default::default(),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_C),
                    wScan: 0,
                    dwFlags: Default::default(),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_C),
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(VK_CONTROL),
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];

    let sent = unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32)
    };
    if sent != inputs.len() as u32 {
        return Err(InjectionError::Blocked);
    }
    std::thread::sleep(std::time::Duration::from_millis(150));
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn simulate_ctrl_v() -> Result<(), InjectionError> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn simulate_ctrl_c() -> Result<(), InjectionError> {
    Ok(())
}

/// Injects `text` into the currently locked foreground window.
///
/// Steps:
///   1. Verify focus window is unchanged → `FocusChanged` if moved
///   2. Write text to clipboard
///   3. Simulate Ctrl+V
///
/// NOTE: Clipboard restore is the caller's responsibility.
/// This avoids double-restore issues and gives the target app enough
/// time to process the paste before the clipboard content changes.
pub fn inject_text(text: &str) -> Result<(), InjectionError> {
    // 1. Verify focus
    if !window_focus::verify_focus_unchanged() {
        return Err(InjectionError::FocusChanged);
    }

    // 2. Write to clipboard
    clipboard::write_clipboard(text).map_err(InjectionError::ClipboardError)?;

    // 3. Simulate Ctrl+V
    simulate_ctrl_v()?;

    println!("[injection] Injected {} chars", text.len());
    Ok(())
}

pub fn inject_text_with_undo(text: &str, record_for_undo: bool) -> Result<(), InjectionError> {
    let hwnd = window_focus::get_locked_hwnd();
    inject_text(text)?;
    if record_for_undo {
        crate::undo::record_injection(hwnd, text.to_string());
    }
    Ok(())
}

/// Reads selected text from the target window by simulating Ctrl+C.
/// Assumes clipboard has already been cached.
pub fn read_selection_via_clipboard() -> Result<String, InjectionError> {
    let _op = clipboard::acquire_op_lock().map_err(InjectionError::ClipboardError)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sentinel = format!("__TALKFLOW_SELECTION_SENTINEL_{}_{}__", std::process::id(), now);
    clipboard::write_clipboard(&sentinel).map_err(InjectionError::ClipboardError)?;
    simulate_ctrl_c()?;
    let text = clipboard::read_clipboard().map_err(InjectionError::ClipboardError)?;
    if text.trim().is_empty() || text == sentinel {
        return Err(InjectionError::ClipboardError(
            "Cannot safely read the current selection from clipboard".to_string(),
        ));
    }
    Ok(text)
}
