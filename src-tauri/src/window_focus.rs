//! Window focus locking.
//!
//! Phase 1 implementation:
//! - `lock_foreground_window()` — capture HWND at hotkey trigger time
//! - `verify_focus_unchanged()` — confirm window is still focused before injection
//!
//! Uses Win32 `GetForegroundWindow` via the `windows` crate.

use std::sync::Mutex;

#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

/// Stores the HWND (as isize) captured at hotkey trigger time.
static LOCKED_HWND: Mutex<isize> = Mutex::new(0);

/// Captures the currently focused window handle.
pub fn lock_foreground_window() {
    #[cfg(target_os = "windows")]
    {
        let hwnd = unsafe { GetForegroundWindow() };
        if let Ok(mut guard) = LOCKED_HWND.lock() {
            *guard = hwnd.0 as isize;
        }
        println!("[window_focus] Locked HWND: {:?}", hwnd.0);
    }
    #[cfg(not(target_os = "windows"))]
    {
        println!("[window_focus] Not on Windows, skipping lock");
    }
}

/// Returns the locked window handle.
pub fn get_locked_hwnd() -> isize {
    LOCKED_HWND.lock().map(|h| *h).unwrap_or(0)
}

/// Returns true if the foreground window hasn't changed since locking.
/// Returns false (→ cancel injection and warn user) if focus has moved.
pub fn verify_focus_unchanged() -> bool {
    #[cfg(target_os = "windows")]
    {
        let current = unsafe { GetForegroundWindow() };
        let locked = get_locked_hwnd();
        let unchanged = current.0 as isize == locked && locked != 0;
        if !unchanged {
            println!(
                "[window_focus] Focus changed! locked={}, current={}",
                locked, current.0 as isize
            );
        }
        unchanged
    }
    #[cfg(not(target_os = "windows"))]
    {
        true
    }
}
