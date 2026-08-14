//! Global hotkey listener.
//!
//! - Trigger hotkey (configurable) pressed  → emit `hotkey://press`
//! - Trigger hotkey released                → emit `hotkey://release`
//! - `Alt+Z` pressed                       → emit `hotkey://undo`
//! - `Alt+S` pressed                       → emit `hotkey://screenshot`
//! - `Alt+Shift+D` pressed                 → emit `hotkey://dialog`
//!
//! Uses `tauri-plugin-global-shortcut` with a **single global handler**
//! instead of per-shortcut `on_shortcut()` calls. This avoids the ghost-
//! shortcut bug where `unregister()` / `unregister_all()` fail to fully
//! remove handlers that were set via `on_shortcut()`.

use std::sync::Mutex;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{plugin::TauriPlugin, Emitter, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// The currently registered trigger shortcut (so we can unregister + re-register).
static CURRENT_TRIGGER: Mutex<Option<Shortcut>> = Mutex::new(None);
/// The currently registered screenshot shortcut.
static CURRENT_SCREENSHOT: Mutex<Option<Shortcut>> = Mutex::new(None);
/// The currently registered dialog shortcut.
static CURRENT_DIALOG: Mutex<Option<Shortcut>> = Mutex::new(None);
/// Serializes register/unregister/state transitions across all configurable
/// shortcuts. Without it, concurrent IPC changes can leave a previously
/// registered shortcut behind after both callers read the same old value.
static HOTKEY_TRANSACTION_LOCK: Mutex<()> = Mutex::new(());
const DEFAULT_TRIGGER_HOTKEY: &str = "Alt+Backquote";
const DEFAULT_SCREENSHOT_HOTKEY: &str = "Alt+S";
const DEFAULT_DIALOG_HOTKEY: &str = "Alt+Shift+D";

/// The fixed undo shortcut.
fn undo_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT), Code::KeyZ)
}

/// The default screenshot shortcut.
fn default_screenshot_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT), Code::KeyS)
}

/// The default dialog shortcut.
fn default_dialog_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyD)
}

fn hotkey_file(file_name: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let dir = home.join(".neuropen");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    Some(dir.join(file_name))
}

fn load_persisted_hotkey(file_name: &str) -> Option<String> {
    let path = hotkey_file(file_name)?;
    if let Err(error) = recover_hotkey_backup(&path) {
        eprintln!("[hotkey] Failed to recover {file_name} persistence backup: {error}");
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    Some(content.trim().to_string())
}

fn persist_hotkey(file_name: &str, hotkey_type: &str, hotkey: &str) -> Result<(), String> {
    let path = hotkey_file(file_name)
        .ok_or_else(|| format!("Cannot resolve {hotkey_type} hotkey path"))?;
    atomic_write_hotkey(&path, hotkey)
        .map_err(|e| format!("Failed to persist {hotkey_type} hotkey: {e}"))
}

/// Persist a hotkey without truncating the existing file first. Windows cannot
/// rename over an existing file, so move the old value to a same-directory
/// backup, install the synced temporary file, and restore the backup on error.
fn atomic_write_hotkey(path: &Path, value: &str) -> Result<(), String> {
    recover_hotkey_backup(path)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let suffix = format!("{}.{}.{nonce}", std::process::id(), "tmp");
    let temp_path = path.with_extension(&suffix);
    let backup_path = hotkey_backup_path(path);

    let write_result = (|| -> Result<(), String> {
        let mut temp = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| format!("cannot create temporary hotkey file: {error}"))?;
        temp.write_all(value.as_bytes())
            .map_err(|error| format!("cannot write temporary hotkey file: {error}"))?;
        temp.sync_all()
            .map_err(|error| format!("cannot sync temporary hotkey file: {error}"))?;
        drop(temp);

        let had_existing = path.exists();
        if had_existing {
            fs::rename(path, &backup_path)
                .map_err(|error| format!("cannot preserve previous hotkey file: {error}"))?;
        }

        if let Err(error) = fs::rename(&temp_path, path) {
            if had_existing {
                if let Err(restore_error) = fs::rename(&backup_path, path) {
                    return Err(format!(
                        "cannot install temporary hotkey file: {error}; cannot restore previous hotkey file: {restore_error}"
                    ));
                }
            }
            return Err(format!("cannot install temporary hotkey file: {error}"));
        }

        if had_existing {
            let _ = fs::remove_file(&backup_path);
        }
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

fn hotkey_backup_path(path: &Path) -> PathBuf {
    path.with_extension("bak")
}

/// Recover a previous value when the process stopped between moving live →
/// backup and installing the new temporary file. If both files exist, the live
/// value was installed successfully and the backup is only stale cleanup.
fn recover_hotkey_backup(path: &Path) -> Result<(), String> {
    let backup_path = hotkey_backup_path(path);
    if !backup_path.exists() {
        return Ok(());
    }
    if path.exists() {
        fs::remove_file(&backup_path)
            .map_err(|error| format!("cannot remove stale hotkey backup: {error}"))?;
    } else {
        fs::rename(&backup_path, path)
            .map_err(|error| format!("cannot recover previous hotkey file: {error}"))?;
    }
    Ok(())
}

pub fn persist_trigger_hotkey(hotkey: &str) -> Result<(), String> {
    persist_hotkey("trigger_hotkey", "trigger", hotkey)
}

pub fn persist_screenshot_hotkey(hotkey: &str) -> Result<(), String> {
    persist_hotkey("screenshot_hotkey", "screenshot", hotkey)
}

pub fn persist_dialog_hotkey(hotkey: &str) -> Result<(), String> {
    persist_hotkey("dialog_hotkey", "dialog", hotkey)
}

pub fn current_trigger_hotkey() -> (String, bool) {
    match load_persisted_hotkey("trigger_hotkey") {
        Some(hotkey) => (hotkey, true),
        None => (DEFAULT_TRIGGER_HOTKEY.to_string(), false),
    }
}

pub fn current_screenshot_hotkey() -> (String, bool) {
    match load_persisted_hotkey("screenshot_hotkey") {
        Some(hotkey) => (hotkey, true),
        None => (DEFAULT_SCREENSHOT_HOTKEY.to_string(), false),
    }
}

pub fn current_dialog_hotkey() -> (String, bool) {
    match load_persisted_hotkey("dialog_hotkey") {
        Some(hotkey) => (hotkey, true),
        None => (DEFAULT_DIALOG_HOTKEY.to_string(), false),
    }
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
            let is_screenshot = CURRENT_SCREENSHOT
                .lock()
                .ok()
                .and_then(|guard| *guard)
                .map(|s| s == *shortcut)
                .unwrap_or(false);
            let is_dialog = CURRENT_DIALOG
                .lock()
                .ok()
                .and_then(|guard| *guard)
                .map(|d| d == *shortcut)
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
            } else if is_dialog && event.state == ShortcutState::Pressed {
                let _ = app.emit("hotkey://dialog", ());
                println!("[hotkey] Dialog hotkey triggered");
            } else if is_screenshot && event.state == ShortcutState::Pressed {
                let _ = app.emit("hotkey://screenshot", ());
                println!("[hotkey] Screenshot hotkey triggered");
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

/// Register the dialog hotkey from persisted config or fallback default.
pub fn register_dialog(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let (hotkey, persisted) = current_dialog_hotkey();
    if persisted && hotkey.trim().is_empty() {
        if let Ok(mut guard) = CURRENT_DIALOG.lock() {
            *guard = None;
        }
        println!("[hotkey] Dialog hotkey disabled");
        return Ok(());
    }
    let sc = if persisted {
        if let Ok((mods, code)) = parse_hotkey(&hotkey) {
            Shortcut::new(mods, code)
        } else {
            default_dialog_shortcut()
        }
    } else {
        default_dialog_shortcut()
    };
    if !app.global_shortcut().is_registered(sc) {
        app.global_shortcut().register(sc)?;
    }
    if let Ok(mut guard) = CURRENT_DIALOG.lock() {
        *guard = Some(sc);
    }
    println!("[hotkey] Registered dialog shortcut ({hotkey})");
    Ok(())
}

/// Register the trigger hotkey from persisted config or fallback default.
pub fn register_trigger(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let (hotkey, persisted) = current_trigger_hotkey();
    if persisted && hotkey.trim().is_empty() {
        if let Ok(mut guard) = CURRENT_TRIGGER.lock() {
            *guard = None;
        }
        println!("[hotkey] Trigger hotkey disabled");
        return Ok(());
    }
    let sc = if let Ok((mods, code)) = parse_hotkey(&hotkey) {
        Shortcut::new(mods, code)
    } else {
        Shortcut::new(Some(Modifiers::ALT), Code::Backquote)
    };
    if !app.global_shortcut().is_registered(sc) {
        app.global_shortcut().register(sc)?;
    }
    if let Ok(mut guard) = CURRENT_TRIGGER.lock() {
        *guard = Some(sc);
    }
    println!("[hotkey] Registered trigger shortcut ({hotkey})");
    Ok(())
}

/// Register the screenshot hotkey (Alt+S). Call once after app handle is ready.
pub fn register_screenshot(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let (hotkey, persisted) = current_screenshot_hotkey();
    if persisted && hotkey.trim().is_empty() {
        if let Ok(mut guard) = CURRENT_SCREENSHOT.lock() {
            *guard = None;
        }
        println!("[hotkey] Screenshot hotkey disabled");
        return Ok(());
    }
    let sc = if persisted {
        if let Ok((mods, code)) = parse_hotkey(&hotkey) {
            Shortcut::new(mods, code)
        } else {
            default_screenshot_shortcut()
        }
    } else {
        default_screenshot_shortcut()
    };
    if !app.global_shortcut().is_registered(sc) {
        app.global_shortcut().register(sc)?;
    }
    if let Ok(mut guard) = CURRENT_SCREENSHOT.lock() {
        *guard = Some(sc);
    }
    println!("[hotkey] Registered screenshot shortcut ({hotkey})");
    Ok(())
}

/// Register (or change) the screenshot hotkey.
pub fn change_screenshot(
    app: &tauri::AppHandle,
    modifiers: Option<Modifiers>,
    code: Code,
) -> Result<(), String> {
    change_shortcut(
        app,
        &CURRENT_SCREENSHOT,
        Shortcut::new(modifiers, code),
        "screenshot",
    )
}

/// Register (or change) the trigger hotkey.
/// - First call: just registers the given shortcut.
/// - Subsequent calls: unregisters the previous trigger, then registers the new one.
pub fn change_trigger(
    app: &tauri::AppHandle,
    modifiers: Option<Modifiers>,
    code: Code,
) -> Result<(), String> {
    change_shortcut(
        app,
        &CURRENT_TRIGGER,
        Shortcut::new(modifiers, code),
        "trigger",
    )
}

pub fn clear_trigger(app: &tauri::AppHandle) -> Result<(), String> {
    clear_shortcut(app, &CURRENT_TRIGGER, "trigger")
}

pub fn clear_screenshot(app: &tauri::AppHandle) -> Result<(), String> {
    clear_shortcut(app, &CURRENT_SCREENSHOT, "screenshot")
}

/// Register (or change) the dialog hotkey.
pub fn change_dialog(
    app: &tauri::AppHandle,
    modifiers: Option<Modifiers>,
    code: Code,
) -> Result<(), String> {
    change_shortcut(
        app,
        &CURRENT_DIALOG,
        Shortcut::new(modifiers, code),
        "dialog",
    )
}

pub fn clear_dialog(app: &tauri::AppHandle) -> Result<(), String> {
    clear_shortcut(app, &CURRENT_DIALOG, "dialog")
}

/// Change a registered shortcut without a gap in coverage. The new binding is
/// registered first; if removing the old one fails, the new binding is removed
/// again and the in-memory state remains unchanged.
fn change_shortcut(
    app: &tauri::AppHandle,
    current: &Mutex<Option<Shortcut>>,
    new_shortcut: Shortcut,
    label: &str,
) -> Result<(), String> {
    let _transaction = HOTKEY_TRANSACTION_LOCK
        .lock()
        .map_err(|error| format!("Hotkey transaction lock poisoned: {error}"))?;
    let old = current.lock().ok().and_then(|guard| *guard);
    if old == Some(new_shortcut) && app.global_shortcut().is_registered(new_shortcut) {
        return Ok(());
    }

    if old != Some(new_shortcut) && app.global_shortcut().is_registered(new_shortcut) {
        return Err(format!("The new {label} hotkey is already registered"));
    }

    app.global_shortcut()
        .register(new_shortcut)
        .map_err(|error| format!("Failed to register new {label} hotkey: {error}"))?;
    let registered_new = true;

    if let Some(old_shortcut) = old {
        if old_shortcut != new_shortcut && app.global_shortcut().is_registered(old_shortcut) {
            if let Err(error) = app.global_shortcut().unregister(old_shortcut) {
                if registered_new {
                    let _ = app.global_shortcut().unregister(new_shortcut);
                }
                return Err(format!(
                    "Failed to unregister old {label} hotkey; restored the previous registration: {error}"
                ));
            }
        }
    }

    let mut guard = current
        .lock()
        .map_err(|error| format!("{label} hotkey lock poisoned: {error}"))?;
    *guard = Some(new_shortcut);
    println!("[hotkey] Registered {label} shortcut: {new_shortcut:?}");
    Ok(())
}

fn clear_shortcut(
    app: &tauri::AppHandle,
    current: &Mutex<Option<Shortcut>>,
    label: &str,
) -> Result<(), String> {
    let _transaction = HOTKEY_TRANSACTION_LOCK
        .lock()
        .map_err(|error| format!("Hotkey transaction lock poisoned: {error}"))?;
    let old = current.lock().ok().and_then(|guard| *guard);
    if let Some(old_shortcut) = old {
        if app.global_shortcut().is_registered(old_shortcut) {
            app.global_shortcut()
                .unregister(old_shortcut)
                .map_err(|error| format!("Failed to unregister {label} hotkey: {error}"))?;
        }
    }
    let mut guard = current
        .lock()
        .map_err(|error| format!("{label} hotkey lock poisoned: {error}"))?;
    *guard = None;
    println!("[hotkey] {label} hotkey cleared");
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
        "f1" => Code::F1,
        "f2" => Code::F2,
        "f3" => Code::F3,
        "f4" => Code::F4,
        "f5" => Code::F5,
        "f6" => Code::F6,
        "f7" => Code::F7,
        "f8" => Code::F8,
        "f9" => Code::F9,
        "f10" => Code::F10,
        "f11" => Code::F11,
        "f12" => Code::F12,
        "a" => Code::KeyA,
        "b" => Code::KeyB,
        "c" => Code::KeyC,
        "d" => Code::KeyD,
        "e" => Code::KeyE,
        "f" => Code::KeyF,
        "g" => Code::KeyG,
        "h" => Code::KeyH,
        "i" => Code::KeyI,
        "j" => Code::KeyJ,
        "k" => Code::KeyK,
        "l" => Code::KeyL,
        "m" => Code::KeyM,
        "n" => Code::KeyN,
        "o" => Code::KeyO,
        "p" => Code::KeyP,
        "q" => Code::KeyQ,
        "r" => Code::KeyR,
        "s" => Code::KeyS,
        "t" => Code::KeyT,
        "u" => Code::KeyU,
        "v" => Code::KeyV,
        "w" => Code::KeyW,
        "x" => Code::KeyX,
        "y" => Code::KeyY,
        "z" => Code::KeyZ,
        "0" | "digit0" => Code::Digit0,
        "1" | "digit1" => Code::Digit1,
        "2" | "digit2" => Code::Digit2,
        "3" | "digit3" => Code::Digit3,
        "4" | "digit4" => Code::Digit4,
        "5" | "digit5" => Code::Digit5,
        "6" | "digit6" => Code::Digit6,
        "7" | "digit7" => Code::Digit7,
        "8" | "digit8" => Code::Digit8,
        "9" | "digit9" => Code::Digit9,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovers_backup_when_write_was_interrupted_after_moving_live_file() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("neuropen-hotkey-recovery-{nonce}"));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("trigger_hotkey");
        let backup = hotkey_backup_path(&path);
        fs::write(&backup, "Alt+Backquote").unwrap();

        recover_hotkey_backup(&path).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "Alt+Backquote");
        assert!(!backup.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
