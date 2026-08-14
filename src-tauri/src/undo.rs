//! Undo stack for text injection.
//!
//! Phase 1 implementation:
//! - Stores the last direct injection so `Alt+Z` can revert it
//! - Only Mode A (direct STT injection) is undoable
//! - LLM Preview Window "Replace" actions are NOT tracked here
//!
//! Undo strategy:
//!   The injected text sits right after the cursor position.
//!   We simulate Backspace N times to remove the injected characters.

use std::sync::Mutex;

/// A record of a single direct injection that can be undone.
#[derive(Debug, Clone)]
pub struct InjectionRecord {
    /// The window handle that received the injection.
    pub hwnd: isize,
    /// Text that was injected (to be removed on undo).
    pub injected: String,
}

static LAST_INJECTION: Mutex<Option<InjectionRecord>> = Mutex::new(None);

/// Records a completed injection for potential undo.
pub fn record_injection(hwnd: isize, injected: String) {
    if let Ok(mut guard) = LAST_INJECTION.lock() {
        println!(
            "[undo] Recorded injection of {} chars for HWND {}",
            injected.len(),
            hwnd
        );
        *guard = Some(InjectionRecord { hwnd, injected });
    }
}

/// Drops any pending direct-injection undo record.
///
/// Replace flows can overwrite a selection, so backspacing the previous record
/// afterwards would delete unrelated user content.
pub fn clear_last_injection() {
    if let Ok(mut guard) = LAST_INJECTION.lock() {
        *guard = None;
    }
}

/// Reverts the last recorded injection by simulating Backspace keys.
/// Returns `Ok(true)` if an undo was performed, `Ok(false)` if nothing to undo.
pub fn undo_last_injection() -> Result<bool, String> {
    let record = LAST_INJECTION
        .lock()
        .map_err(|e| format!("Mutex poisoned: {e}"))?
        .take();

    match record {
        Some(mut rec) => {
            // Verify the record's original target rather than the latest global
            // lock. A newer session may have captured another HWND meanwhile.
            if !crate::window_focus::is_foreground_hwnd(rec.hwnd) {
                // Put the record back so undo can be retried after refocusing.
                if let Ok(mut guard) = LAST_INJECTION.lock() {
                    *guard = Some(rec);
                }
                return Err("焦點視窗已變更，取消復原。請切回原視窗後再試。".into());
            }

            let char_count = rec.injected.chars().count();
            println!("[undo] Undoing {} chars for HWND {}", char_count, rec.hwnd);

            if let Err(failure) = simulate_backspaces(char_count, rec.hwnd) {
                // Backspace removes from the end of the injected text. Keep the
                // untouched prefix so a retry after refocusing cannot delete more
                // text than remains from this injection.
                let remaining_count = char_count.saturating_sub(failure.removed);
                if remaining_count > 0 {
                    rec.injected = rec.injected.chars().take(remaining_count).collect();
                    if let Ok(mut guard) = LAST_INJECTION.lock() {
                        *guard = Some(rec);
                    }
                }
                return Err(failure.message);
            }

            Ok(true)
        }
        None => {
            println!("[undo] Nothing to undo");
            Ok(false)
        }
    }
}

struct UndoFailure {
    removed: usize,
    message: String,
}

/// Simulate N Backspace keystrokes via SendInput.
#[cfg(target_os = "windows")]
fn simulate_backspaces(count: usize, hwnd: isize) -> Result<(), UndoFailure> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    };

    const VK_BACK: u16 = 0x08;

    let mut removed = 0;
    for _ in 0..count {
        // The target can change during a long undo. Check immediately before
        // every key so remaining Backspaces never continue in the new window.
        if !crate::window_focus::is_foreground_hwnd(hwnd) {
            return Err(UndoFailure {
                removed,
                message: "焦點視窗已變更，已停止復原。請切回原視窗後再試。".into(),
            });
        }
        let inputs = [
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(VK_BACK),
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
                        wVk: VIRTUAL_KEY(VK_BACK),
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
            // A key-down may already have reached the target even if the
            // matching key-up did not. Treat it as consumed to avoid a retry
            // deleting one extra character.
            if sent > 0 {
                removed += 1;
            }
            return Err(UndoFailure {
                removed,
                message: "SendInput failed for Backspace".into(),
            });
        }
        removed += 1;
        // Small delay between keystrokes to avoid overwhelming the target app
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn simulate_backspaces(count: usize, _hwnd: isize) -> Result<(), UndoFailure> {
    let _ = count;
    Ok(())
}
