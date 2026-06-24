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
    DragSelect { distance_px: i32 },
    DoubleClick,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct SelectionRect {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}

impl SelectionRect {
    fn right(self) -> f64 {
        self.left + self.width
    }

    fn bottom(self) -> f64 {
        self.top + self.height
    }

    fn is_visible(self) -> bool {
        self.left.is_finite()
            && self.top.is_finite()
            && self.width.is_finite()
            && self.height.is_finite()
            && self.width > 0.5
            && self.height > 0.5
    }

    fn distance_to_point(self, x: i32, y: i32) -> f64 {
        let x = x as f64;
        let y = y as f64;
        let dx = if x < self.left {
            self.left - x
        } else if x > self.right() {
            x - self.right()
        } else {
            0.0
        };
        let dy = if y < self.top {
            self.top - y
        } else if y > self.bottom() {
            y - self.bottom()
        } else {
            0.0
        };
        (dx * dx + dy * dy).sqrt()
    }
}

#[derive(Debug, Clone)]
struct SelectionDetails {
    text: String,
    rects: Vec<SelectionRect>,
    anchor_x: i32,
    anchor_y: i32,
}

#[derive(Debug, Clone)]
enum DetailedSelectionResult {
    Selected(SelectionDetails),
    None,
    Unavailable,
}

const DRAG_DISTANCE_THRESHOLD_PX: i32 = 8;
const CLIPBOARD_PROBE_DRAG_DISTANCE_THRESHOLD_PX: i32 = 12;
const SELECTION_GESTURE_PROXIMITY_PX: f64 = 96.0;
const DOUBLE_CLICK_WINDOW_MS: u64 = 450;
const DOUBLE_CLICK_POSITION_TOLERANCE_PX: i32 = 4;
const POLL_INTERVAL_MS: u64 = 25;
const UIA_SELECTION_SEARCH_DEPTH: usize = 16;
const UIA_DESCENDANT_SEARCH_MAX_NODES: usize = 60;
const UIA_DESCENDANT_SEARCH_MAX_DEPTH: usize = 6;
const UIA_DESCENDANT_SEARCH_BUDGET_MS: u64 = 15;
const SELECTION_CANDIDATE_DELAY_MS: u64 = 90;
const CLIPBOARD_PROBE_DELAY_MS: u64 = 150;
const CLIPBOARD_PROBE_POLL_MAX_MS: u64 = 80;
const PROBE_CANCEL_DISTANCE_PX: i32 = 20;

fn combine_selection_fragments<'a>(fragments: impl IntoIterator<Item = &'a str>) -> Option<String> {
    let combined = fragments
        .into_iter()
        .fold(String::new(), |mut acc, fragment| {
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
    let drag_distance_px = match drag_start {
        Some((sx, sy)) => (cx - sx).abs().max((cy - sy).abs()),
        None => 0,
    };
    let was_drag_select = drag_distance_px >= DRAG_DISTANCE_THRESHOLD_PX;

    if was_drag_select {
        return Some(ReleaseGesture::DragSelect {
            distance_px: drag_distance_px,
        });
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

fn release_gesture_name(gesture: Option<ReleaseGesture>) -> Option<&'static str> {
    match gesture {
        Some(ReleaseGesture::PlainClick) => Some("plain-click"),
        Some(ReleaseGesture::DragSelect { .. }) => Some("drag-select"),
        Some(ReleaseGesture::DoubleClick) => Some("double-click"),
        None => None,
    }
}

fn gesture_allows_clipboard_probe(gesture: ReleaseGesture) -> bool {
    match gesture {
        ReleaseGesture::DoubleClick => true,
        ReleaseGesture::DragSelect { distance_px } => {
            distance_px >= CLIPBOARD_PROBE_DRAG_DISTANCE_THRESHOLD_PX
        }
        ReleaseGesture::PlainClick => false,
    }
}

fn visible_rects(rects: &[SelectionRect]) -> Vec<SelectionRect> {
    rects
        .iter()
        .copied()
        .filter(|rect| rect.is_visible())
        .collect()
}

fn selection_anchor_from_rects(
    rects: &[SelectionRect],
    fallback_x: i32,
    fallback_y: i32,
) -> (i32, i32) {
    let visible = visible_rects(rects);
    if let Some(rect) = visible.last() {
        (rect.right().round() as i32, rect.bottom().round() as i32)
    } else {
        (fallback_x, fallback_y)
    }
}

fn selection_rects_match_gesture(
    rects: &[SelectionRect],
    drag_start: Option<(i32, i32)>,
    release_pos: (i32, i32),
) -> bool {
    let visible = visible_rects(rects);
    if visible.is_empty() {
        return false;
    }

    let release_near = visible.iter().any(|rect| {
        rect.distance_to_point(release_pos.0, release_pos.1) <= SELECTION_GESTURE_PROXIMITY_PX
    });
    let start_near = drag_start.map_or(false, |(x, y)| {
        visible
            .iter()
            .any(|rect| rect.distance_to_point(x, y) <= SELECTION_GESTURE_PROXIMITY_PX)
    });

    release_near || start_near
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
    match get_selected_text_details() {
        DetailedSelectionResult::Selected(details) => SelectionResult::Selected(details.text),
        DetailedSelectionResult::None => SelectionResult::None,
        DetailedSelectionResult::Unavailable => SelectionResult::Unavailable,
    }
}

#[cfg(target_os = "windows")]
fn get_selected_text_details() -> DetailedSelectionResult {
    use std::ffi::c_void;
    use windows::core::Interface;
    use windows::Win32::Foundation::POINT;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::System::Ole::{
        SafeArrayAccessData, SafeArrayDestroy, SafeArrayGetLBound, SafeArrayGetUBound,
        SafeArrayUnaccessData,
    };
    use windows::Win32::UI::Accessibility::*;

    unsafe fn rects_from_safearray(
        psa: *mut windows::Win32::System::Com::SAFEARRAY,
    ) -> Vec<SelectionRect> {
        if psa.is_null() {
            return Vec::new();
        }

        let lbound = match SafeArrayGetLBound(psa, 1) {
            Ok(bound) => bound,
            Err(_) => {
                let _ = SafeArrayDestroy(psa);
                return Vec::new();
            }
        };
        let ubound = match SafeArrayGetUBound(psa, 1) {
            Ok(bound) => bound,
            Err(_) => {
                let _ = SafeArrayDestroy(psa);
                return Vec::new();
            }
        };
        if ubound < lbound {
            let _ = SafeArrayDestroy(psa);
            return Vec::new();
        }

        let mut data: *mut c_void = std::ptr::null_mut();
        let mut rects = Vec::new();
        if SafeArrayAccessData(psa, &mut data).is_ok() && !data.is_null() {
            let value_count = (ubound - lbound + 1) as usize;
            let values = std::slice::from_raw_parts(data as *const f64, value_count);
            for chunk in values.chunks_exact(4) {
                let rect = SelectionRect {
                    left: chunk[0],
                    top: chunk[1],
                    width: chunk[2],
                    height: chunk[3],
                };
                if rect.is_visible() {
                    rects.push(rect);
                }
            }
            let _ = SafeArrayUnaccessData(psa);
        }
        let _ = SafeArrayDestroy(psa);
        rects
    }

    unsafe fn selection_from_text_range_array(
        selection: &IUIAutomationTextRangeArray,
    ) -> DetailedSelectionResult {
        let count = match selection.Length() {
            Ok(n) => n,
            Err(_) => return DetailedSelectionResult::None,
        };

        if count == 0 {
            return DetailedSelectionResult::None;
        }

        let mut fragments = Vec::new();
        let mut rects = Vec::new();
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
            if let Ok(psa) = range.GetBoundingRectangles() {
                rects.extend(rects_from_safearray(psa));
            }
        }

        match combine_selection_fragments(fragments.iter().map(String::as_str)) {
            Some(text) => {
                let (anchor_x, anchor_y) = selection_anchor_from_rects(&rects, 0, 0);
                DetailedSelectionResult::Selected(SelectionDetails {
                    text,
                    rects,
                    anchor_x,
                    anchor_y,
                })
            }
            None => DetailedSelectionResult::None,
        }
    }

    unsafe fn selection_from_pattern(pattern: &windows::core::IUnknown) -> DetailedSelectionResult {
        if let Ok(text_pattern) = pattern.cast::<IUIAutomationTextPattern>() {
            return match text_pattern.GetSelection() {
                Ok(selection) => selection_from_text_range_array(&selection),
                Err(_) => DetailedSelectionResult::None,
            };
        }

        if let Ok(text_pattern2) = pattern.cast::<IUIAutomationTextPattern2>() {
            let base_pattern: IUIAutomationTextPattern = match text_pattern2.cast() {
                Ok(pattern) => pattern,
                Err(_) => return DetailedSelectionResult::Unavailable,
            };
            return match base_pattern.GetSelection() {
                Ok(selection) => selection_from_text_range_array(&selection),
                Err(_) => DetailedSelectionResult::None,
            };
        }

        DetailedSelectionResult::Unavailable
    }

    unsafe fn selection_from_element(element: &IUIAutomationElement) -> DetailedSelectionResult {
        for pattern_id in [UIA_TextPatternId, UIA_TextPattern2Id] {
            let pattern = match element.GetCurrentPattern(pattern_id) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let result = selection_from_pattern(&pattern);
            if !matches!(result, DetailedSelectionResult::Unavailable) {
                return result;
            }
        }

        DetailedSelectionResult::Unavailable
    }

    unsafe fn selection_from_element_chain(
        automation: &IUIAutomation,
        start: &IUIAutomationElement,
    ) -> DetailedSelectionResult {
        let walker = match automation.RawViewWalker() {
            Ok(w) => w,
            Err(_) => return DetailedSelectionResult::Unavailable,
        };

        let mut current = Some(start.clone());
        let mut depth = 0usize;
        let mut saw_text_container = false;

        while let Some(element) = current {
            match selection_from_element(&element) {
                DetailedSelectionResult::Selected(details) => {
                    return DetailedSelectionResult::Selected(details)
                }
                DetailedSelectionResult::None => saw_text_container = true,
                DetailedSelectionResult::Unavailable => {}
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
            DetailedSelectionResult::None
        } else {
            DetailedSelectionResult::Unavailable
        }
    }

    /// BFS over automation descendants to find a TextPattern-bearing element.
    /// Hard caps: max_nodes visited, max depth UIA_DESCENDANT_SEARCH_MAX_DEPTH,
    /// max wall time UIA_DESCENDANT_SEARCH_BUDGET_MS.
    unsafe fn selection_from_descendants(
        automation: &IUIAutomation,
        root: &IUIAutomationElement,
        max_nodes: usize,
    ) -> DetailedSelectionResult {
        let walker = match automation.RawViewWalker() {
            Ok(w) => w,
            Err(_) => return DetailedSelectionResult::Unavailable,
        };

        let budget = std::time::Duration::from_millis(UIA_DESCENDANT_SEARCH_BUDGET_MS);
        let start = std::time::Instant::now();

        // BFS queue: (element, depth)
        let mut queue: std::collections::VecDeque<(IUIAutomationElement, usize)> =
            std::collections::VecDeque::new();

        // Seed queue with root's children at depth 1
        if let Ok(first_child) = walker.GetFirstChildElement(root) {
            queue.push_back((first_child, 1));
        } else {
            return DetailedSelectionResult::Unavailable;
        }

        let mut nodes_visited = 0usize;
        let mut saw_text_container = false;

        while let Some((element, depth)) = queue.pop_front() {
            if nodes_visited >= max_nodes || start.elapsed() >= budget {
                break;
            }
            nodes_visited += 1;

            match selection_from_element(&element) {
                DetailedSelectionResult::Selected(details) => {
                    return DetailedSelectionResult::Selected(details)
                }
                DetailedSelectionResult::None => saw_text_container = true,
                DetailedSelectionResult::Unavailable => {}
            }

            // Enqueue all children at next depth
            if depth < UIA_DESCENDANT_SEARCH_MAX_DEPTH {
                if let Ok(first_child) = walker.GetFirstChildElement(&element) {
                    let mut child = first_child;
                    loop {
                        queue.push_back((child.clone(), depth + 1));
                        match walker.GetNextSiblingElement(&child) {
                            Ok(next) => child = next,
                            Err(_) => break,
                        }
                        if nodes_visited + queue.len() >= max_nodes {
                            break;
                        }
                    }
                }
            }
        }

        if saw_text_container {
            DetailedSelectionResult::None
        } else {
            DetailedSelectionResult::Unavailable
        }
    }

    unsafe {
        // Create the UI Automation COM object
        let automation: Result<IUIAutomation, windows::core::Error> =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER);
        let automation: IUIAutomation = match automation {
            Ok(a) => a,
            Err(_) => return DetailedSelectionResult::Unavailable,
        };

        let mut saw_text_container = false;

        // Keep elements in scope so both ancestor and descendant walks can use them.
        let focused = automation.GetFocusedElement().ok();
        if let Some(ref f) = focused {
            match selection_from_element_chain(&automation, f) {
                DetailedSelectionResult::Selected(details) => {
                    return DetailedSelectionResult::Selected(details)
                }
                DetailedSelectionResult::None => saw_text_container = true,
                DetailedSelectionResult::Unavailable => {}
            }
        }

        let (cursor_x, cursor_y) = get_cursor_pos();
        let hovered = automation
            .ElementFromPoint(POINT {
                x: cursor_x,
                y: cursor_y,
            })
            .ok();
        if let Some(ref h) = hovered {
            match selection_from_element_chain(&automation, h) {
                DetailedSelectionResult::Selected(details) => {
                    return DetailedSelectionResult::Selected(details)
                }
                DetailedSelectionResult::None => saw_text_container = true,
                DetailedSelectionResult::Unavailable => {}
            }
        }

        // Phase 1: descendant walk for Chromium/Electron-based IDE editors.
        // Chromium editors expose TextPattern on *descendant* elements, not ancestors.
        if let Some(ref f) = focused {
            match selection_from_descendants(&automation, f, UIA_DESCENDANT_SEARCH_MAX_NODES) {
                DetailedSelectionResult::Selected(details) => {
                    return DetailedSelectionResult::Selected(details)
                }
                DetailedSelectionResult::None => saw_text_container = true,
                DetailedSelectionResult::Unavailable => {}
            }
        }
        if let Some(ref h) = hovered {
            match selection_from_descendants(&automation, h, UIA_DESCENDANT_SEARCH_MAX_NODES) {
                DetailedSelectionResult::Selected(details) => {
                    return DetailedSelectionResult::Selected(details)
                }
                DetailedSelectionResult::None => saw_text_container = true,
                DetailedSelectionResult::Unavailable => {}
            }
        }

        if saw_text_container {
            DetailedSelectionResult::None
        } else {
            DetailedSelectionResult::Unavailable
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
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MouseHookEventKind {
    LeftDown,
    LeftUp,
    Move,
}

#[derive(Debug, Clone, Copy)]
struct MouseHookEvent {
    kind: MouseHookEventKind,
    x: i32,
    y: i32,
}

#[derive(Debug, Clone, Copy)]
struct ReleaseCandidate {
    gesture: ReleaseGesture,
    drag_start: Option<(i32, i32)>,
    release_pos: (i32, i32),
    created_at: std::time::Instant,
}

#[derive(Debug)]
struct MouseGestureState {
    left_down: bool,
    drag_start: Option<(i32, i32)>,
    last_release_at: Option<std::time::Instant>,
    last_release_pos: Option<(i32, i32)>,
    cursor_pos: (i32, i32),
}

impl MouseGestureState {
    fn new(initial_cursor_pos: (i32, i32)) -> Self {
        Self {
            left_down: false,
            drag_start: None,
            last_release_at: None,
            last_release_pos: None,
            cursor_pos: initial_cursor_pos,
        }
    }

    fn handle_event(&mut self, event: MouseHookEvent) -> Option<ReleaseCandidate> {
        self.cursor_pos = (event.x, event.y);
        match event.kind {
            MouseHookEventKind::LeftDown => {
                self.left_down = true;
                self.drag_start = if is_cursor_over_current_process_window(event.x, event.y) {
                    None
                } else {
                    Some((event.x, event.y))
                };
                None
            }
            MouseHookEventKind::Move => None,
            MouseHookEventKind::LeftUp => {
                let was_down = self.left_down;
                self.left_down = false;
                if !was_down || is_cursor_over_current_process_window(event.x, event.y) {
                    self.drag_start = None;
                    return None;
                }

                let release_pos = (event.x, event.y);
                let gesture = classify_release_gesture(
                    true,
                    self.drag_start,
                    release_pos,
                    self.last_release_at.as_ref(),
                    self.last_release_pos,
                )?;
                let candidate = ReleaseCandidate {
                    gesture,
                    drag_start: self.drag_start,
                    release_pos,
                    created_at: std::time::Instant::now(),
                };
                self.drag_start = None;
                self.last_release_at = Some(candidate.created_at);
                self.last_release_pos = Some(release_pos);
                Some(candidate)
            }
        }
    }
}

#[cfg(target_os = "windows")]
static MOUSE_HOOK_SENDER: std::sync::OnceLock<
    std::sync::Mutex<std::sync::mpsc::Sender<MouseHookEvent>>,
> = std::sync::OnceLock::new();

#[cfg(target_os = "windows")]
unsafe extern "system" fn low_level_mouse_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, MSLLHOOKSTRUCT, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE,
    };

    if code >= 0 {
        let message = wparam.0 as u32;
        let kind = match message {
            WM_LBUTTONDOWN => Some(MouseHookEventKind::LeftDown),
            WM_LBUTTONUP => Some(MouseHookEventKind::LeftUp),
            WM_MOUSEMOVE => Some(MouseHookEventKind::Move),
            _ => None,
        };
        if let Some(kind) = kind {
            let hook = &*(lparam.0 as *const MSLLHOOKSTRUCT);
            if let Some(sender) = MOUSE_HOOK_SENDER.get() {
                if let Ok(sender) = sender.lock() {
                    let _ = sender.send(MouseHookEvent {
                        kind,
                        x: hook.pt.x,
                        y: hook.pt.y,
                    });
                }
            }
        }
    }

    CallNextHookEx(
        windows::Win32::UI::WindowsAndMessaging::HHOOK::default(),
        code,
        wparam,
        lparam,
    )
}

#[cfg(target_os = "windows")]
fn start_mouse_hook_thread(sender: std::sync::mpsc::Sender<MouseHookEvent>) {
    let _ = MOUSE_HOOK_SENDER.set(std::sync::Mutex::new(sender));
    std::thread::spawn(move || {
        use windows::Win32::Foundation::{HINSTANCE, HWND};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetMessageW, SetWindowsHookExW, MSG, WH_MOUSE_LL,
        };

        unsafe {
            let hook = SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(low_level_mouse_proc),
                HINSTANCE::default(),
                0,
            );
            if hook.is_err() {
                eprintln!("[selection] Failed to install WH_MOUSE_LL hook: {hook:?}");
                return;
            }

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {}
        }
    });
}

/// Returns true if the current foreground window is a Chromium/Electron-based window
/// (class name `Chrome_WidgetWin_1`), which includes VS Code, Cursor, Windsurf, etc.
#[cfg(target_os = "windows")]
fn is_chromium_editor_window() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow};
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return false;
        }
        let mut buf = [0u16; 256];
        let len = GetClassNameW(hwnd, &mut buf);
        if len == 0 {
            return false;
        }
        let class_name = String::from_utf16_lossy(&buf[..len as usize]);
        class_name == "Chrome_WidgetWin_1"
    }
}

/// Returns true if Ctrl+C is currently held (used to cancel a pending clipboard probe).
#[cfg(target_os = "windows")]
fn is_ctrl_c_pressed() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    unsafe {
        let ctrl = (GetAsyncKeyState(0x11) as u16 & 0x8000) != 0; // VK_CONTROL
        let c = (GetAsyncKeyState(0x43) as u16 & 0x8000) != 0; // VK_C
        ctrl && c
    }
}

/// Returns true if any modifier key (Ctrl, Shift, Alt) is currently held.
/// Used to defer the clipboard probe — sending synthetic Ctrl+C while the user
/// holds a physical modifier can corrupt their key state (e.g. Ctrl↑ cancels
/// their physical Ctrl, so their next "C" keystroke becomes a bare "c").
#[cfg(target_os = "windows")]
fn is_any_modifier_held() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    unsafe {
        let ctrl = (GetAsyncKeyState(0x11) as u16 & 0x8000) != 0;
        let shift = (GetAsyncKeyState(0x10) as u16 & 0x8000) != 0;
        let alt = (GetAsyncKeyState(0x12) as u16 & 0x8000) != 0;
        ctrl || shift || alt
    }
}

/// Phase 2 clipboard probe: simulate Ctrl+C to read selection from editors whose
/// UIA tree is inaccessible. Immediately restores the prior clipboard content.
/// Never creates undo history.
#[cfg(target_os = "windows")]
fn clipboard_probe_selection() -> Option<String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let _op = crate::clipboard::acquire_op_lock().ok()?;

    // Cache original clipboard before touching it
    let original = crate::clipboard::read_clipboard().unwrap_or_default();

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let sentinel = format!("__NEUROPEN_PROBE_SENTINEL_{}_{}__", std::process::id(), now);

    crate::clipboard::write_clipboard(&sentinel).ok()?;
    let _ = crate::injection::simulate_ctrl_c_raw();

    // Poll up to CLIPBOARD_PROBE_POLL_MAX_MS for clipboard to change from sentinel
    const POLL_MS: u64 = 10;
    let mut elapsed = 0u64;
    let result = loop {
        std::thread::sleep(std::time::Duration::from_millis(POLL_MS));
        elapsed += POLL_MS;
        let current = match crate::clipboard::read_clipboard() {
            Ok(t) => t,
            Err(_) => break None,
        };
        if current != sentinel {
            let trimmed = current.trim().to_string();
            break if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            };
        }
        if elapsed >= CLIPBOARD_PROBE_POLL_MAX_MS {
            break None;
        }
    };

    // Always restore original clipboard regardless of probe outcome
    let _ = crate::clipboard::write_clipboard(&original);

    result
}

/// Start a background thread that polls for text selection changes.
/// Emits `neuropen://selection-changed` with
/// `{ has_selection, text, cursor_x, cursor_y, anchor_x, anchor_y }`.
#[cfg(target_os = "windows")]
fn emit_selection_changed(
    app: &tauri::AppHandle,
    has_selection: bool,
    text: Option<&str>,
    cursor_pos: (i32, i32),
    anchor_pos: Option<(i32, i32)>,
    release_gesture: Option<ReleaseGesture>,
    suppressed_by_plain_click: bool,
    hide_immediately: bool,
    selection_source: Option<&str>,
) {
    use tauri::Emitter;

    let gesture_name = release_gesture_name(release_gesture);
    let payload = if has_selection {
        let (anchor_x, anchor_y) = anchor_pos.unwrap_or(cursor_pos);
        serde_json::json!({
            "has_selection": true,
            "text": text.unwrap_or_default(),
            "cursor_x": cursor_pos.0,
            "cursor_y": cursor_pos.1,
            "anchor_x": anchor_x,
            "anchor_y": anchor_y,
            "release_gesture": gesture_name,
            "suppressed_by_plain_click": false,
            "hide_immediately": false,
            "selection_source": selection_source
        })
    } else {
        serde_json::json!({
            "has_selection": false,
            "text": null,
            "cursor_x": cursor_pos.0,
            "cursor_y": cursor_pos.1,
            "anchor_x": null,
            "anchor_y": null,
            "release_gesture": gesture_name,
            "suppressed_by_plain_click": suppressed_by_plain_click,
            "hide_immediately": hide_immediately,
            "selection_source": selection_source
        })
    };

    let _ = app.emit("neuropen://selection-changed", payload);
}

#[cfg(target_os = "windows")]
pub fn start_selection_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        init_com();
        let (mouse_tx, mouse_rx) = std::sync::mpsc::channel::<MouseHookEvent>();
        start_mouse_hook_thread(mouse_tx);

        let mut mouse_state = MouseGestureState::new(get_cursor_pos());
        let mut pending_candidate: Option<ReleaseCandidate> = None;
        let mut pending_probe: Option<(std::time::Instant, ReleaseCandidate)> = None;
        let mut last_emitted_selection = false;
        let mut last_emitted_text = String::new();
        let mut last_emitted_anchor: Option<(i32, i32)> = None;

        loop {
            std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));

            for event in mouse_rx.try_iter() {
                if matches!(event.kind, MouseHookEventKind::LeftDown) {
                    pending_candidate = None;
                    pending_probe = None;
                }

                if let Some(candidate) = mouse_state.handle_event(event) {
                    pending_candidate = Some(candidate);
                    pending_probe = None;
                }
            }

            if let Some((scheduled_at, candidate)) = pending_probe {
                let (cx, cy) = mouse_state.cursor_pos;
                let release_pos = candidate.release_pos;
                let cancel = is_ctrl_c_pressed()
                    || (cx - release_pos.0).abs() > PROBE_CANCEL_DISTANCE_PX
                    || (cy - release_pos.1).abs() > PROBE_CANCEL_DISTANCE_PX;
                if cancel {
                    pending_probe = None;
                } else if scheduled_at.elapsed()
                    >= std::time::Duration::from_millis(CLIPBOARD_PROBE_DELAY_MS)
                {
                    if !is_any_modifier_held() {
                        pending_probe = None;
                        if let Some(probe_text) = clipboard_probe_selection() {
                            let anchor = Some(release_pos);
                            let selection_changed = !last_emitted_selection
                                || probe_text != last_emitted_text
                                || anchor != last_emitted_anchor;
                            if selection_changed {
                                last_emitted_selection = true;
                                last_emitted_text = probe_text.clone();
                                last_emitted_anchor = anchor;
                                emit_selection_changed(
                                    &app,
                                    true,
                                    Some(&probe_text),
                                    release_pos,
                                    anchor,
                                    Some(candidate.gesture),
                                    false,
                                    false,
                                    Some("clipboard"),
                                );
                            }
                        } else {
                            last_emitted_selection = false;
                            last_emitted_text.clear();
                            last_emitted_anchor = None;
                            emit_selection_changed(
                                &app,
                                false,
                                None,
                                release_pos,
                                None,
                                Some(candidate.gesture),
                                false,
                                true,
                                Some("clipboard"),
                            );
                        }
                    }
                }
            }

            let candidate_ready = pending_candidate.as_ref().is_some_and(|candidate| {
                candidate.created_at.elapsed()
                    >= std::time::Duration::from_millis(SELECTION_CANDIDATE_DELAY_MS)
            });
            if !candidate_ready {
                continue;
            }

            let candidate = match pending_candidate.take() {
                Some(candidate) => candidate,
                None => continue,
            };
            let release_pos = candidate.release_pos;

            if matches!(candidate.gesture, ReleaseGesture::PlainClick) {
                last_emitted_selection = false;
                last_emitted_text.clear();
                last_emitted_anchor = None;
                emit_selection_changed(
                    &app,
                    false,
                    None,
                    release_pos,
                    None,
                    Some(candidate.gesture),
                    true,
                    true,
                    None,
                );
                continue;
            }

            match get_selected_text_details() {
                DetailedSelectionResult::Selected(details)
                    if selection_rects_match_gesture(
                        &details.rects,
                        candidate.drag_start,
                        release_pos,
                    ) =>
                {
                    let anchor = Some((details.anchor_x, details.anchor_y));
                    let selection_changed = !last_emitted_selection
                        || details.text != last_emitted_text
                        || anchor != last_emitted_anchor;
                    if selection_changed {
                        last_emitted_selection = true;
                        last_emitted_text = details.text.clone();
                        last_emitted_anchor = anchor;
                        emit_selection_changed(
                            &app,
                            true,
                            Some(&details.text),
                            release_pos,
                            anchor,
                            Some(candidate.gesture),
                            false,
                            false,
                            Some("uia"),
                        );
                    }
                }
                DetailedSelectionResult::Selected(_) => {
                    last_emitted_selection = false;
                    last_emitted_text.clear();
                    last_emitted_anchor = None;
                    emit_selection_changed(
                        &app,
                        false,
                        None,
                        release_pos,
                        None,
                        Some(candidate.gesture),
                        false,
                        true,
                        Some("uia-stale"),
                    );
                }
                DetailedSelectionResult::None | DetailedSelectionResult::Unavailable => {
                    if gesture_allows_clipboard_probe(candidate.gesture)
                        && is_chromium_editor_window()
                    {
                        pending_probe = Some((std::time::Instant::now(), candidate));
                    } else {
                        last_emitted_selection = false;
                        last_emitted_text.clear();
                        last_emitted_anchor = None;
                        emit_selection_changed(
                            &app,
                            false,
                            None,
                            release_pos,
                            None,
                            Some(candidate.gesture),
                            false,
                            true,
                            None,
                        );
                    }
                }
            }
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
        let gesture = classify_release_gesture(true, Some((100, 100)), (120, 102), None, None);
        assert_eq!(
            gesture,
            Some(ReleaseGesture::DragSelect { distance_px: 20 })
        );
    }

    #[test]
    fn classify_release_gesture_detects_plain_click() {
        let gesture = classify_release_gesture(true, Some((100, 100)), (101, 102), None, None);
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
    fn clipboard_probe_ignores_tiny_drag_drift() {
        let gesture =
            classify_release_gesture(true, Some((100, 100)), (104, 100), None, None).unwrap();

        assert_eq!(gesture, ReleaseGesture::PlainClick);
        assert!(!gesture_allows_clipboard_probe(gesture));
    }

    #[test]
    fn clipboard_probe_allows_deliberate_drag_and_double_click() {
        assert!(gesture_allows_clipboard_probe(ReleaseGesture::DragSelect {
            distance_px: CLIPBOARD_PROBE_DRAG_DISTANCE_THRESHOLD_PX
        }));
        assert!(gesture_allows_clipboard_probe(ReleaseGesture::DoubleClick));
        assert!(!gesture_allows_clipboard_probe(ReleaseGesture::PlainClick));
    }

    #[test]
    fn selection_geometry_requires_visible_rects_near_gesture() {
        let rects = [SelectionRect {
            left: 100.0,
            top: 100.0,
            width: 120.0,
            height: 20.0,
        }];

        assert!(selection_rects_match_gesture(
            &rects,
            Some((95, 110)),
            (220, 120)
        ));
        assert!(!selection_rects_match_gesture(
            &rects,
            Some((800, 800)),
            (900, 900)
        ));
        assert!(!selection_rects_match_gesture(
            &[SelectionRect {
                left: 100.0,
                top: 100.0,
                width: 0.0,
                height: 20.0,
            }],
            Some((100, 100)),
            (100, 100)
        ));
    }

    #[test]
    fn selection_anchor_uses_last_visible_rect() {
        let rects = [
            SelectionRect {
                left: 10.0,
                top: 20.0,
                width: 50.0,
                height: 15.0,
            },
            SelectionRect {
                left: 100.0,
                top: 60.0,
                width: 40.0,
                height: 20.0,
            },
        ];

        assert_eq!(selection_anchor_from_rects(&rects, 0, 0), (140, 80));
    }
}
