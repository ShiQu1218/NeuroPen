mod audio_capture;
mod clipboard;
mod hotkey;
mod injection;
mod llm;
mod mode_router;
mod selection;
mod stt;
mod undo;
mod window_focus;

use serde::Serialize;
use tauri::{Emitter, Listener};

// ── Tauri command return types ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SelectionInfo {
    pub has_selection: bool,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FocusInfo {
    pub hwnd: isize,
}

// ── Tauri commands exposed to the frontend ──────────────────────────────

/// Lock the current foreground window and cache clipboard.
#[tauri::command]
fn trigger_hotkey() -> Result<FocusInfo, String> {
    window_focus::lock_foreground_window();
    let hwnd = window_focus::get_locked_hwnd();
    clipboard::cache_clipboard()?;
    Ok(FocusInfo { hwnd })
}

/// Read current text selection via UI Automation.
#[tauri::command]
fn get_selection() -> SelectionInfo {
    match selection::get_selected_text() {
        selection::SelectionResult::Selected(text) => SelectionInfo {
            has_selection: true,
            text: Some(text),
        },
        selection::SelectionResult::None | selection::SelectionResult::Unavailable => {
            SelectionInfo {
                has_selection: false,
                text: None,
            }
        }
    }
}

/// Read selected text by simulating Ctrl+C (fallback when UI Automation fails).
#[tauri::command]
fn read_selection_clipboard() -> Result<String, String> {
    injection::read_selection_via_clipboard().map_err(|e| e.to_string())
}

/// Inject text into the locked foreground window.
#[tauri::command]
fn inject_text(text: String, record_for_undo: bool) -> Result<(), String> {
    let hwnd = window_focus::get_locked_hwnd();
    injection::inject_text(&text).map_err(|e| e.to_string())?;
    if record_for_undo {
        undo::record_injection(hwnd, text);
    }
    Ok(())
}

/// Undo the last direct injection (Alt+Z handler).
#[tauri::command]
fn undo_injection() -> Result<bool, String> {
    undo::undo_last_injection()
}

/// Verify that the foreground window hasn't changed since locking.
#[tauri::command]
fn verify_focus() -> bool {
    window_focus::verify_focus_unchanged()
}

/// Restore focus to the locked foreground window (for Replace from Preview Window).
#[tauri::command]
fn restore_focus() -> bool {
    window_focus::restore_focus()
}

/// Write text to clipboard (for "Copy" button in Preview Window).
#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    clipboard::write_clipboard(&text)
}

/// Restore clipboard to its original content.
#[tauri::command]
fn restore_clipboard() -> Result<(), String> {
    clipboard::restore_clipboard()
}

/// Start microphone audio capture.
#[tauri::command]
fn start_recording(app: tauri::AppHandle) -> Result<(), String> {
    stt::start_recording(app)
}

/// Stop microphone audio capture and transcribe via the selected engine.
#[tauri::command]
fn stop_recording(
    app: tauri::AppHandle,
    engine: stt::SttEngine,
    model_path: String,
) -> Result<(), String> {
    stt::stop_recording(app, engine, model_path)
}

/// Store the OpenAI API key (in OS credential store + in-process cache).
#[tauri::command]
fn set_api_key(key: String) -> Result<(), String> {
    stt::set_api_key(key)
}

/// Check whether an API key has been configured.
#[tauri::command]
fn has_api_key() -> bool {
    stt::has_api_key()
}

/// Return which STT engines are compiled into this binary.
#[tauri::command]
fn get_stt_capabilities() -> stt::SttCapabilities {
    stt::get_capabilities()
}

/// Check if currently recording.
#[tauri::command]
fn is_recording() -> bool {
    stt::is_recording()
}

/// List available audio input devices.
#[tauri::command]
fn list_audio_devices() -> Vec<String> {
    audio_capture::list_input_devices()
}

/// Call the LLM with streaming and emit token events.
#[tauri::command]
async fn call_llm(
    app: tauri::AppHandle,
    selected_text: String,
    instruction: String,
    output_mode: llm::OutputMode,
    provider: llm::LlmProvider,
    model: String,
) -> Result<(), String> {
    let api_key = stt::get_api_key()?;
    llm::call_llm(
        &api_key,
        &selected_text,
        &instruction,
        output_mode,
        provider,
        &model,
        app,
    )
    .await
}

/// Route a completed STT transcript to determine the operating mode.
#[tauri::command]
fn route_transcript(
    transcript: String,
    selected_text: Option<String>,
    wake_word: String,
    incognito: bool,
) -> mode_router::RouteResult {
    mode_router::build_route_result(&transcript, selected_text, &wake_word, incognito)
}

/// Get the initial mode routing based on whether text is selected.
#[tauri::command]
fn route_on_trigger(has_selection: bool) -> mode_router::AppMode {
    mode_router::route_on_trigger(has_selection)
}

/// Change the global trigger hotkey at runtime.
#[tauri::command]
fn change_hotkey(app: tauri::AppHandle, hotkey_str: String) -> Result<(), String> {
    let (modifiers, code) = hotkey::parse_hotkey(&hotkey_str)?;
    hotkey::change_trigger(&app, modifiers, code)
}

// ── App setup ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            trigger_hotkey,
            get_selection,
            read_selection_clipboard,
            inject_text,
            undo_injection,
            verify_focus,
            restore_focus,
            copy_to_clipboard,
            restore_clipboard,
            start_recording,
            stop_recording,
            is_recording,
            set_api_key,
            has_api_key,
            get_stt_capabilities,
            list_audio_devices,
            call_llm,
            route_transcript,
            route_on_trigger,
            change_hotkey,
        ])
        .setup(|app| {
            // Initialize COM for UI Automation on the main thread
            selection::init_com();

            // Start selection watcher (background polling)
            selection::start_selection_watcher(app.handle().clone());

            // Register global hotkeys
            let handle = app.handle().clone();
            if let Err(e) = hotkey::setup(&handle) {
                eprintln!("[setup] Failed to register hotkeys: {e}");
            }

            // ── hotkey://press → start recording (press-and-hold) ──
            let handle_press = app.handle().clone();
            app.listen("hotkey://press", move |_event| {
                println!("[event] hotkey://press received");

                // If already recording, ignore (don't double-start from key repeat)
                if stt::is_recording() {
                    return;
                }

                // Lock window & cache clipboard
                window_focus::lock_foreground_window();
                let _ = clipboard::cache_clipboard();

                // Check selection
                let sel = selection::get_selected_text();
                let (has_selection, selected_text) = match sel {
                    selection::SelectionResult::Selected(text) => (true, Some(text)),
                    _ => (false, None),
                };

                let initial_mode = mode_router::route_on_trigger(has_selection);

                let _ = handle_press.emit("talkflow://mode-start", serde_json::json!({
                    "has_selection": has_selection,
                    "selected_text": selected_text,
                    "initial_mode": initial_mode,
                    "hwnd": window_focus::get_locked_hwnd(),
                }));
            });

            // ── hotkey://release → stop recording ──
            let handle_release = app.handle().clone();
            app.listen("hotkey://release", move |_event| {
                println!("[event] hotkey://release received");

                // Only stop if currently recording
                if !stt::is_recording() {
                    return;
                }

                let _ = handle_release.emit("talkflow://hotkey-release", ());
            });

            // Listen for hotkey://undo → undo last injection
            let handle_undo = app.handle().clone();
            app.listen("hotkey://undo", move |_event| {
                println!("[event] hotkey://undo received");
                match undo::undo_last_injection() {
                    Ok(true) => {
                        let _ = handle_undo.emit("talkflow://undo-result", serde_json::json!({ "success": true }));
                    }
                    Ok(false) => {
                        let _ = handle_undo.emit("talkflow://undo-result", serde_json::json!({ "success": false, "reason": "nothing_to_undo" }));
                    }
                    Err(e) => {
                        let _ = handle_undo.emit("talkflow://undo-result", serde_json::json!({ "success": false, "reason": e }));
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
