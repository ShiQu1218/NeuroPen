//! Clipboard manager.
//!
//! The application temporarily replaces the clipboard while pasting text.  We
//! only do that when the existing clipboard can be restored losslessly by this
//! text-only implementation.  Rich or binary formats are left untouched and
//! the caller receives an error instead of silently replacing them with an
//! empty string.

use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
enum ClipboardContents {
    Empty,
    UnicodeText(String),
    /// Clipboard formats such as images, HTML, files, or custom application
    /// payloads cannot be recreated by this module.
    Unsupported {
        formats: Vec<u32>,
    },
}

#[derive(Debug, Clone)]
struct ClipboardCache {
    session_id: u64,
    expected_sequence: u32,
    contents: ClipboardContents,
    /// Set after NeuroPen changes the clipboard. A newer session must not
    /// overwrite this cache before it has been restored or deliberately
    /// discarded.
    modified_by_app: bool,
}

static CLIPBOARD_CACHE: Mutex<Option<ClipboardCache>> = Mutex::new(None);

/// Global lock for multi-step clipboard operations (cache → use → restore).
/// Any code path that performs a sequence of clipboard reads/writes must hold
/// this lock for the whole duration to prevent interleaving with another flow.
static CLIPBOARD_OP_LOCK: Mutex<()> = Mutex::new(());

/// Acquire the clipboard operation lock. Returns a guard that releases it on drop.
/// Used by clipboard.rs functions and selection.rs clipboard fallback.
pub fn acquire_op_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    CLIPBOARD_OP_LOCK
        .lock()
        .map_err(|e| format!("Clipboard op lock poisoned: {e}"))
}

#[cfg(target_os = "windows")]
mod win32 {
    use super::ClipboardContents;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
        GetClipboardSequenceNumber, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows::Win32::System::Ole::CF_UNICODETEXT;
    use windows::Win32::UI::WindowsAndMessaging::GetDesktopWindow;

    struct OpenClipboardGuard;

    impl Drop for OpenClipboardGuard {
        fn drop(&mut self) {
            let _ = unsafe { CloseClipboard() };
        }
    }

    /// Open the clipboard with a real owner HWND. Passing NULL makes
    /// EmptyClipboard set no owner, which causes SetClipboardData to fail.
    fn open() -> Result<OpenClipboardGuard, String> {
        for attempt in 0..10 {
            let owner = unsafe { GetDesktopWindow() };
            let ok = unsafe { OpenClipboard(owner) };
            if ok.is_ok() {
                return Ok(OpenClipboardGuard);
            }
            if attempt < 9 {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
        Err("Cannot open clipboard after retries".into())
    }

    pub fn with_open<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let _guard = open()?;
        operation()
    }

    pub fn sequence_number() -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }

    fn enumerate_formats() -> Vec<u32> {
        let mut formats = Vec::new();
        let mut current = 0;
        loop {
            current = unsafe { EnumClipboardFormats(current) };
            if current == 0 {
                break;
            }
            formats.push(current);
        }
        formats
    }

    /// Classify clipboard data while it is open. The app can restore only an
    /// *exclusive* CF_UNICODETEXT payload. Even a second text or locale format
    /// can carry independent data we cannot clone, so it is conservatively
    /// treated as non-restorable rather than silently discarded.
    pub fn snapshot() -> Result<ClipboardContents, String> {
        let formats = enumerate_formats();
        if formats.is_empty() {
            return Ok(ClipboardContents::Empty);
        }
        if formats.as_slice() != [CF_UNICODETEXT.0 as u32] {
            return Ok(ClipboardContents::Unsupported { formats });
        }
        read_text().map(ClipboardContents::UnicodeText)
    }

    /// Read Unicode text from clipboard. Clipboard must already be open.
    pub fn read_text() -> Result<String, String> {
        unsafe {
            let handle = GetClipboardData(CF_UNICODETEXT.0 as u32)
                .map_err(|e| format!("GetClipboardData failed: {e}"))?;
            let hglobal = HGLOBAL(handle.0);
            let byte_len = GlobalSize(hglobal);
            if byte_len < std::mem::size_of::<u16>() {
                return Err("Clipboard Unicode text is empty or invalid".into());
            }
            let ptr = GlobalLock(hglobal) as *const u16;
            if ptr.is_null() {
                return Err("GlobalLock returned null".into());
            }
            let max_units = byte_len / std::mem::size_of::<u16>();
            let mut len = 0usize;
            while len < max_units && *ptr.add(len) != 0 {
                len += 1;
            }
            if len == max_units {
                let _ = GlobalUnlock(hglobal);
                return Err("Clipboard Unicode text is not null terminated".into());
            }
            let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
            let _ = GlobalUnlock(hglobal);
            Ok(text)
        }
    }

    /// Write Unicode text to clipboard. Clipboard must already be open.
    pub fn write_text(text: &str) -> Result<(), String> {
        unsafe {
            let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let byte_len = wide.len() * std::mem::size_of::<u16>();
            // Allocate before EmptyClipboard so an allocation failure cannot
            // destroy the user's existing clipboard contents.
            let hmem = GlobalAlloc(GMEM_MOVEABLE, byte_len)
                .map_err(|e| format!("GlobalAlloc failed: {e}"))?;
            let ptr = GlobalLock(hmem) as *mut u16;
            if ptr.is_null() {
                let _ = GlobalFree(hmem);
                return Err("GlobalLock returned null on write".into());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
            let _ = GlobalUnlock(hmem);

            if let Err(error) = EmptyClipboard() {
                let _ = GlobalFree(hmem);
                return Err(format!("EmptyClipboard failed: {error}"));
            }
            if let Err(error) = SetClipboardData(CF_UNICODETEXT.0 as u32, HANDLE(hmem.0)) {
                let _ = GlobalFree(hmem);
                return Err(format!("SetClipboardData failed: {error}"));
            }
            // Ownership of hmem has transferred to the system.
            Ok(())
        }
    }
}

fn unsupported_format_error() -> String {
    "剪貼簿包含圖片、HTML 或其他無法安全還原的格式；已取消貼上以保留原內容".into()
}

fn validate_cache_for_session(session_id: u64) -> Result<ClipboardCache, String> {
    let cache = CLIPBOARD_CACHE
        .lock()
        .map_err(|error| format!("Clipboard cache lock poisoned: {error}"))?
        .clone()
        .ok_or_else(|| "找不到此操作的剪貼簿快取，請重新開始".to_string())?;
    if cache.session_id != session_id {
        return Err("輸入操作已過期，剪貼簿已由較新的操作接管".into());
    }
    Ok(cache)
}

fn mark_cache_written(session_id: u64, expected_sequence: u32) -> Result<(), String> {
    let mut guard = CLIPBOARD_CACHE
        .lock()
        .map_err(|error| format!("Clipboard cache lock poisoned: {error}"))?;
    let cache = guard
        .as_mut()
        .ok_or_else(|| "找不到此操作的剪貼簿快取，請重新開始".to_string())?;
    if cache.session_id != session_id {
        return Err("輸入操作已過期，剪貼簿已由較新的操作接管".into());
    }
    cache.expected_sequence = expected_sequence;
    cache.modified_by_app = true;
    Ok(())
}

fn mark_cache_write_started(session_id: u64) -> Result<(), String> {
    let mut guard = CLIPBOARD_CACHE
        .lock()
        .map_err(|error| format!("Clipboard cache lock poisoned: {error}"))?;
    let cache = guard
        .as_mut()
        .ok_or_else(|| "找不到此操作的剪貼簿快取，請重新開始".to_string())?;
    if cache.session_id != session_id {
        return Err("輸入操作已過期，剪貼簿已由較新的操作接管".into());
    }
    cache.modified_by_app = true;
    Ok(())
}

fn restore_cache_write_state(session_id: u64, modified_by_app: bool) -> Result<(), String> {
    let mut guard = CLIPBOARD_CACHE
        .lock()
        .map_err(|error| format!("Clipboard cache lock poisoned: {error}"))?;
    let cache = guard
        .as_mut()
        .ok_or_else(|| "找不到此操作的剪貼簿快取，請重新開始".to_string())?;
    if cache.session_id != session_id {
        return Err("輸入操作已過期，剪貼簿已由較新的操作接管".into());
    }
    cache.modified_by_app = modified_by_app;
    Ok(())
}

fn discard_cache_for_session(session_id: u64) -> Result<(), String> {
    let mut guard = CLIPBOARD_CACHE
        .lock()
        .map_err(|error| format!("Clipboard cache lock poisoned: {error}"))?;
    if guard
        .as_ref()
        .is_some_and(|cache| cache.session_id == session_id)
    {
        *guard = None;
    }
    Ok(())
}

/// Saves the current clipboard contents for one interaction session.
///
/// Rich/binary clipboard data is recorded as unsupported and is never replaced.
/// A completed temporary write from another session must be restored before a
/// newer session can claim the clipboard.
pub fn cache_clipboard_for_session(session_id: u64) -> Result<(), String> {
    if session_id == 0 {
        return Err("找不到輸入目標工作階段，請重新開始".into());
    }
    let _op = acquire_op_lock()?;

    {
        let cache = CLIPBOARD_CACHE
            .lock()
            .map_err(|error| format!("Clipboard cache lock poisoned: {error}"))?;
        if let Some(existing) = cache.as_ref() {
            if existing.session_id != session_id && existing.modified_by_app {
                return Err("上一個操作仍在還原剪貼簿，請稍後再試".into());
            }
        }
    }

    #[cfg(target_os = "windows")]
    let (contents, expected_sequence) = win32::with_open(|| {
        let contents = win32::snapshot()?;
        Ok((contents, win32::sequence_number()))
    })?;
    #[cfg(not(target_os = "windows"))]
    let (contents, expected_sequence) = (ClipboardContents::Empty, 0);

    let mut cache = CLIPBOARD_CACHE
        .lock()
        .map_err(|error| format!("Clipboard cache lock poisoned: {error}"))?;
    *cache = Some(ClipboardCache {
        session_id,
        expected_sequence,
        contents: contents.clone(),
        modified_by_app: false,
    });

    match contents {
        ClipboardContents::Empty => {
            println!("[clipboard] Cached empty clipboard for session {session_id}")
        }
        ClipboardContents::UnicodeText(ref text) => println!(
            "[clipboard] Cached {} chars for session {session_id}",
            text.len()
        ),
        ClipboardContents::Unsupported { ref formats } => println!(
            "[clipboard] Cached non-restorable formats for session {session_id}: {formats:?}"
        ),
    }
    Ok(())
}

/// Legacy wrapper: cache data for the currently locked focus session.
pub fn cache_clipboard() -> Result<(), String> {
    cache_clipboard_for_session(crate::window_focus::get_locked_session_id())
}

/// Reads clipboard text (called after simulating Ctrl+C in Mode B).
pub fn read_clipboard() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let text = win32::with_open(win32::read_text)?;
        println!("[clipboard] Read {} chars", text.len());
        Ok(text)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(String::new())
    }
}

/// Reads clipboard text and records the sequence number captured while the
/// clipboard is still open. Used after Ctrl+C in a cached interaction.
pub fn read_clipboard_for_session(session_id: u64) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let (text, sequence) = win32::with_open(|| {
            let text = win32::read_text()?;
            Ok((text, win32::sequence_number()))
        })?;
        mark_cache_written(session_id, sequence)?;
        println!(
            "[clipboard] Read {} chars for session {session_id}",
            text.len()
        );
        Ok(text)
    }
    #[cfg(not(target_os = "windows"))]
    {
        mark_cache_written(session_id, 0)?;
        Ok(String::new())
    }
}

/// Writes temporary injection content for a matching interaction session.
/// The caller must hold `acquire_op_lock()` when this is part of a multi-step
/// sequence.
pub fn write_clipboard_for_session(text: &str, session_id: u64) -> Result<(), String> {
    let cache = validate_cache_for_session(session_id)?;
    if matches!(cache.contents, ClipboardContents::Unsupported { .. }) {
        return Err(unsupported_format_error());
    }

    #[cfg(target_os = "windows")]
    {
        mark_cache_write_started(session_id)?;
        enum WriteAttempt {
            Written(u32),
            ClipboardChanged,
            Failed { error: String, sequence: u32 },
        }
        let attempt = win32::with_open(|| {
            if win32::sequence_number() != cache.expected_sequence {
                return Ok(WriteAttempt::ClipboardChanged);
            }
            match win32::write_text(text) {
                Ok(()) => Ok(WriteAttempt::Written(win32::sequence_number())),
                Err(error) => Ok(WriteAttempt::Failed {
                    error,
                    sequence: win32::sequence_number(),
                }),
            }
        });
        let attempt = match attempt {
            Ok(attempt) => attempt,
            Err(error) => {
                let _ = restore_cache_write_state(session_id, cache.modified_by_app);
                return Err(error);
            }
        };
        let sequence = match attempt {
            WriteAttempt::Written(sequence) => sequence,
            WriteAttempt::ClipboardChanged => {
                let _ = restore_cache_write_state(session_id, cache.modified_by_app);
                return Err("剪貼簿在操作期間已變更，已取消貼上以避免覆寫新內容".into());
            }
            WriteAttempt::Failed { error, sequence } => {
                // Capture the post-failure sequence while OpenClipboard is still
                // held. This lets the caller restore only the clipboard state
                // produced by this attempt, never a later external copy.
                mark_cache_written(session_id, sequence)?;
                return Err(error);
            }
        };
        mark_cache_written(session_id, sequence)?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        mark_cache_write_started(session_id)?;
        mark_cache_written(session_id, 0)?;
    }
    println!(
        "[clipboard] Wrote {} chars for session {session_id}",
        text.len()
    );
    Ok(())
}

/// Writes text only when the currently visible clipboard contains restorable
/// plain text. This protects the UI Automation/selection fallback, which does
/// not own an interaction cache.
pub fn write_clipboard(text: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win32::with_open(|| {
            if matches!(win32::snapshot()?, ClipboardContents::Unsupported { .. }) {
                return Err(unsupported_format_error());
            }
            win32::write_text(text)
        })?;
        println!("[clipboard] Wrote {} chars", text.len());
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        Ok(())
    }
}

/// Explicit user Copy action. Unlike temporary injection, this intentionally
/// replaces every clipboard format and invalidates any pending restoration.
pub fn replace_clipboard_intentionally(text: &str) -> Result<(), String> {
    let _op = acquire_op_lock()?;
    #[cfg(target_os = "windows")]
    win32::with_open(|| win32::write_text(text))?;
    #[cfg(not(target_os = "windows"))]
    let _ = text;

    let mut cache = CLIPBOARD_CACHE
        .lock()
        .map_err(|error| format!("Clipboard cache lock poisoned: {error}"))?;
    *cache = None;
    println!(
        "[clipboard] Intentionally replaced clipboard with {} chars",
        text.len()
    );
    Ok(())
}

/// Restores a one-shot clipboard cache for a matching session. If another app
/// changed the clipboard after our temporary write, restoration is skipped so
/// the newer user clipboard data wins.
pub fn restore_clipboard_for_session(session_id: Option<u64>) -> Result<(), String> {
    let _op = acquire_op_lock()?;
    let cache = {
        let guard = CLIPBOARD_CACHE
            .lock()
            .map_err(|error| format!("Clipboard cache lock poisoned: {error}"))?;
        if let Some(expected) = session_id {
            if guard
                .as_ref()
                .is_some_and(|cache| cache.session_id != expected)
            {
                return Err("剪貼簿快取屬於其他操作，已略過還原".into());
            }
        }
        guard.clone()
    };

    let Some(cache) = cache else {
        println!("[clipboard] Nothing cached to restore");
        return Ok(());
    };

    if !cache.modified_by_app || matches!(cache.contents, ClipboardContents::Unsupported { .. }) {
        discard_cache_for_session(cache.session_id)?;
        println!("[clipboard] No temporary clipboard data to restore");
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    enum RestoreAttempt {
        Restored,
        ClipboardChanged,
    }
    #[cfg(target_os = "windows")]
    let attempt = win32::with_open(|| {
        if win32::sequence_number() != cache.expected_sequence {
            return Ok(RestoreAttempt::ClipboardChanged);
        }
        match &cache.contents {
            ClipboardContents::Empty => unsafe {
                windows::Win32::System::DataExchange::EmptyClipboard()
                    .map_err(|error| format!("EmptyClipboard failed while restoring: {error}"))
            },
            ClipboardContents::UnicodeText(text) => win32::write_text(text),
            ClipboardContents::Unsupported { .. } => Ok(()),
        }?;
        Ok(RestoreAttempt::Restored)
    })?;

    #[cfg(target_os = "windows")]
    if matches!(attempt, RestoreAttempt::ClipboardChanged) {
        discard_cache_for_session(cache.session_id)?;
        return Err("剪貼簿已由其他程式更新，已略過還原以保留新內容".into());
    }

    discard_cache_for_session(cache.session_id)?;
    println!(
        "[clipboard] Restored session {} clipboard",
        cache.session_id
    );
    Ok(())
}

/// Legacy wrapper that consumes the active one-shot cache.
pub fn restore_clipboard() -> Result<(), String> {
    restore_clipboard_for_session(None)
}

/// Returns the session currently owning the temporary clipboard cache.
pub fn cached_session_id() -> Option<u64> {
    CLIPBOARD_CACHE
        .lock()
        .ok()
        .and_then(|cache| cache.as_ref().map(|cache| cache.session_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rich_formats_are_not_treated_as_empty_text() {
        let snapshot = ClipboardContents::Unsupported {
            formats: vec![13, 49_152],
        };
        assert!(matches!(snapshot, ClipboardContents::Unsupported { .. }));
        assert_ne!(snapshot, ClipboardContents::Empty);
    }

    #[test]
    fn text_snapshot_keeps_the_original_text() {
        let snapshot = ClipboardContents::UnicodeText("保留原始文字".into());
        assert_eq!(
            snapshot,
            ClipboardContents::UnicodeText("保留原始文字".into())
        );
    }
}
