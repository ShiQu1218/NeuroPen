# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

NeuroPen is a **Windows Desktop AI Voice Assistant** currently in the specification/initialization phase. The full product spec is in `NeuroPen_產品規格與架構書.md` (v1.4). No source code has been implemented yet.

## Planned Tech Stack

- **Framework**: Tauri (Rust backend + TypeScript/React frontend)
- **STT Models**: Whisper (streaming, v1.0 MVP), Parakeet, Moonshine
- **LLM**: OpenAI API (v1.0 MVP), local offline models (v2.0)
- **Windows APIs**: UI Automation API (text selection detection), `GetForegroundWindow`

## Development Commands (once Tauri is initialized)

```bash
# Install dependencies
npm install

# Run dev server
npm run tauri dev

# Build desktop app
npm run tauri build

# Run tests
npm test
```

## Architecture: Three Operating Modes

The app routes behavior based on whether text is selected and whether a wake word is spoken, all triggered by the global hotkey `Alt + Space`:

| Mode | Trigger | Output |
|------|---------|--------|
| **A** — Direct Voice Input | No selection + hotkey + no wake word | STT text → focused input box |
| **B1** — Quick Action Icon | Text selected + mouse hover Quick Action Icon | LLM result → Output Preview Window |
| **B2** — Voice Command on Selection | Text selected + hotkey + voice instruction | LLM result → Output Preview Window |
| **C** — LLM Query | No selection + hotkey + wake word ("助理") | LLM answer → Output Preview Window |

**Mode A/C routing**: Streaming STT detects the wake word inline. If detected mid-speech, immediately switches to Mode C without waiting for the sentence to end.

## Key Architectural Components

### Rust Backend
- Global hotkey listener (`Alt + Space`, `Alt + Z` for undo)
- UI Automation API polling to detect text selection → determines Mode A vs B
- Window focus locking via `GetForegroundWindow()` at trigger time
- Clipboard manager: cache → read → inject → restore
- Text injection: write to clipboard → simulate `Ctrl+V`
- Streaming STT and LLM API calls

### TypeScript/React Frontend
- **Settings UI**: model selection, hotkey config, wake word, output mode toggle
- **Quick Action Icon**: floating UI appearing on text selection with preset commands (translate, summarize, fix grammar, formalize) and custom input
- **Output Preview Window**: scrollable LLM output + refinement input field + Copy/Replace/Close buttons; supports voice input via `Alt + Space` while focused
- **Recording Indicator**: floating overlay shown during voice capture

## Critical Design Constraints

- **Focus-only output**: All text injection targets only the window that had focus at hotkey trigger time. If focus changes before injection, cancel and warn the user.
- **Clipboard safety**: Always cache clipboard before operations and restore after — users must not lose clipboard content.
- **Undo**: `Alt + Z` reverts only the last injection (not LLM Preview Window outputs).
- **Windows-only**: v1.0 targets Windows only. UI Automation API is not supported by all apps (games, some custom-drawn UIs) — Quick Action Icon silently degrades; users fall back to Mode B2.
- **Simulated input blocking**: Some apps (games, some Electron apps) block `Ctrl+V` simulation — show error, do not attempt workarounds.

## Text Injection Flow

1. Cache current clipboard content at hotkey trigger
2. Lock foreground window handle
3. (Mode B) Simulate `Ctrl+C` to read selected text into clipboard
4. Run STT / LLM processing
5. Verify focus window hasn't changed
6. Write result to clipboard, simulate `Ctrl+V`
7. Restore original clipboard content

## MVP Scope (v1.0)

All three modes, Output Preview Window, Whisper STT with streaming, OpenAI LLM, clipboard-based text injection, focus locking, undo hotkey, LLM output mode toggle (direct vs. preview+stream), basic settings UI, and incognito mode.

## v2.0 Planned (out of scope now)

Local offline LLM, professional vocabulary import, app context awareness (auto-adjust LLM tone by foreground app), habit auto-memory, custom Quick Action presets, keyboard typing prediction, TTS narration, multi-STT model switching.
