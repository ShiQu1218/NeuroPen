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

/// Fallback selection capture for apps where UIA text pattern is unavailable (e.g. VSCode).
/// Acquires the global clipboard operation lock to avoid racing with the hotkey flow.
#[cfg(target_os = "windows")]
fn try_read_selection_via_clipboard_once() -> Option<String> {
    let _op = crate::clipboard::acquire_op_lock().ok()?;
    let clipboard_before = crate::clipboard::read_clipboard().unwrap_or_default();
    if crate::injection::simulate_ctrl_c().is_err() {
        return None;
    }
    // Give the target app time to process Ctrl+C and update the clipboard.
    // Electron/browser apps can be slow; 150ms covers most cases.
    std::thread::sleep(std::time::Duration::from_millis(150));
    let copied = crate::clipboard::read_clipboard().ok();
    let _ = crate::clipboard::write_clipboard(&clipboard_before);
    match copied {
        Some(text) if !text.trim().is_empty() && text != clipboard_before => Some(text),
        _ => None,
    }
}

/// Start a background thread that polls for text selection changes.
/// Emits `talkflow://selection-changed` with
/// `{ has_selection, text, cursor_x, cursor_y, anchor_x, anchor_y }`.
#[cfg(target_os = "windows")]
pub fn start_selection_watcher(app: tauri::AppHandle) {
    use tauri::Emitter;
    std::thread::spawn(move || {
        init_com();
        let mut last_emitted_selection = false;
        let mut last_emitted_text = String::new();
        let mut last_left_down = false;
        let mut drag_start: Option<(i32, i32)> = None;
        // Sticky selection: when clipboard fallback succeeds, remember the
        // selection so it persists across polls until the user clicks again.
        let mut sticky_text: Option<String> = None;

        loop {
            std::thread::sleep(std::time::Duration::from_millis(50));

            let (raw_has_selection, raw_text, _raw_unavailable) = match get_selected_text() {
                SelectionResult::Selected(t) => (true, t, false),
                SelectionResult::None => (false, String::new(), false),
                SelectionResult::Unavailable => (false, String::new(), true),
            };
            let left_down = is_left_button_down();
            let just_released = last_left_down && !left_down;
            let (cx, cy) = get_cursor_pos();

            if left_down && !last_left_down {
                drag_start = Some((cx, cy));
                // User started a new click/drag — clear sticky selection
                sticky_text = None;
            }
            let was_drag_select = if just_released {
                match drag_start {
                    Some((sx, sy)) => (cx - sx).abs() >= 6 || (cy - sy).abs() >= 6,
                    None => false,
                }
            } else {
                false
            };
            if just_released {
                drag_start = None;
            }

            // Only surface selection after mouse release so icon appears post-selection.
            let mut has_selection = raw_has_selection && !left_down;
            let mut text = if has_selection {
                raw_text
            } else {
                String::new()
            };

            // Fallback for apps where UIA doesn't report selection
            // (e.g. VSCode, Electron apps, browser content areas).
            // Trigger clipboard fallback whenever a drag-select occurred
            // but UIA returned no selection, regardless of Unavailable status.
            if just_released && was_drag_select && !has_selection {
                if let Some(fallback_text) = try_read_selection_via_clipboard_once() {
                    has_selection = true;
                    text = fallback_text.clone();
                    sticky_text = Some(fallback_text);
                }
            }

            // If no UIA selection but we have a sticky fallback selection, keep it.
            if !has_selection && !left_down && sticky_text.is_some() {
                has_selection = true;
                text = sticky_text.clone().unwrap();
            }

            let selection_changed =
                has_selection != last_emitted_selection || text != last_emitted_text;

            if selection_changed || just_released {
                last_emitted_selection = has_selection;
                last_emitted_text = text.clone();

                let payload = if has_selection {
                    serde_json::json!({
                        "has_selection": true,
                        "text": text,
                        "cursor_x": cx,
                        "cursor_y": cy,
                        "anchor_x": cx,
                        "anchor_y": cy
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

            last_left_down = left_down;
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub fn start_selection_watcher(_app: tauri::AppHandle) {}
