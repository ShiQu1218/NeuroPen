//! Window focus locking.
//!
//! Each interaction receives a monotonically increasing session id together
//! with its target HWND.  Commands that received a session id must match that
//! exact lock, rather than whatever window happened to lock most recently.

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

/// A target captured at the start of one user interaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FocusLock {
    pub hwnd: isize,
    pub session_id: u64,
}

static LOCKED_FOCUS: Mutex<FocusLock> = Mutex::new(FocusLock {
    hwnd: 0,
    session_id: 0,
});
static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

/// Preview/LLM requests can outlive the foreground UI event that created them.
/// Keep the captured target by request id so a late Replace never falls through
/// to a newer window lock.
static REQUEST_LOCKS: Lazy<Mutex<HashMap<String, FocusLock>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
const MAX_REQUEST_LOCKS: usize = 64;

fn current_lock() -> FocusLock {
    LOCKED_FOCUS
        .lock()
        .map(|guard| *guard)
        .unwrap_or(FocusLock {
            hwnd: 0,
            session_id: 0,
        })
}

fn matches_current_lock(expected: FocusLock) -> bool {
    expected.session_id != 0 && current_lock() == expected
}

/// Holds the focus-lock state during the short write-and-paste critical section.
/// A concurrent selection watcher cannot replace the target session while this
/// guard exists.
pub struct FocusSessionGuard {
    lock: std::sync::MutexGuard<'static, FocusLock>,
}

impl FocusSessionGuard {
    pub fn hwnd(&self) -> isize {
        self.lock.hwnd
    }

    pub fn verify_foreground(&self) -> bool {
        is_foreground_hwnd(self.lock.hwnd)
    }
}

pub fn acquire_session_guard(session_id: u64) -> Result<FocusSessionGuard, String> {
    let lock = LOCKED_FOCUS
        .lock()
        .map_err(|error| format!("Focus lock poisoned: {error}"))?;
    if lock.hwnd == 0 || lock.session_id != session_id {
        return Err("輸入目標已更新，請重新開始操作".into());
    }
    Ok(FocusSessionGuard { lock })
}

/// Captures the currently focused window handle and creates a new session.
pub fn lock_foreground_window() -> FocusLock {
    // Capture the foreground HWND only after obtaining the same lock used by
    // injection. This prevents a stale HWND sampled while a paste is in flight.
    let mut guard = LOCKED_FOCUS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    #[cfg(target_os = "windows")]
    let hwnd = unsafe { GetForegroundWindow().0 as isize };
    #[cfg(not(target_os = "windows"))]
    let hwnd = 0;

    let lock = FocusLock {
        hwnd,
        session_id: NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed),
    };
    *guard = lock;
    println!(
        "[window_focus] Locked HWND: {:?} (session {})",
        lock.hwnd, lock.session_id
    );
    lock
}

/// Returns the locked window handle for legacy callers.
pub fn get_locked_hwnd() -> isize {
    current_lock().hwnd
}

/// Returns the current focus-lock session id.
pub fn get_locked_session_id() -> u64 {
    current_lock().session_id
}

/// Associates an LLM/preview request with its original focus lock.
///
/// A request must name an explicit session or inherit an already-bound source
/// request.  Falling back to the latest global lock would let a delayed UI
/// event silently retarget an older request.
pub fn bind_request_to_session(
    request_id: &str,
    session_id: Option<u64>,
    source_request_id: Option<&str>,
) -> Result<(), String> {
    let request_id = request_id.trim();
    if request_id.is_empty() {
        return Err("缺少請求識別碼，無法綁定輸入目標".into());
    }

    let lock = if let Some(source_request_id) = source_request_id.filter(|id| !id.trim().is_empty())
    {
        let source_lock = request_lock(source_request_id)
            .ok_or_else(|| "找不到原始請求的輸入目標，請重新開始".to_string())?;
        if session_id.is_some_and(|expected| expected != source_lock.session_id)
            || !matches_current_lock(source_lock)
        {
            return Err("輸入目標已更新，請重新執行操作".into());
        }
        source_lock
    } else {
        let expected_session =
            session_id.ok_or_else(|| "缺少輸入目標工作階段，拒絕綁定最新視窗".to_string())?;
        let lock = current_lock();
        if lock.session_id == 0 || lock.session_id != expected_session {
            return Err("輸入目標已更新，請重新執行操作".into());
        }
        lock
    };

    let mut requests = REQUEST_LOCKS
        .lock()
        .map_err(|error| format!("Focus request lock poisoned: {error}"))?;
    if let Some(existing) = requests.get(request_id) {
        if *existing != lock {
            return Err("此請求已綁定其他輸入目標，拒絕重新導向".into());
        }
        return Ok(());
    }
    if !requests.contains_key(request_id) && requests.len() >= MAX_REQUEST_LOCKS {
        if let Some(oldest_key) = requests.keys().next().cloned() {
            requests.remove(&oldest_key);
        }
    }
    requests.insert(request_id.to_string(), lock);
    Ok(())
}

fn request_lock(request_id: &str) -> Option<FocusLock> {
    REQUEST_LOCKS
        .lock()
        .ok()
        .and_then(|requests| requests.get(request_id.trim()).copied())
}

/// Returns the focus session that was captured for a request.
pub fn request_session_id(request_id: &str) -> Option<u64> {
    request_lock(request_id).map(|lock| lock.session_id)
}

/// Restore focus to the current lock, or to a matching explicit session.
/// Returns true if focus was successfully restored.
pub fn restore_focus_for_session(session_id: Option<u64>) -> bool {
    let lock = current_lock();
    if lock.hwnd == 0 || session_id.is_some_and(|expected| expected != lock.session_id) {
        return false;
    }

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
        let hwnd = HWND(lock.hwnd as *mut _);
        let ok = unsafe { SetForegroundWindow(hwnd) };
        println!(
            "[window_focus] restore_focus to HWND={}, session={}, result={ok:?}",
            lock.hwnd, lock.session_id
        );
        ok.into()
    }
    #[cfg(not(target_os = "windows"))]
    {
        true
    }
}

/// Restore focus only when the request's original target is still the active
/// lock. Never switch an old preview back to a target after a new session starts.
pub fn restore_focus_for_request(request_id: &str) -> bool {
    let Some(lock) = request_lock(request_id) else {
        return false;
    };
    if !matches_current_lock(lock) {
        return false;
    }
    restore_focus_for_session(Some(lock.session_id))
}

/// Legacy wrapper that restores the currently locked window.
pub fn restore_focus() -> bool {
    restore_focus_for_session(None)
}

/// Returns true when `hwnd` is currently foreground.
pub fn is_foreground_hwnd(hwnd: isize) -> bool {
    if hwnd == 0 {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        let current = unsafe { GetForegroundWindow() };
        current.0 as isize == hwnd
    }
    #[cfg(not(target_os = "windows"))]
    {
        true
    }
}

/// Returns true if the foreground window still matches a captured session.
pub fn verify_focus_for_session(session_id: Option<u64>) -> bool {
    let lock = current_lock();
    if lock.hwnd == 0 || session_id.is_some_and(|expected| expected != lock.session_id) {
        return false;
    }
    let unchanged = is_foreground_hwnd(lock.hwnd);
    if !unchanged {
        #[cfg(target_os = "windows")]
        {
            let current = unsafe { GetForegroundWindow() };
            println!(
                "[window_focus] Focus changed! locked={}, session={}, current={}",
                lock.hwnd, lock.session_id, current.0 as isize
            );
        }
    }
    unchanged
}

/// Returns true only when a request remains bound to the active lock and that
/// window is still foreground.
pub fn verify_focus_for_request(request_id: &str) -> bool {
    let Some(lock) = request_lock(request_id) else {
        return false;
    };
    matches_current_lock(lock) && is_foreground_hwnd(lock.hwnd)
}

/// Legacy wrapper that checks the current lock.
pub fn verify_focus_unchanged() -> bool {
    verify_focus_for_session(None)
}

/// Returns foreground window title (best-effort), empty when unavailable.
pub fn get_foreground_window_title() -> String {
    #[cfg(target_os = "windows")]
    {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            return String::new();
        }
        let mut buf = vec![0u16; 512];
        let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if len <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..len as usize])
            .trim()
            .to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matching_session_requires_the_same_generation_and_window() {
        let expected = FocusLock {
            hwnd: 42,
            session_id: 7,
        };
        let same = FocusLock {
            hwnd: 42,
            session_id: 7,
        };
        let newer = FocusLock {
            hwnd: 42,
            session_id: 8,
        };
        let other_window = FocusLock {
            hwnd: 43,
            session_id: 7,
        };

        assert_eq!(expected, same);
        assert_ne!(expected, newer);
        assert_ne!(expected, other_window);
    }

    #[test]
    fn request_binding_requires_an_explicit_or_inherited_session() {
        assert!(bind_request_to_session("missing-session-test", None, None).is_err());
    }
}
