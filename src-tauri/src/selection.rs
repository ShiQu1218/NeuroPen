//! Text selection detection via UI Automation API.
//!
//! Phase 1 implementation:
//! - Poll the focused UI element for selected text
//! - Silently degrade (no error) when UI Automation is unavailable
//!   (games, some Electron apps, custom-drawn UIs)
//!
//! Uses IUIAutomation via the `windows` crate.


#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReleaseGesture {
    PlainClick,
    DragSelect,
    DoubleClick,
}

const DRAG_DISTANCE_THRESHOLD_PX: i32 = 3;
const DOUBLE_CLICK_WINDOW_MS: u64 = 450;
const DOUBLE_CLICK_POSITION_TOLERANCE_PX: i32 = 4;
const POLL_INTERVAL_MS: u64 = 25;
const UIA_SELECTION_SEARCH_DEPTH: usize = 16;

fn combine_selection_fragments<'a>(fragments: impl IntoIterator<Item = &'a str>) -> Option<String> {
    let combined = fragments.into_iter().fold(String::new(), |mut acc, fragment| {
        if !fragment.is_empty() {
            acc.push_str(fragment);
        }
        acc
    });

    if combined.trim().is_empty() {
        None
    } else {
        Some(combined)
    }
}

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
    use windows::Win32::Foundation::POINT;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Accessibility::*;
    use windows::core::Interface;

    unsafe fn selection_from_text_range_array(
        selection: &IUIAutomationTextRangeArray,
    ) -> SelectionResult {
        let count = match selection.Length() {
            Ok(n) => n,
            Err(_) => return SelectionResult::None,
        };

        if count == 0 {
            return SelectionResult::None;
        }

        let mut fragments = Vec::new();
        for index in 0..count {
            let range: IUIAutomationTextRange = match selection.GetElement(index) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let fragment = match range.GetText(-1) {
                Ok(t) => t.to_string(),
                Err(_) => continue,
            };
            if fragment.is_empty() {
                continue;
            }
            fragments.push(fragment);
        }

        match combine_selection_fragments(fragments.iter().map(String::as_str)) {
            Some(text) => SelectionResult::Selected(text),
            None => SelectionResult::None,
        }
    }

    unsafe fn selection_from_pattern(pattern: &windows::core::IUnknown) -> SelectionResult {
        if let Ok(text_pattern) = pattern.cast::<IUIAutomationTextPattern>() {
            return match text_pattern.GetSelection() {
                Ok(selection) => selection_from_text_range_array(&selection),
                Err(_) => SelectionResult::None,
            };
        }

        if let Ok(text_pattern2) = pattern.cast::<IUIAutomationTextPattern2>() {
            let base_pattern: IUIAutomationTextPattern = match text_pattern2.cast() {
                Ok(pattern) => pattern,
                Err(_) => return SelectionResult::Unavailable,
            };
            return match base_pattern.GetSelection() {
                Ok(selection) => selection_from_text_range_array(&selection),
                Err(_) => SelectionResult::None,
            };
        }

        SelectionResult::Unavailable
    }

    unsafe fn selection_from_element(element: &IUIAutomationElement) -> SelectionResult {
        for pattern_id in [UIA_TextPatternId, UIA_TextPattern2Id] {
            let pattern = match element.GetCurrentPattern(pattern_id) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let result = selection_from_pattern(&pattern);
            if !matches!(result, SelectionResult::Unavailable) {
                return result;
            }
        }

        SelectionResult::Unavailable
    }

    unsafe fn selection_from_element_chain(
        automation: &IUIAutomation,
        start: &IUIAutomationElement,
    ) -> SelectionResult {
        let walker = match automation.RawViewWalker() {
            Ok(w) => w,
            Err(_) => return SelectionResult::Unavailable,
        };

        let mut current = Some(start.clone());
        let mut depth = 0usize;
        let mut saw_text_container = false;

        while let Some(element) = current {
            match selection_from_element(&element) {
                SelectionResult::Selected(text) => return SelectionResult::Selected(text),
                SelectionResult::None => saw_text_container = true,
                SelectionResult::Unavailable => {}
            }

            depth += 1;
            if depth >= UIA_SELECTION_SEARCH_DEPTH {
                break;
            }

            current = match walker.GetParentElement(&element) {
                Ok(parent) => Some(parent),
                Err(_) => None,
            };
        }

        if saw_text_container {
            SelectionResult::None
        } else {
            SelectionResult::Unavailable
        }
    }

    unsafe {
        // Create the UI Automation COM object
        let automation: Result<IUIAutomation, windows::core::Error> =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER);
        let automation: IUIAutomation = match automation {
            Ok(a) => a,
            Err(_) => return SelectionResult::Unavailable,
        };

        let mut saw_text_container = false;

        if let Ok(focused) = automation.GetFocusedElement() {
            match selection_from_element_chain(&automation, &focused) {
                SelectionResult::Selected(text) => return SelectionResult::Selected(text),
                SelectionResult::None => saw_text_container = true,
                SelectionResult::Unavailable => {}
            }
        }

        let (cursor_x, cursor_y) = get_cursor_pos();
        if let Ok(hovered) = automation.ElementFromPoint(POINT {
            x: cursor_x,
            y: cursor_y,
        }) {
            match selection_from_element_chain(&automation, &hovered) {
                SelectionResult::Selected(text) => return SelectionResult::Selected(text),
                SelectionResult::None => saw_text_container = true,
                SelectionResult::Unavailable => {}
            }
        }

        if saw_text_container {
            SelectionResult::None
        } else {
            SelectionResult::Unavailable
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

            // Only surface selection after mouse release so icon appears post-selection.
            let has_selection = raw_has_selection && !left_down;
            let text = if has_selection { raw_text } else { String::new() };

            let _ = release_gesture; // used for gesture classification only

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
    fn selection_result_keeps_non_empty_later_fragments() {
        let combined = combine_selection_fragments(["", "selected text", ""]);
        assert_eq!(combined.as_deref(), Some("selected text"));
    }

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

}
