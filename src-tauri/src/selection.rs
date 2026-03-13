//! Text selection detection via UI Automation API.
//!
//! Phase 1 implementation:
//! - Poll the focused UI element for selected text
//! - Silently degrade (no error) when UI Automation is unavailable
//!   (games, some Electron apps, custom-drawn UIs)
//!
//! Uses IUIAutomation via the `windows` crate.

#[cfg(target_os = "windows")]
fn capture_selection_snapshot_via_clipboard() -> Option<String> {
    use crate::{clipboard, injection};
    use std::time::{SystemTime, UNIX_EPOCH};

    let _op = clipboard::acquire_op_lock().ok()?;
    let original_clipboard = clipboard::read_clipboard().unwrap_or_default();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sentinel = format!(
        "__NEUROPEN_SELECTION_SNAPSHOT_{}_{}__",
        std::process::id(),
        nonce
    );

    if clipboard::write_clipboard(&sentinel).is_err() {
        return None;
    }
    let copy_result = injection::simulate_ctrl_c();
    let clipboard_text = clipboard::read_clipboard().ok();
    let _ = clipboard::write_clipboard(&original_clipboard);

    if copy_result.is_err() {
        return None;
    }

    match clipboard_text {
        Some(text) if !text.trim().is_empty() && text != sentinel => Some(text),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReleaseGesture {
    PlainClick,
    DragSelect,
    DoubleClick,
}

const DRAG_DISTANCE_THRESHOLD_PX: i32 = 3;
const DOUBLE_CLICK_WINDOW_MS: u64 = 450;
const DOUBLE_CLICK_POSITION_TOLERANCE_PX: i32 = 4;
const STICKY_SELECTION_TTL_MS: u64 = 1500;
const POLL_INTERVAL_MS: u64 = 25;
const DOUBLE_CLICK_FALLBACK_MAX_LEN: usize = 120;

fn classify_release_gesture(
    just_released: bool,
    drag_start: Option<(i32, i32)>,
    cursor_pos: (i32, i32),
    last_release_at: Option<&std::time::Instant>,
    last_release_pos: Option<(i32, i32)>,
) -> Option<ReleaseGesture> {
    if !just_released {
        return None;
    }

    let (cx, cy) = cursor_pos;
    let was_drag_select = match drag_start {
        Some((sx, sy)) => {
            (cx - sx).abs() >= DRAG_DISTANCE_THRESHOLD_PX || (cy - sy).abs() >= DRAG_DISTANCE_THRESHOLD_PX
        }
        None => false,
    };

    if was_drag_select {
        return Some(ReleaseGesture::DragSelect);
    }

    let is_double_click_release = match (last_release_at, last_release_pos) {
        (Some(prev_at), Some((px, py))) => {
            prev_at.elapsed() <= std::time::Duration::from_millis(DOUBLE_CLICK_WINDOW_MS)
                && (cx - px).abs() <= DOUBLE_CLICK_POSITION_TOLERANCE_PX
                && (cy - py).abs() <= DOUBLE_CLICK_POSITION_TOLERANCE_PX
        }
        _ => false,
    };

    if is_double_click_release {
        Some(ReleaseGesture::DoubleClick)
    } else {
        Some(ReleaseGesture::PlainClick)
    }
}

fn is_valid_fallback_snapshot(snapshot: &str, gesture: ReleaseGesture) -> bool {
    let trimmed = snapshot.trim();
    if trimmed.is_empty() {
        return false;
    }

    // Double-click fallback is primarily for word selection in UIA-unavailable
    // surfaces. Reject long/multiline captures to avoid treating "copy current
    // paragraph/line" behaviors as a real selection.
    if gesture == ReleaseGesture::DoubleClick
        && (trimmed.len() > DOUBLE_CLICK_FALLBACK_MAX_LEN || trimmed.contains('\n'))
    {
        return false;
    }

    true
}

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

#[cfg(target_os = "windows")]
pub fn get_cursor_position() -> (i32, i32) {
    get_cursor_pos()
}

#[cfg(not(target_os = "windows"))]
pub fn get_cursor_position() -> (i32, i32) {
    (0, 0)
}

#[cfg(target_os = "windows")]
fn is_cursor_over_current_process_window(x: i32, y: i32) -> bool {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, WindowFromPoint};

    unsafe {
        let hwnd = WindowFromPoint(POINT { x, y });
        if hwnd.0.is_null() {
            return false;
        }

        let mut owner_pid = 0u32;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut owner_pid));
        owner_pid != 0 && owner_pid == GetCurrentProcessId()
    }
}

#[cfg(not(target_os = "windows"))]
fn is_cursor_over_current_process_window(_x: i32, _y: i32) -> bool {
    false
}

/// Returns true while left mouse button is pressed.
#[cfg(target_os = "windows")]
fn is_left_button_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
}

/// Start a background thread that polls for text selection changes.
/// Emits `neuropen://selection-changed` with
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
        let mut last_release_at: Option<std::time::Instant> = None;
        let mut last_release_pos: Option<(i32, i32)> = None;
        // Sticky selection: when clipboard fallback succeeds, remember the
        // selection so it persists across polls until the user clicks again.
        let mut sticky_text: Option<String> = None;
        let mut sticky_expires_at: Option<std::time::Instant> = None;

        loop {
            std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));

            let selection_result = get_selected_text();
            let (raw_has_selection, raw_text) = match selection_result {
                SelectionResult::Selected(t) => (true, t),
                SelectionResult::None | SelectionResult::Unavailable => (false, String::new()),
            };
            let left_down = is_left_button_down();
            let (cx, cy) = get_cursor_pos();
            let cursor_over_neuropen_window = is_cursor_over_current_process_window(cx, cy);
            let just_released = last_left_down && !left_down && !cursor_over_neuropen_window;

            if left_down && !last_left_down {
                if cursor_over_neuropen_window {
                    drag_start = None;
                } else {
                    drag_start = Some((cx, cy));
                    // User started a new click/drag — clear sticky selection
                    sticky_text = None;
                    sticky_expires_at = None;
                }
            }
            let release_gesture = classify_release_gesture(
                just_released,
                drag_start,
                (cx, cy),
                last_release_at.as_ref(),
                last_release_pos,
            );
            if just_released {
                drag_start = None;
                last_release_at = Some(std::time::Instant::now());
                last_release_pos = Some((cx, cy));
            } else if last_left_down && !left_down {
                drag_start = None;
            }

            if matches!(release_gesture, Some(ReleaseGesture::PlainClick)) {
                sticky_text = None;
                sticky_expires_at = None;
            }
            if let Some(expire_at) = sticky_expires_at {
                if std::time::Instant::now() >= expire_at {
                    sticky_text = None;
                    sticky_expires_at = None;
                }
            }
            // Only surface selection after mouse release so icon appears post-selection.
            let mut has_selection = raw_has_selection && !left_down;
            let mut text = if has_selection {
                raw_text
            } else {
                String::new()
            };

            // If UIA did not return a selection, capture immediately after
            // mouse release while it is still active, then restore clipboard.
            // This keeps Quick Action responsive without reading stale clipboard
            // contents later after the user clicks the popup.
            if just_released
                && matches!(
                    release_gesture,
                    Some(ReleaseGesture::DragSelect) | Some(ReleaseGesture::DoubleClick)
                )
                && !has_selection
            {
                if let Some(snapshot) = capture_selection_snapshot_via_clipboard() {
                    let gesture = release_gesture.unwrap_or(ReleaseGesture::PlainClick);
                    if is_valid_fallback_snapshot(&snapshot, gesture) {
                        has_selection = true;
                        text = snapshot.clone();
                        sticky_text = Some(snapshot);
                        sticky_expires_at = Some(
                            std::time::Instant::now()
                                + std::time::Duration::from_millis(STICKY_SELECTION_TTL_MS),
                        );
                    } else {
                        sticky_text = None;
                        sticky_expires_at = None;
                    }
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

                let _ = app.emit("neuropen://selection-changed", payload);
            }

            last_left_down = left_down;
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub fn start_selection_watcher(_app: tauri::AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_release_gesture_detects_drag() {
        let gesture = classify_release_gesture(
            true,
            Some((100, 100)),
            (120, 102),
            None,
            None,
        );
        assert_eq!(gesture, Some(ReleaseGesture::DragSelect));
    }

    #[test]
    fn classify_release_gesture_detects_plain_click() {
        let gesture = classify_release_gesture(
            true,
            Some((100, 100)),
            (101, 102),
            None,
            None,
        );
        assert_eq!(gesture, Some(ReleaseGesture::PlainClick));
    }

    #[test]
    fn classify_release_gesture_detects_double_click() {
        let now = std::time::Instant::now();
        let previous = now
            .checked_sub(std::time::Duration::from_millis(200))
            .unwrap();
        let gesture = classify_release_gesture(
            true,
            Some((100, 100)),
            (101, 101),
            Some(&previous),
            Some((100, 100)),
        );
        assert_eq!(gesture, Some(ReleaseGesture::DoubleClick));
    }

    #[test]
    fn fallback_snapshot_rejects_long_double_click_text() {
        let snapshot = "x".repeat(DOUBLE_CLICK_FALLBACK_MAX_LEN + 1);
        assert!(!is_valid_fallback_snapshot(
            &snapshot,
            ReleaseGesture::DoubleClick
        ));
    }

    #[test]
    fn fallback_snapshot_rejects_multiline_double_click_text() {
        assert!(!is_valid_fallback_snapshot(
            "first line\nsecond line",
            ReleaseGesture::DoubleClick
        ));
    }

    #[test]
    fn fallback_snapshot_accepts_drag_multiline_text() {
        assert!(is_valid_fallback_snapshot(
            "first line\nsecond line",
            ReleaseGesture::DragSelect
        ));
    }
}
