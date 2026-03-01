//! Global hotkey listener.
//!
//! - `Alt+Backquote` pressed  → emit `hotkey://press`
//! - `Alt+Backquote` released → emit `hotkey://release`
//! - `Alt+Z`    pressed   → emit `hotkey://undo`
//!
//! Uses `tauri-plugin-global-shortcut`.

use std::sync::Mutex;
use tauri::Emitter;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// The currently registered trigger shortcut (so we can unregister + re-register).
static CURRENT_SHORTCUT: Mutex<Option<(Option<Modifiers>, Code)>> = Mutex::new(None);

/// Register all global hotkeys. Call once during app setup.
/// Safe to call multiple times — unregisters existing shortcuts first.
pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Unregister any existing shortcuts first (idempotent)
    let alt_space = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    let alt_backquote = Shortcut::new(Some(Modifiers::ALT), Code::Backquote);
    let alt_z = Shortcut::new(Some(Modifiers::ALT), Code::KeyZ);
    let _ = app.global_shortcut().unregister(alt_space);
    let _ = app.global_shortcut().unregister(alt_backquote);
    let _ = app.global_shortcut().unregister(alt_z);

    register_trigger(app, Some(Modifiers::ALT), Code::Backquote)?;
    register_undo(app)?;
    Ok(())
}

/// Register the main trigger hotkey (Alt+` by default).
fn register_trigger(
    app: &tauri::AppHandle,
    modifiers: Option<Modifiers>,
    code: Code,
) -> Result<(), Box<dyn std::error::Error>> {
    let shortcut = Shortcut::new(modifiers, code);
    let app_handle = app.clone();

    app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
        match event.state {
            ShortcutState::Pressed => {
                let _ = app_handle.emit("hotkey://press", ());
                println!("[hotkey] Trigger pressed");
            }
            ShortcutState::Released => {
                let _ = app_handle.emit("hotkey://release", ());
                println!("[hotkey] Trigger released");
            }
        }
    })?;

    // Store current shortcut for later unregister
    if let Ok(mut guard) = CURRENT_SHORTCUT.lock() {
        *guard = Some((modifiers, code));
    }

    println!("[hotkey] Registered trigger shortcut");
    Ok(())
}

/// Register the undo hotkey (Alt+Z, always fixed).
fn register_undo(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let alt_z = Shortcut::new(Some(Modifiers::ALT), Code::KeyZ);
    let app_handle = app.clone();

    app.global_shortcut().on_shortcut(alt_z, move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            let _ = app_handle.emit("hotkey://undo", ());
            println!("[hotkey] Alt+Z triggered (undo)");
        }
    })?;

    Ok(())
}

/// Re-register the trigger hotkey with a new key combination.
/// Called from the frontend when the user changes the hotkey setting.
pub fn change_trigger(app: &tauri::AppHandle, modifiers: Option<Modifiers>, code: Code) -> Result<(), String> {
    let previous = CURRENT_SHORTCUT.lock().ok().and_then(|guard| *guard);

    // Unregister known trigger candidates (do not touch undo Alt+Z).
    if let Some((old_mods, old_code)) = previous {
        let _ = app.global_shortcut().unregister(Shortcut::new(old_mods, old_code));
    }
    let _ = app
        .global_shortcut()
        .unregister(Shortcut::new(Some(Modifiers::ALT), Code::Space));
    let _ = app
        .global_shortcut()
        .unregister(Shortcut::new(Some(Modifiers::ALT), Code::Backquote));

    if let Err(e) = register_trigger(app, modifiers, code) {
        // Best-effort rollback so the app keeps a usable trigger.
        if let Some((old_mods, old_code)) = previous {
            let _ = register_trigger(app, old_mods, old_code);
        }
        return Err(format!("Failed to register new hotkey: {e}"));
    }

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
