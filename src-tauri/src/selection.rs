//! Text selection detection via UI Automation API.
//!
//! Phase 1 implementation:
//! - Poll the focused UI element for selected text
//! - Silently degrade (no error) when UI Automation is unavailable
//!   (games, some Electron apps, custom-drawn UIs)
//!
//! Uses IUIAutomation via the `windows` crate.

/// Result of a selection poll attempt.
#[derive(Debug, Clone)]
pub enum SelectionResult {
    /// Text is selected; contains the selected string.
    Selected(String),
    /// No text is currently selected.
    None,
    /// UI Automation unavailable for this window — degrade silently.
    Unavailable,
}

/// Attempts to read the currently selected text from the focused element
/// using Windows UI Automation API.
/// Never panics; always returns a `SelectionResult`.
#[cfg(target_os = "windows")]
pub fn get_selected_text() -> SelectionResult {
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Accessibility::*;
    use windows::core::Interface;

    unsafe {
        // Create the UI Automation COM object
        let automation: Result<IUIAutomation, windows::core::Error> =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER);
        let automation: IUIAutomation = match automation {
            Ok(a) => a,
            Err(_) => return SelectionResult::Unavailable,
        };

        // Get the focused element
        let focused: IUIAutomationElement = match automation.GetFocusedElement() {
            Ok(el) => el,
            Err(_) => return SelectionResult::Unavailable,
        };

        // Try to get the Text pattern from the element
        let pattern_id = UIA_TextPatternId;
        let pattern: windows::core::IUnknown = match focused.GetCurrentPattern(pattern_id) {
            Ok(p) => p,
            Err(_) => return SelectionResult::Unavailable,
        };

        let text_pattern: IUIAutomationTextPattern = match pattern.cast() {
            Ok(tp) => tp,
            Err(_) => return SelectionResult::Unavailable,
        };

        // Get the selected text ranges
        let selection: IUIAutomationTextRangeArray = match text_pattern.GetSelection() {
            Ok(s) => s,
            Err(_) => return SelectionResult::Unavailable,
        };

        let count = match selection.Length() {
            Ok(n) => n,
            Err(_) => return SelectionResult::None,
        };

        if count == 0 {
            return SelectionResult::None;
        }

        // Read the first selection range
        let range: IUIAutomationTextRange = match selection.GetElement(0) {
            Ok(r) => r,
            Err(_) => return SelectionResult::None,
        };

        let bstr = match range.GetText(-1) {
            Ok(t) => t,
            Err(_) => return SelectionResult::None,
        };
        let text = bstr.to_string();

        if text.is_empty() {
            SelectionResult::None
        } else {
            SelectionResult::Selected(text)
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_selected_text() -> SelectionResult {
    SelectionResult::Unavailable
}

/// Initialize COM for the current thread. Must be called once from
/// any thread that will use `get_selected_text()`.
#[cfg(target_os = "windows")]
pub fn init_com() {
    unsafe {
        let _ = windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_APARTMENTTHREADED,
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn init_com() {}

/// Get current cursor position (x, y).
#[cfg(target_os = "windows")]
fn get_cursor_pos() -> (i32, i32) {
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    use windows::Win32::Foundation::POINT;
    unsafe {
        let mut pt = POINT::default();
        let _ = GetCursorPos(&mut pt);
        (pt.x, pt.y)
    }
}

/// Returns true while left mouse button is pressed.
#[cfg(target_os = "windows")]
fn is_left_button_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
}

/// Start a background thread that polls for text selection changes every 500ms.
/// Uses debounce: waits for 2 consecutive stable polls before emitting.
/// Emits `talkflow://selection-changed` with
/// `{ has_selection, text, cursor_x, cursor_y, anchor_x, anchor_y }`.
#[cfg(target_os = "windows")]
pub fn start_selection_watcher(app: tauri::AppHandle) {
    use tauri::Emitter;
    std::thread::spawn(move || {
        init_com();
        let mut last_emitted_selection = false;
        let mut last_emitted_text = String::new();

        // Debounce state: track the pending (candidate) selection
        let mut pending_selection: Option<(bool, String, i32, i32)> = None;
        let mut stable_count: u32 = 0;
        const STABLE_THRESHOLD: u32 = 2; // Need 2 consecutive identical polls

        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));

            let (raw_has_selection, raw_text) = match get_selected_text() {
                SelectionResult::Selected(t) => (true, t),
                SelectionResult::None | SelectionResult::Unavailable => (false, String::new()),
            };
            let left_down = is_left_button_down();
            // Only surface selection after mouse release so icon appears post-selection.
            let (has_selection, text) = if raw_has_selection && !left_down {
                (true, raw_text)
            } else {
                (false, String::new())
            };

            let (cx, cy) = get_cursor_pos();

            // Debounce: check if this poll matches the pending candidate
            let matches_pending = match &pending_selection {
                Some((ps, pt, _, _)) => *ps == has_selection && *pt == text,
                None => false,
            };

            if matches_pending {
                stable_count += 1;
            } else {
                // New candidate
                pending_selection = Some((has_selection, text.clone(), cx, cy));
                stable_count = 1;
            }

            // Only emit after the selection has been stable for STABLE_THRESHOLD polls
            if stable_count >= STABLE_THRESHOLD {
                // Check if it's different from what we last emitted
                if has_selection != last_emitted_selection || text != last_emitted_text {
                    last_emitted_selection = has_selection;
                    last_emitted_text = text.clone();

                    let (anchor_cx, anchor_cy) = pending_selection
                        .as_ref()
                        .map(|(_, _, px, py)| (*px, *py))
                        .unwrap_or((cx, cy));

                    let payload = if has_selection {
                        serde_json::json!({
                            "has_selection": true,
                            "text": text,
                            "cursor_x": cx,
                            "cursor_y": cy,
                            "anchor_x": anchor_cx,
                            "anchor_y": anchor_cy
                        })
                    } else {
                        serde_json::json!({
                            "has_selection": false,
                            "text": null,
                            "cursor_x": cx,
                            "cursor_y": cy,
                            "anchor_x": null,
                            "anchor_y": null
                        })
                    };

                    let _ = app.emit("talkflow://selection-changed", payload);
                }
                // Reset pending after emit
                pending_selection = None;
                stable_count = 0;
            }
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub fn start_selection_watcher(_app: tauri::AppHandle) {}
