//! Global hotkey listener.
//!
//! Phase 1 implementation:
//! - Register `Alt+Space` → emit `hotkey://trigger`
//! - Register `Alt+Z`     → emit `hotkey://undo`
//!
//! Uses `tauri-plugin-global-shortcut`.

use tauri::Emitter;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

/// Register all global hotkeys. Call once during app setup.
pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let alt_space = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    let alt_z = Shortcut::new(Some(Modifiers::ALT), Code::KeyZ);

    // Register Alt+Space → hotkey://trigger
    let app_handle = app.clone();
    app.global_shortcut().on_shortcut(alt_space, move |_app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            let _ = app_handle.emit("hotkey://trigger", ());
            println!("[hotkey] Alt+Space triggered");
        }
    })?;

    // Register Alt+Z → hotkey://undo
    let app_handle2 = app.clone();
    app.global_shortcut().on_shortcut(alt_z, move |_app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            let _ = app_handle2.emit("hotkey://undo", ());
            println!("[hotkey] Alt+Z triggered (undo)");
        }
    })?;

    println!("[hotkey] Registered Alt+Space and Alt+Z");
    Ok(())
}
