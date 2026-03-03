//! Global hotkey listener.
//!
//! - Trigger hotkey (configurable) pressed  → emit `hotkey://press`
//! - Trigger hotkey released                → emit `hotkey://release`
//! - `Alt+Z` pressed                       → emit `hotkey://undo`
//!
//! Uses `tauri-plugin-global-shortcut` with a **single global handler**
//! instead of per-shortcut `on_shortcut()` calls. This avoids the ghost-
//! shortcut bug where `unregister()` / `unregister_all()` fail to fully
//! remove handlers that were set via `on_shortcut()`.

use std::sync::Mutex;
use tauri::{Emitter, Runtime, plugin::TauriPlugin};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// The currently registered trigger shortcut (so we can unregister + re-register).
static CURRENT_TRIGGER: Mutex<Option<Shortcut>> = Mutex::new(None);

/// The fixed undo shortcut.
fn undo_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT), Code::KeyZ)
}

/// Build the plugin with a single global handler that dispatches events
/// based on the current trigger shortcut. Call this once during app setup
/// (in `tauri::Builder::default().plugin(...)`).
pub fn build_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            let is_trigger = CURRENT_TRIGGER
                .lock()
                .ok()
                .and_then(|guard| *guard)
                .map(|t| t == *shortcut)
                .unwrap_or(false);

            if is_trigger {
                match event.state {
                    ShortcutState::Pressed => {
                        let _ = app.emit("hotkey://press", ());
                        println!("[hotkey] Trigger pressed");
                    }
                    ShortcutState::Released => {
                        let _ = app.emit("hotkey://release", ());
                        println!("[hotkey] Trigger released");
                    }
                }
            } else if *shortcut == undo_shortcut() && event.state == ShortcutState::Pressed {
                let _ = app.emit("hotkey://undo", ());
                println!("[hotkey] Alt+Z triggered (undo)");
            }
        })
        .build()
}

/// Register the undo hotkey (Alt+Z). Call once after the app handle is ready.
pub fn register_undo(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let sc = undo_shortcut();
    if !app.global_shortcut().is_registered(sc) {
        app.global_shortcut().register(sc)?;
        println!("[hotkey] Registered undo shortcut (Alt+Z)");
    }
    Ok(())
}

/// Register (or change) the trigger hotkey.
/// - First call: just registers the given shortcut.
/// - Subsequent calls: unregisters the previous trigger, then registers the new one.
pub fn change_trigger(app: &tauri::AppHandle, modifiers: Option<Modifiers>, code: Code) -> Result<(), String> {
    let new_shortcut = Shortcut::new(modifiers, code);

    // Unregister the previous trigger (if any)
    if let Some(old) = CURRENT_TRIGGER.lock().ok().and_then(|guard| *guard) {
        if app.global_shortcut().is_registered(old) {
            app.global_shortcut()
                .unregister(old)
                .map_err(|e| format!("Failed to unregister old hotkey: {e}"))?;
            println!("[hotkey] Unregistered old trigger");
        }
    }

    // Register the new trigger
    app.global_shortcut()
        .register(new_shortcut)
        .map_err(|e| format!("Failed to register new hotkey: {e}"))?;

    // Update stored shortcut
    if let Ok(mut guard) = CURRENT_TRIGGER.lock() {
        *guard = Some(new_shortcut);
    }

    println!("[hotkey] Registered trigger shortcut: {modifiers:?}+{code:?}");
    Ok(())
}

/// Parse a hotkey string like "Alt+Space" into (Modifiers, Code).
pub fn parse_hotkey(hotkey: &str) -> Result<(Option<Modifiers>, Code), String> {
    let parts: Vec<&str> = hotkey.split('+').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return Err("Empty hotkey".into());
    }

    let mut modifiers = Modifiers::empty();
    let mut has_mods = false;

    for &part in &parts[..parts.len() - 1] {
        has_mods = true;
        match part.to_lowercase().as_str() {
            "alt" => modifiers |= Modifiers::ALT,
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "shift" => modifiers |= Modifiers::SHIFT,
            "super" | "meta" | "win" => modifiers |= Modifiers::SUPER,
            _ => return Err(format!("Unknown modifier: {part}")),
        }
    }

    let key_str = parts.last().unwrap();
    let code = match key_str.to_lowercase().as_str() {
        "space" => Code::Space,
        "enter" | "return" => Code::Enter,
        "tab" => Code::Tab,
        "escape" | "esc" => Code::Escape,
        "backspace" => Code::Backspace,
        "delete" => Code::Delete,
        "insert" => Code::Insert,
        "home" => Code::Home,
        "end" => Code::End,
        "pageup" => Code::PageUp,
        "pagedown" => Code::PageDown,
        "arrowup" | "up" => Code::ArrowUp,
        "arrowdown" | "down" => Code::ArrowDown,
        "arrowleft" | "left" => Code::ArrowLeft,
        "arrowright" | "right" => Code::ArrowRight,
        "f1" => Code::F1, "f2" => Code::F2, "f3" => Code::F3, "f4" => Code::F4,
        "f5" => Code::F5, "f6" => Code::F6, "f7" => Code::F7, "f8" => Code::F8,
        "f9" => Code::F9, "f10" => Code::F10, "f11" => Code::F11, "f12" => Code::F12,
        "a" => Code::KeyA, "b" => Code::KeyB, "c" => Code::KeyC, "d" => Code::KeyD,
        "e" => Code::KeyE, "f" => Code::KeyF, "g" => Code::KeyG, "h" => Code::KeyH,
        "i" => Code::KeyI, "j" => Code::KeyJ, "k" => Code::KeyK, "l" => Code::KeyL,
        "m" => Code::KeyM, "n" => Code::KeyN, "o" => Code::KeyO, "p" => Code::KeyP,
        "q" => Code::KeyQ, "r" => Code::KeyR, "s" => Code::KeyS, "t" => Code::KeyT,
        "u" => Code::KeyU, "v" => Code::KeyV, "w" => Code::KeyW, "x" => Code::KeyX,
        "y" => Code::KeyY, "z" => Code::KeyZ,
        "0" | "digit0" => Code::Digit0, "1" | "digit1" => Code::Digit1,
        "2" | "digit2" => Code::Digit2, "3" | "digit3" => Code::Digit3,
        "4" | "digit4" => Code::Digit4, "5" | "digit5" => Code::Digit5,
        "6" | "digit6" => Code::Digit6, "7" | "digit7" => Code::Digit7,
        "8" | "digit8" => Code::Digit8, "9" | "digit9" => Code::Digit9,
        "`" | "backquote" | "dead" => Code::Backquote,
        "-" | "minus" => Code::Minus,
        "=" | "equal" => Code::Equal,
        "[" | "bracketleft" => Code::BracketLeft,
        "]" | "bracketright" => Code::BracketRight,
        "\\" | "backslash" => Code::Backslash,
        ";" | "semicolon" => Code::Semicolon,
        "'" | "quote" => Code::Quote,
        "," | "comma" => Code::Comma,
        "." | "period" => Code::Period,
        "/" | "slash" => Code::Slash,
        _ => return Err(format!("Unknown key: {key_str}")),
    };

    Ok((if has_mods { Some(modifiers) } else { None }, code))
}
