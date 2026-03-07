mod audio_capture;
mod clipboard;
mod history;
mod hotkey;
mod injection;
mod llm;
mod mode_router;
mod screenshot;
mod selection;
mod stt;
mod tts;
mod undo;
mod window_focus;

use serde::Serialize;
use std::io::ErrorKind;
use std::sync::Mutex;
use tauri::{Emitter, Listener, Manager};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem};
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredHotkeys {
    pub trigger_hotkey: String,
    pub trigger_persisted: bool,
    pub screenshot_hotkey: String,
    pub screenshot_persisted: bool,
}

#[derive(Debug, Clone)]
struct RuntimeSttConfig {
    engine: stt::SttEngine,
    model_path: String,
    stt_language: String,
}

static RUNTIME_STT_CONFIG: Mutex<Option<RuntimeSttConfig>> = Mutex::new(None);
#[cfg(target_os = "windows")]
static SINGLE_INSTANCE_GUARD: Mutex<Option<std::net::TcpListener>> = Mutex::new(None);

#[cfg(target_os = "windows")]
fn acquire_single_instance_lock() -> Result<(), String> {
    // Bind a localhost guard port for the process lifetime.
    // If another instance is already running, the address will already be in use.
    const SINGLE_INSTANCE_ADDR: &str = "127.0.0.1:48173";
    let listener = std::net::TcpListener::bind(SINGLE_INSTANCE_ADDR).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AddrInUse {
            "TalkFlow is already running.".to_string()
        } else {
            format!("Failed to acquire single-instance lock: {e}")
        }
    })?;
    let _ = listener.set_nonblocking(true);

    let mut guard = SINGLE_INSTANCE_GUARD
        .lock()
        .map_err(|e| format!("Failed to store single-instance guard: {e}"))?;
    *guard = Some(listener);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn acquire_single_instance_lock() -> Result<(), String> {
    Ok(())
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
    injection::inject_text_with_undo(&text, record_for_undo).map_err(|e| e.to_string())
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

/// Get current foreground window title.
#[tauri::command]
fn get_foreground_window_title() -> String {
    window_focus::get_foreground_window_title()
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

/// Start streaming partial transcription during recording.
#[tauri::command]
fn start_streaming_stt(
    app: tauri::AppHandle,
    engine: stt::SttEngine,
    model_path: String,
) -> Result<(), String> {
    let (effective_engine, effective_model_path, effective_stt_language) = RUNTIME_STT_CONFIG
        .lock()
        .ok()
        .and_then(|guard| {
            guard
                .as_ref()
                .map(|cfg| (cfg.engine.clone(), cfg.model_path.clone(), cfg.stt_language.clone()))
        })
        .unwrap_or((engine, model_path, "auto".to_string()));
    stt::start_streaming_stt(app, effective_engine, effective_model_path, effective_stt_language)
}

/// Stop microphone audio capture and transcribe via the selected engine.
#[tauri::command]
fn stop_recording(
    app: tauri::AppHandle,
    engine: stt::SttEngine,
    model_path: String,
) -> Result<(), String> {
    let (effective_engine, effective_model_path, effective_stt_language) = RUNTIME_STT_CONFIG
        .lock()
        .ok()
        .and_then(|guard| {
            guard
                .as_ref()
                .map(|cfg| (cfg.engine.clone(), cfg.model_path.clone(), cfg.stt_language.clone()))
        })
        .unwrap_or((engine, model_path, "auto".to_string()));
    stt::stop_recording(app, effective_engine, effective_model_path, effective_stt_language)
}

#[tauri::command]
fn set_runtime_stt_config(
    engine: stt::SttEngine,
    model_path: String,
    stt_language: Option<String>,
) -> Result<(), String> {
    let mut guard = RUNTIME_STT_CONFIG
        .lock()
        .map_err(|e| format!("Failed to lock STT runtime config: {e}"))?;
    *guard = Some(RuntimeSttConfig {
        engine,
        model_path,
        stt_language: stt_language.unwrap_or_else(|| "auto".to_string()),
    });
    Ok(())
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

#[tauri::command]
fn set_stt_api_key(key: String) -> Result<(), String> {
    stt::set_stt_api_key(key)
}

#[tauri::command]
fn has_stt_api_key() -> bool {
    stt::has_stt_api_key()
}

/// Return which STT engines are compiled into this binary.
#[tauri::command]
fn get_stt_capabilities() -> stt::SttCapabilities {
    stt::get_capabilities()
}

/// List local STT catalog with installed/active status.
#[tauri::command]
fn list_local_stt_models() -> Result<Vec<stt::LocalSttModel>, String> {
    stt::list_local_stt_models()
}

/// Install a local STT model file.
#[tauri::command]
async fn install_local_stt_model(app: tauri::AppHandle, model_id: String) -> Result<stt::LocalSttModel, String> {
    stt::install_local_stt_model(app, model_id).await
}

#[tauri::command]
fn cancel_local_stt_download() -> bool {
    stt::cancel_local_stt_download()
}

/// Delete an installed local STT model file.
#[tauri::command]
fn delete_local_stt_model(model_id: String) -> Result<(), String> {
    stt::delete_local_stt_model(model_id)
}

/// Select one installed local STT model as active and return its path.
#[tauri::command]
fn select_local_stt_model(model_id: String) -> Result<String, String> {
    stt::select_local_stt_model(model_id)
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

#[tauri::command]
fn set_audio_device(name: String) {
    audio_capture::set_input_device(name);
}

const WINDOWS_RUN_KEY_PATH: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const WINDOWS_RUN_VALUE_NAME: &str = "TalkFlow";

#[cfg(target_os = "windows")]
fn set_windows_launch_on_startup(enabled: bool) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_WRITE};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    if enabled {
        let (run_key, _) = hkcu
            .create_subkey(WINDOWS_RUN_KEY_PATH)
            .map_err(|e| format!("Failed to open Run key: {e}"))?;
        let exe = std::env::current_exe().map_err(|e| format!("Failed to get current exe path: {e}"))?;
        let value = format!("\"{}\"", exe.display());
        run_key
            .set_value(WINDOWS_RUN_VALUE_NAME, &value)
            .map_err(|e| format!("Failed to set Run key value: {e}"))?;
    } else {
        match hkcu.open_subkey_with_flags(WINDOWS_RUN_KEY_PATH, KEY_WRITE) {
            Ok(run_key) => {
                if let Err(e) = run_key.delete_value(WINDOWS_RUN_VALUE_NAME) {
                    if e.kind() != ErrorKind::NotFound {
                        return Err(format!("Failed to delete Run key value: {e}"));
                    }
                }
            }
            Err(e) if e.kind() == ErrorKind::NotFound => { /* key doesn't exist, nothing to delete */ }
            Err(e) => return Err(format!("Failed to open Run key: {e}")),
        }
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_windows_launch_on_startup(_enabled: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn get_windows_launch_on_startup() -> Result<bool, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = match hkcu.open_subkey(WINDOWS_RUN_KEY_PATH) {
        Ok(key) => key,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(format!("Failed to open Run key: {e}")),
    };

    match run_key.get_value::<String, _>(WINDOWS_RUN_VALUE_NAME) {
        Ok(value) => Ok(!value.trim().is_empty()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("Failed to read Run key value: {e}")),
    }
}

#[cfg(not(target_os = "windows"))]
fn get_windows_launch_on_startup() -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    set_windows_launch_on_startup(enabled)
}

#[tauri::command]
fn get_launch_on_startup() -> Result<bool, String> {
    get_windows_launch_on_startup()
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
    preferred_language: Option<String>,
    prompt_mode: Option<String>,
    prompt_override: Option<String>,
) -> Result<(), String> {
    let api_key = if matches!(&provider, llm::LlmProvider::Ollama) {
        String::new()
    } else {
        stt::get_api_key()?
    };
    llm::call_llm(
        &api_key,
        &selected_text,
        &instruction,
        output_mode,
        provider,
        &model,
        preferred_language,
        prompt_mode,
        prompt_override,
        app,
    )
    .await
}

/// Call the LLM and return final text (non-streaming helper for STT refinement).
#[tauri::command]
async fn call_llm_text(
    selected_text: String,
    instruction: String,
    provider: llm::LlmProvider,
    model: String,
    preferred_language: Option<String>,
    prompt_mode: Option<String>,
    prompt_override: Option<String>,
) -> Result<String, String> {
    let api_key = if matches!(&provider, llm::LlmProvider::Ollama) {
        String::new()
    } else {
        stt::get_api_key()?
    };
    llm::call_llm_text(
        &api_key,
        &selected_text,
        &instruction,
        provider,
        &model,
        preferred_language,
        prompt_mode,
        prompt_override,
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
    let normalized = hotkey_str.trim();
    if normalized.is_empty() {
        hotkey::clear_trigger(&app)?;
        return hotkey::persist_trigger_hotkey("");
    }
    let (modifiers, code) = hotkey::parse_hotkey(normalized)?;
    hotkey::change_trigger(&app, modifiers, code)?;
    hotkey::persist_trigger_hotkey(normalized)
}

/// Change the screenshot hotkey at runtime.
#[tauri::command]
fn change_screenshot_hotkey(app: tauri::AppHandle, hotkey_str: String) -> Result<(), String> {
    let normalized = hotkey_str.trim();
    if normalized.is_empty() {
        hotkey::clear_screenshot(&app)?;
        hotkey::persist_screenshot_hotkey("")?;
        return Ok(());
    }
    let (modifiers, code) = hotkey::parse_hotkey(normalized)?;
    hotkey::change_screenshot(&app, modifiers, code)?;
    hotkey::persist_screenshot_hotkey(normalized)?;
    Ok(())
}

#[tauri::command]
fn get_registered_hotkeys() -> RegisteredHotkeys {
    let (trigger_hotkey, trigger_persisted) = hotkey::current_trigger_hotkey();
    let (screenshot_hotkey, screenshot_persisted) = hotkey::current_screenshot_hotkey();
    RegisteredHotkeys {
        trigger_hotkey,
        trigger_persisted,
        screenshot_hotkey,
        screenshot_persisted,
    }
}

// ── History commands ────────────────────────────────────────────────────

#[tauri::command]
fn history_list() -> Vec<history::HistoryEntry> {
    history::list()
}

#[tauri::command]
fn history_save(
    mode: String,
    input_text: String,
    instruction: String,
    output: String,
    provider: String,
    model: String,
) {
    history::save(&mode, &input_text, &instruction, &output, &provider, &model);
}

#[tauri::command]
fn history_delete(id: String) -> bool {
    history::delete(&id)
}

#[tauri::command]
fn history_clear() {
    history::clear_all();
}

#[tauri::command]
fn history_search(query: String) -> Vec<history::HistoryEntry> {
    history::search(&query)
}

// ── TTS commands ────────────────────────────────────────────────────────

#[tauri::command]
async fn tts_speak(
    app: tauri::AppHandle,
    text: String,
    voice: Option<String>,
    rate: Option<String>,
    pitch: Option<String>,
) -> Result<(), String> {
    tts::speak(app, text, voice, rate, pitch).await
}

#[tauri::command]
fn tts_stop() {
    tts::stop_playback();
}

#[tauri::command]
fn tts_is_playing() -> bool {
    tts::is_playing()
}

// ── Screenshot commands ─────────────────────────────────────────────────

#[tauri::command]
fn take_screenshot() -> Result<screenshot::ScreenshotResult, String> {
    screenshot::capture_full_screen()
}

#[tauri::command]
fn take_screenshot_region(x: i32, y: i32, w: u32, h: u32) -> Result<screenshot::ScreenshotResult, String> {
    screenshot::capture_region(x, y, w, h)
}

// ── Multimodal LLM (image + text) ──────────────────────────────────────

#[tauri::command]
async fn call_llm_with_image(
    app: tauri::AppHandle,
    image_base64: String,
    instruction: String,
    output_mode: llm::OutputMode,
    provider: llm::LlmProvider,
    model: String,
    preferred_language: Option<String>,
    prompt_mode: Option<String>,
    prompt_override: Option<String>,
) -> Result<(), String> {
    let api_key = if matches!(&provider, llm::LlmProvider::Ollama) {
        String::new()
    } else {
        stt::get_api_key()?
    };
    llm::call_llm_with_image(
        &api_key,
        &image_base64,
        &instruction,
        output_mode,
        provider,
        &model,
        preferred_language,
        prompt_mode,
        prompt_override,
        app,
    )
    .await
}

// ── Conversation context ────────────────────────────────────────────────

#[tauri::command]
fn clear_conversation() {
    llm::clear_conversation();
}

// ── Context-aware window title ──────────────────────────────────────────

#[tauri::command]
fn get_app_context() -> String {
    window_focus::get_foreground_window_title()
}

fn show_settings_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let win = app
        .get_webview_window("settings")
        .ok_or_else(|| "settings window not found".to_string())?;
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

// ── App setup ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(err) = acquire_single_instance_lock() {
        eprintln!("[setup] {err}");
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(hotkey::build_plugin())
        .invoke_handler(tauri::generate_handler![
            trigger_hotkey,
            get_selection,
            read_selection_clipboard,
            inject_text,
            undo_injection,
            verify_focus,
            restore_focus,
            get_foreground_window_title,
            copy_to_clipboard,
            restore_clipboard,
            start_recording,
            start_streaming_stt,
            stop_recording,
            set_runtime_stt_config,
            is_recording,
            set_api_key,
            has_api_key,
            set_stt_api_key,
            has_stt_api_key,
            get_stt_capabilities,
            list_local_stt_models,
            install_local_stt_model,
            cancel_local_stt_download,
            delete_local_stt_model,
            select_local_stt_model,
            list_audio_devices,
            set_audio_device,
            set_launch_on_startup,
            get_launch_on_startup,
            call_llm,
            call_llm_text,
            call_llm_with_image,
            clear_conversation,
            route_transcript,
            route_on_trigger,
            change_hotkey,
            change_screenshot_hotkey,
            get_registered_hotkeys,
            history_list,
            history_save,
            history_delete,
            history_clear,
            history_search,
            tts_speak,
            tts_stop,
            tts_is_playing,
            take_screenshot,
            take_screenshot_region,
            get_app_context,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                let settings_item = MenuItem::with_id(
                    app,
                    "tray_open_settings",
                    "設定",
                    true,
                    Option::<&str>::None,
                )
                .map_err(|e| e.to_string())?;
                let quit_item =
                    MenuItem::with_id(app, "tray_quit", "離開", true, Option::<&str>::None)
                        .map_err(|e| e.to_string())?;
                let tray_menu =
                    Menu::with_items(app, &[&settings_item, &quit_item]).map_err(|e| e.to_string())?;

                let mut tray_builder = TrayIconBuilder::with_id("talkflow-tray")
                    .menu(&tray_menu)
                    .tooltip("TalkFlow")
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "tray_open_settings" => {
                            let _ = show_settings_window(app);
                        }
                        "tray_quit" => app.exit(0),
                        _ => {}
                    });

                if let Some(icon) = app.default_window_icon().cloned() {
                    tray_builder = tray_builder.icon(icon);
                }

                tray_builder.build(app).map_err(|e| e.to_string())?;
            }

            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.hide();
            }

            // Initialize COM for UI Automation on the main thread
            selection::init_com();

            // Start selection watcher (background polling)
            selection::start_selection_watcher(app.handle().clone());

            let handle = app.handle().clone();
            if let Err(e) = hotkey::register_undo(&handle) {
                eprintln!("[setup] Failed to register undo hotkey: {e}");
            }
            if let Err(e) = hotkey::register_trigger(&handle) {
                eprintln!("[setup] Failed to register trigger hotkey: {e}");
            }
            if let Err(e) = hotkey::register_screenshot(&handle) {
                eprintln!("[setup] Failed to register screenshot hotkey: {e}");
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
