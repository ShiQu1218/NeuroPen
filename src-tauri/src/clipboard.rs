//! Clipboard manager.
//!
//! Phase 1 implementation:
//! - `cache_clipboard()`    — save current clipboard contents before any operation
//! - `read_clipboard()`     — read clipboard after simulating Ctrl+C (Mode B)
//! - `write_clipboard(text)` — write injection content to clipboard
//! - `restore_clipboard()`  — restore the cached content after injection
//!
//! Uses Win32 clipboard API via the `windows` crate.
//! SAFETY: clipboard content must never be lost regardless of errors.

use std::sync::Mutex;

static CLIPBOARD_CACHE: Mutex<Option<String>> = Mutex::new(None);

#[cfg(target_os = "windows")]
mod win32 {
    use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    /// Open clipboard. Retries a few times if busy.
    pub fn open() -> Result<(), String> {
        for attempt in 0..10 {
            let ok = unsafe { OpenClipboard(HWND::default()) };
            if ok.is_ok() {
                return Ok(());
            }
            if attempt < 9 {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
        Err("Cannot open clipboard after retries".into())
    }

    pub fn close() {
        let _ = unsafe { CloseClipboard() };
    }

    /// Read Unicode text from clipboard. Clipboard must already be open.
    pub fn read_text() -> Result<String, String> {
        unsafe {
            let handle = GetClipboardData(CF_UNICODETEXT.0 as u32)
                .map_err(|e| format!("GetClipboardData failed: {e}"))?;
            let hglobal = HGLOBAL(handle.0);
            let ptr = GlobalLock(hglobal) as *const u16;
            if ptr.is_null() {
                return Err("GlobalLock returned null".into());
            }
            let mut len = 0usize;
            while *ptr.add(len) != 0 {
                len += 1;
            }
            let slice = std::slice::from_raw_parts(ptr, len);
            let text = String::from_utf16_lossy(slice);
            let _ = GlobalUnlock(hglobal);
            Ok(text)
        }
    }

    /// Write Unicode text to clipboard. Clipboard must already be open.
    pub fn write_text(text: &str) -> Result<(), String> {
        unsafe {
            let _ = EmptyClipboard();
            let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let byte_len = wide.len() * 2;
            let hmem = GlobalAlloc(GMEM_MOVEABLE, byte_len)
                .map_err(|e| format!("GlobalAlloc failed: {e}"))?;
            let ptr = GlobalLock(hmem) as *mut u16;
            if ptr.is_null() {
                return Err("GlobalLock returned null on write".into());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
            let _ = GlobalUnlock(hmem);
            SetClipboardData(CF_UNICODETEXT.0 as u32, HANDLE(hmem.0))
                .map_err(|e| format!("SetClipboardData failed: {e}"))?;
            Ok(())
        }
    }
}

/// Saves the current clipboard text so it can be restored later.
pub fn cache_clipboard() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win32::open()?;
        let text = win32::read_text().unwrap_or_default();
        win32::close();
        if let Ok(mut guard) = CLIPBOARD_CACHE.lock() {
            *guard = Some(text.clone());
        }
        println!("[clipboard] Cached {} chars", text.len());
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

/// Reads clipboard text (called after simulating Ctrl+C in Mode B).
pub fn read_clipboard() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        win32::open()?;
        let text = win32::read_text()?;
        win32::close();
        println!("[clipboard] Read {} chars", text.len());
        Ok(text)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(String::new())
    }
}

/// Writes `text` to the clipboard (called before simulating Ctrl+V).
pub fn write_clipboard(text: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win32::open()?;
        win32::write_text(text)?;
        win32::close();
        println!("[clipboard] Wrote {} chars", text.len());
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        Ok(())
    }
}

/// Restores the clipboard to the content captured by `cache_clipboard`.
pub fn restore_clipboard() -> Result<(), String> {
    let cached = CLIPBOARD_CACHE
        .lock()
        .map_err(|e| format!("Mutex poisoned: {e}"))?
        .clone();
    match cached {
        Some(text) => {
            println!("[clipboard] Restoring {} chars", text.len());
            write_clipboard(&text)
        }
        None => {
            println!("[clipboard] Nothing cached to restore");
            Ok(())
        }
    }
}
