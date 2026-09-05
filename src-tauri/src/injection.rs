//! Text injection engine.
//!
//! Injection implementation:
//! - Prefer a temporary clipboard write followed by Ctrl+V
//! - Fall back to Unicode keyboard input when the existing clipboard contains
//!   rich or protected formats that this app cannot reconstruct
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
    /// The interaction target was replaced by a newer session.
    SessionExpired,
}

impl std::fmt::Display for InjectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InjectionError::Blocked => write!(f, "此應用程式不支援自動輸入"),
            InjectionError::FocusChanged => write!(f, "輸入目標已改變，請重試"),
            InjectionError::ClipboardError(e) => write!(f, "剪貼簿錯誤: {e}"),
            InjectionError::SessionExpired => write!(f, "此操作已過期，請重新開始"),
        }
    }
}

/// Simulate Ctrl+V keystroke via Win32 SendInput.
#[cfg(target_os = "windows")]
fn simulate_ctrl_v() -> Result<(), InjectionError> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
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

    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err(InjectionError::Blocked);
    }
    // Small delay to let the target app process the paste
    std::thread::sleep(std::time::Duration::from_millis(100));
    Ok(())
}

/// Inject UTF-16 code units directly so rich/protected clipboard contents never
/// need to be replaced. KEYEVENTF_UNICODE bypasses the active keyboard layout
/// and IME while preserving the target's normal typed-text behavior.
#[cfg(target_os = "windows")]
fn simulate_unicode_text(
    text: &str,
    focus_guard: &window_focus::FocusSessionGuard,
) -> Result<(), InjectionError> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
        VIRTUAL_KEY,
    };

    const UTF16_UNITS_PER_CHUNK: usize = 128;
    let utf16: Vec<u16> = text.encode_utf16().collect();

    for chunk in utf16.chunks(UTF16_UNITS_PER_CHUNK) {
        if !focus_guard.verify_foreground() {
            return Err(InjectionError::FocusChanged);
        }

        let mut inputs = Vec::with_capacity(chunk.len() * 2);
        for &unit in chunk {
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: unit,
                        dwFlags: KEYEVENTF_UNICODE,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: unit,
                        dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
        }

        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent != inputs.len() as u32 {
            return Err(InjectionError::Blocked);
        }
    }

    Ok(())
}

/// Send the Ctrl+C key sequence without any sleep. Used by selection.rs.
#[cfg(target_os = "windows")]
pub fn simulate_ctrl_c_raw() -> Result<(), InjectionError> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
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

    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err(InjectionError::Blocked);
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn simulate_ctrl_v() -> Result<(), InjectionError> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn simulate_unicode_text(
    _text: &str,
    _focus_guard: &window_focus::FocusSessionGuard,
) -> Result<(), InjectionError> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn simulate_ctrl_c_raw() -> Result<(), InjectionError> {
    Ok(())
}

/// Injects `text` into the currently locked foreground window.
///
/// Steps:
///   1. Verify focus window is unchanged → `FocusChanged` if moved
///   2. Use clipboard paste when its original formats are reconstructable
///   3. Otherwise type Unicode directly without changing the clipboard
///
/// NOTE: Clipboard restore is the caller's responsibility.
/// This avoids double-restore issues and gives the target app enough
/// time to process the paste before the clipboard content changes.
pub fn inject_text_for_session(text: &str, session_id: u64) -> Result<(), InjectionError> {
    // A clipboard cache and focus lock are both tied to this exact interaction.
    // Never let a delayed result use a newer global HWND.
    // Keep write + paste together so another flow cannot replace the temporary
    // clipboard contents between them.
    let _op = clipboard::acquire_op_lock().map_err(InjectionError::ClipboardError)?;
    let focus_guard = window_focus::acquire_session_guard(session_id)
        .map_err(|_| InjectionError::FocusChanged)?;

    // Clipboard restoration is one-shot. Recreate the snapshot when the same
    // preview session performs another Replace after its previous restore.
    clipboard::ensure_clipboard_cache_for_session_locked(session_id)
        .map_err(InjectionError::ClipboardError)?;

    // Re-check after taking the operation lock. A selection watcher can create
    // a newer focus lock while this command is waiting for clipboard access;
    // the focus guard now keeps that session stable until paste completes.
    if !focus_guard.verify_foreground() {
        return Err(InjectionError::FocusChanged);
    }

    let can_use_clipboard = clipboard::can_temporarily_replace_for_session(session_id)
        .map_err(InjectionError::ClipboardError)?;
    if can_use_clipboard {
        clipboard::write_clipboard_for_session(text, session_id)
            .map_err(InjectionError::ClipboardError)?;

        // Writing the clipboard can yield briefly to Windows. Verify once more
        // so we never paste into a target that changed in that interval.
        if !focus_guard.verify_foreground() {
            return Err(InjectionError::FocusChanged);
        }
        simulate_ctrl_v()?;
    } else {
        simulate_unicode_text(text, &focus_guard)?;
    }

    println!(
        "[injection] Injected {} chars for HWND {} session {session_id} via {}",
        text.len(),
        focus_guard.hwnd(),
        if can_use_clipboard {
            "clipboard"
        } else {
            "unicode"
        }
    );
    Ok(())
}

/// Legacy entrypoint retained for backend callers. It only uses the currently
/// cached interaction session and still verifies that the lock has not changed.
pub fn inject_text(text: &str) -> Result<(), InjectionError> {
    let session_id = clipboard::cached_session_id().ok_or(InjectionError::SessionExpired)?;
    inject_text_for_session(text, session_id)
}

pub fn inject_text_with_undo_for_session(
    text: &str,
    record_for_undo: bool,
    session_id: u64,
) -> Result<(), InjectionError> {
    let hwnd = window_focus::get_locked_hwnd();
    inject_text_for_session(text, session_id)?;
    if record_for_undo {
        crate::undo::record_injection(hwnd, text.to_string());
    } else {
        // A Replace action may have overwritten selected text, so the old
        // direct-injection record is no longer safe to backspace.
        crate::undo::clear_last_injection();
    }
    Ok(())
}

pub fn inject_text_with_undo(text: &str, record_for_undo: bool) -> Result<(), InjectionError> {
    let session_id = clipboard::cached_session_id().ok_or(InjectionError::SessionExpired)?;
    inject_text_with_undo_for_session(text, record_for_undo, session_id)
}

/// Reads selected text from the target window by simulating Ctrl+C.
/// Assumes clipboard has already been cached.
/// Polls up to 500ms (every 25ms) for the clipboard to change from the sentinel
/// instead of using a fixed 150ms sleep.
pub fn read_selection_via_clipboard() -> Result<String, InjectionError> {
    let _op = clipboard::acquire_op_lock().map_err(InjectionError::ClipboardError)?;
    let session_id = clipboard::cached_session_id().ok_or(InjectionError::SessionExpired)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sentinel = format!(
        "__NEUROPEN_SELECTION_SENTINEL_{}_{}__",
        std::process::id(),
        now
    );
    clipboard::write_clipboard_for_session(&sentinel, session_id)
        .map_err(InjectionError::ClipboardError)?;
    simulate_ctrl_c_raw()?;

    // Poll until the clipboard content differs from the sentinel or 500ms elapses.
    const POLL_INTERVAL_MS: u64 = 25;
    const MAX_WAIT_MS: u64 = 500;
    let mut elapsed_ms: u64 = 0;
    let text = loop {
        std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));
        elapsed_ms += POLL_INTERVAL_MS;
        let current = clipboard::read_clipboard_for_session(session_id)
            .map_err(InjectionError::ClipboardError)?;
        if current != sentinel {
            break current;
        }
        if elapsed_ms >= MAX_WAIT_MS {
            break current;
        }
    };

    if text.trim().is_empty() || text == sentinel {
        return Err(InjectionError::ClipboardError(
            "Cannot safely read the current selection from clipboard".to_string(),
        ));
    }
    Ok(text)
}
