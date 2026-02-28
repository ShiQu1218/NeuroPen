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

/// Reverts the last recorded injection by simulating Backspace keys.
/// Returns `Ok(true)` if an undo was performed, `Ok(false)` if nothing to undo.
pub fn undo_last_injection() -> Result<bool, String> {
    let record = LAST_INJECTION
        .lock()
        .map_err(|e| format!("Mutex poisoned: {e}"))?
        .take();

    match record {
        Some(rec) => {
            let char_count = rec.injected.chars().count();
            println!(
                "[undo] Undoing {} chars for HWND {}",
                char_count, rec.hwnd
            );

            #[cfg(target_os = "windows")]
            {
                simulate_backspaces(char_count)?;
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = char_count;
            }

            Ok(true)
        }
        None => {
            println!("[undo] Nothing to undo");
            Ok(false)
        }
    }
}

/// Simulate N Backspace keystrokes via SendInput.
#[cfg(target_os = "windows")]
fn simulate_backspaces(count: usize) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    };

    const VK_BACK: u16 = 0x08;

    for _ in 0..count {
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
            return Err("SendInput failed for Backspace".into());
        }
        // Small delay between keystrokes to avoid overwhelming the target app
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    Ok(())
}
