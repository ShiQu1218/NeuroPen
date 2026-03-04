> English | **[繁體中文](./README.zh-TW.md)**

<h1 align="center">TalkFlow</h1>

<p align="center">
  <strong>Windows Desktop AI Voice Assistant</strong><br/>
  Voice input, translate, summarize, rewrite, and ask AI — in any app, with a single hotkey. No window switching needed.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows" alt="Windows" />
  <img src="https://img.shields.io/badge/Framework-Tauri%20v2-FFC131?logo=tauri" alt="Tauri" />
  <img src="https://img.shields.io/badge/Frontend-React%2019%20%2B%20TypeScript-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/Backend-Rust-DEA584?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT" />
</p>

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [UI Components](#ui-components)
- [Supported Models](#supported-models)
- [Getting Started (Users)](#getting-started-users)
- [Getting Started (Developers)](#getting-started-developers)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [CI/CD & Release](#cicd--release)
- [Troubleshooting](#troubleshooting)
- [Security & Privacy](#security--privacy)
- [License](#license)

---

## Features

| Feature | Description |
|---------|-------------|
| **Global Voice Input** | Press `Alt + Backtick` in any app to convert speech to text, inserted directly at the cursor |
| **Quick Action on Selection** | Select text and a floating icon appears — one-click translate, summarize, rewrite, or fix grammar |
| **Voice Command on Selection** | Select text + hotkey + speak your instruction — AI processes it automatically |
| **LLM Q&A** | Say the wake word (default: "assistant") without selecting text to ask AI anything |
| **Streaming Preview Window** | LLM responses stream token-by-token; follow up, copy, replace, or dismiss |
| **Direct Injection Mode** | Optionally skip preview — LLM results paste directly into the input field |
| **One-Key Undo** | `Alt + Z` reverts the last text injection |
| **Local STT** | Built-in Whisper (small/medium/large/turbo) for fully offline speech recognition |
| **Multi-LLM Providers** | OpenAI, Gemini, Claude, Grok, Qwen, Doubao, DeepSeek, Ollama |
| **10 UI Languages** | zh-TW, zh-CN, English, Japanese, German, French, Arabic, Russian, Spanish, Korean |
| **Incognito Mode** | Disable all LLM calls with one click — local STT only |
| **System Tray** | Runs in the background; right-click tray icon to open settings or exit |

---

## How It Works

TalkFlow automatically routes to one of four modes based on whether text is selected and whether a wake word is spoken:

```
                         +----------------+
                         | Alt + Backtick |
                         |  (Global Key)  |
                         +-------+--------+
                                 |
                    +------------+------------+
                    |                         |
              Text selected?            No selection
                    |                         |
            +-------+-------+       +---------+---------+
            |               |       |                   |
        Via mouse       Via voice   Wake word         No wake word
       Quick Action      hotkey     detected           detected
            |               |       |                   |
            v               v       v                   v
     +----------+   +----------+ +----------+   +----------+
     | Mode B1  |   | Mode B2  | | Mode C   |   | Mode A   |
     | Quick    |   | Voice    | | LLM Q&A  |   | Voice    |
     | Action   |   | Command  | |          |   | Input    |
     +----+-----+   +----+-----+ +----+-----+   +----+-----+
          |              |            |               |
          v              v            v               v
     +-------------------------+  +-----------------+
     |   Output Preview Window |  |  Direct inject  |
     |   (stream / copy /      |  |  into focused   |
     |    replace / follow-up) |  |  input field    |
     +-------------------------+  +-----------------+
```

### Mode A — Direct Voice Input
> **Scenario**: You're typing and want to use voice instead of the keyboard.
> **Usage**: Hold the hotkey, speak, release — text appears at the cursor.

### Mode B1 — Quick Action on Selection
> **Scenario**: You selected some English text and want to translate it.
> **Usage**: Select text, click "Translate" on the floating icon, preview window shows the result, click "Replace" to swap the original text.

### Mode B2 — Voice Command on Selection
> **Scenario**: You selected some text and want to tell AI how to modify it.
> **Usage**: Select text, press hotkey, say "make this more formal" — preview window shows the result.

### Mode C — LLM Q&A
> **Scenario**: You want to ask AI a question.
> **Usage**: Press hotkey, say "assistant, what's the weather in Taipei tomorrow" — preview window shows the answer.

---

## Architecture

```
+----------------------------------------------------------------------+
|                        TalkFlow Application                           |
|                                                                       |
|  +------------------------------------------------------------------+|
|  |                    Frontend (React + TypeScript)                   ||
|  |                                                                    ||
|  |  +----------+  +---------------+  +----------+  +-----------+    ||
|  |  | Settings |  | Quick Action  |  | Preview  |  | Recording |    ||
|  |  | Window   |  | Icon + Panel  |  | Window   |  | Indicator |    ||
|  |  +----------+  +---------------+  +----------+  +-----------+    ||
|  |                                                                    ||
|  |  +----------------------+  +----------------------------------+  ||
|  |  | Zustand State Store  |  | i18n (10 Languages)              |  ||
|  |  +----------------------+  +----------------------------------+  ||
|  +----------------------------+--------------------------------------+|
|                               | Tauri IPC (invoke / event)            |
|  +----------------------------+--------------------------------------+|
|  |                      Backend (Rust / Tauri v2)                     ||
|  |                                                                    ||
|  |  +-------------+  +--------------+  +------------------------+   ||
|  |  | hotkey.rs   |  | mode_router  |  | selection.rs           |   ||
|  |  | Global Key  |->| Mode Router  |<-| UI Automation detect   |   ||
|  |  +-------------+  +------+-------+  +------------------------+   ||
|  |                          |                                         ||
|  |           +--------------+--------------+                         ||
|  |           v              v              v                         ||
|  |  +--------------+ +-----------+ +--------------+                  ||
|  |  | audio_capture| | stt.rs    | | llm.rs       |                  ||
|  |  | Mic capture  |->| STT      |->| LLM API call|                  ||
|  |  +--------------+ +-----------+ +------+-------+                  ||
|  |                                        |                           ||
|  |           +----------------------------+                           ||
|  |           v                            v                           ||
|  |  +------------------+  +------------------------------+           ||
|  |  | clipboard.rs     |  | injection.rs                 |           ||
|  |  | Cache / restore  |->| Text inject (Ctrl+V sim)     |           ||
|  |  +------------------+  +------------------------------+           ||
|  |                                                                    ||
|  |  +------------------+  +------------------------------+           ||
|  |  | window_focus.rs  |  | undo.rs                      |           ||
|  |  | Focus lock       |  | Undo last injection (Alt+Z)  |           ||
|  |  +------------------+  +------------------------------+           ||
|  +--------------------------------------------------------------------+|
|                                                                       |
+-----------------------------------------------------------------------+
                               |
              +----------------+----------------+
              v                v                v
     +----------------+ +-----------+ +-----------------+
     | Windows APIs   | | Cloud AI  | | Local Models    |
     |                | |           | |                 |
     | - UI Automation| | - OpenAI  | | - Whisper.cpp   |
     | - GetForeground| | - Gemini  | |   (small/medium/|
     |   Window       | | - Claude  | |    large/turbo) |
     | - Clipboard    | | - Grok    | | - Ollama        |
     | - SendInput    | | - Qwen    | |                 |
     |                | | - Doubao  | |                 |
     |                | | - DeepSeek| |                 |
     +----------------+ +-----------+ +-----------------+
```

### Text Injection Flow

```
 1. Hotkey triggered
    |
    v
 2. Cache clipboard contents ---------------------------------+
    |                                                          |
    v                                                          |
 3. Lock foreground window (GetForegroundWindow)               |
    |                                                          |
    v                                                          |
 4. [Mode B] Simulate Ctrl+C to read selection                 |
    |                                                          |
    v                                                          |
 5. STT recognition / LLM processing                          |
    |                                                          |
    v                                                          |
 6. Verify focus window unchanged                              |
    |     |                                                    |
    |    Focus changed -> Cancel injection, show warning        |
    |                                                          |
    v                                                          |
 7. Write result to clipboard -> Simulate Ctrl+V               |
    |                                                          |
    v                                                          |
 8. Restore original clipboard <-------------------------------+
```

---

## UI Components

### Settings Window
Left sidebar with category navigation (General, Voice & STT, Quick Actions, LLM, Privacy). Right side scrollable content area. Fixed "Cancel / Save" buttons at the bottom.

### Quick Action Icon
A floating icon that fades in when text is selected. Hover to expand the panel:
- Preset commands (Translate to English, Translate to Japanese, Summarize, Fix grammar, Formalize)
- Custom input field (type any instruction and submit)
- Users can customize the command list in settings

### Output Preview Window

```
+------------------------------------------+
|  LLM output (streaming / scrollable)      |
|                                           |
|  The quick brown fox jumps over the...    |
|                                           |
+-------------------------------------------+
|  [Follow-up: make it shorter...]  [Send]  |
+-------------------------------------------+
|        [Copy]    [Replace]    [Close]      |
+-------------------------------------------+
```

- **Copy**: Copy result to clipboard
- **Replace**: Replace original selected text (Mode B) or inject at cursor (Mode C)
- **Close**: Discard result, original text unchanged
- **Follow-up**: Add instructions on current result, LLM responds with context

### Recording Indicator
A floating indicator at the bottom center of the screen showing recording status and elapsed time.

---

## Supported Models

### LLM Providers

| Provider | Type | Notes |
|----------|------|-------|
| OpenAI | Cloud | GPT-4o, GPT-4, GPT-3.5, etc. |
| Gemini | Cloud | Google Gemini series |
| Claude | Cloud | Anthropic Claude series |
| Grok | Cloud | xAI Grok series |
| Qwen | Cloud | Alibaba Tongyi Qianwen |
| Doubao | Cloud | ByteDance Doubao |
| DeepSeek | Cloud | DeepSeek series |
| Ollama | Local | Self-hosted, default `http://127.0.0.1:11434` |

### STT Engines

| Engine | Type | Notes |
|--------|------|-------|
| OpenAI Whisper API | Cloud | Requires API Key |
| Local Whisper | Local | Via whisper-rs / whisper.cpp, supports CPU and GPU (Vulkan) |

### Local Whisper Models

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| Whisper Small | ~461 MB | Fast | Good |
| Whisper Medium | ~1.5 GB | Medium | Better |
| Whisper Large | ~2.9 GB | Slow | Best |
| Whisper Turbo | ~1.5 GB | Fast | Better |

---

## Getting Started (Users)

### System Requirements

- **OS**: Windows 10 (1809+) / Windows 11
- Microphone
- (Cloud mode) Internet connection + API Key
- (Local STT) 8 GB+ RAM recommended; Vulkan-capable GPU for acceleration (see compatibility table below), falls back to CPU otherwise

### GPU Acceleration

Local Whisper STT uses [Vulkan](https://www.vulkan.org/) for GPU acceleration — **no additional drivers or DLLs required**. As long as your GPU driver supports Vulkan, it works. If GPU initialization fails, it typically falls back to CPU automatically.

| GPU Vendor | Supported GPUs | Notes |
|------------|---------------|-------|
| **NVIDIA** | GeForce GTX 600 series and above (Kepler+) | Driver 496.76+ recommended |
| **AMD** | Radeon HD 7700 series and above (GCN 1.0+) | Radeon Software Adrenalin driver |
| **Intel** | HD Graphics 520/530 and above (Skylake Gen9+) / Arc series | Integrated GPUs supported |

> **No dedicated GPU?** Most Intel integrated GPUs from 2016 onwards support Vulkan and can still accelerate STT. If Vulkan is completely unsupported, it typically falls back to CPU.

### Installation

1. Go to the [Releases](../../releases) page and download the latest `.exe` installer
2. Run the installer (NSIS)
3. Launch TalkFlow — it will reside in the system tray

### First-Time Setup

1. Right-click the system tray icon -> **Settings**
2. **General**: Set display language, global hotkey, wake word
3. **LLM**: Choose a provider, enter your API Key (e.g., OpenAI)
4. **Voice & STT**: Choose STT engine (cloud or local), install a local model (optional)
5. Click "Save" and you're ready to go

### Quick Usage

| What you want to do | How to do it |
|---------------------|--------------|
| Voice typing | Press `Alt + Backtick` in any input field, speak, release |
| Translate selection | Select text, click floating icon, choose "Translate to English" |
| Voice rewrite | Select text, press hotkey, say "make this more formal" |
| Ask AI | Press hotkey, say "assistant, list 3 tips for writing reports" |
| Undo | `Alt + Z` to revert the last text injection |

---

## Getting Started (Developers)

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) toolchain (stable)
- Windows 10/11
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- (GPU build) [Vulkan SDK](https://vulkan.lunarg.com/sdk/home) — only required when building with `local-stt-gpu`

### Install & Run

```bash
# Clone the repository
git clone https://github.com/your-username/TalkFlow.git
cd TalkFlow

# Install frontend dependencies
npm install

# Run in development mode (with hot-reload)
npm run tauri dev
```

### Build

Three build modes are available:

| Mode | Command | Description |
|------|---------|-------------|
| No local STT | `npm run tauri build` | Smallest package, cloud STT only |
| Local STT (CPU) | `npm run tauri build -- --features local-stt` | Local Whisper, CPU only |
| Local STT + GPU | `npm run tauri build -- --features local-stt-gpu` | Local Whisper + Vulkan GPU acceleration (recommended, includes `local-stt`) |

#### GPU Build Steps (`local-stt-gpu`)

1. **Install Vulkan SDK**

   Download and install from [vulkan.lunarg.com](https://vulkan.lunarg.com/sdk/home).

2. **Set environment variable**

   ```powershell
   # PowerShell (permanent, requires admin)
   # Replace the version number with your installed version (e.g., 1.4.341.1)
   setx VULKAN_SDK "C:\VulkanSDK\<YOUR_VERSION>" /M
   ```

   **Restart your terminal** after setting the variable.

3. **Build**

   ```powershell
   npm run tauri build -- --features local-stt-gpu
   ```

4. **(Optional) If you encounter a path-too-long error**

   Windows has a default 260-character path limit. Two solutions:

   - **Option A**: Enable long path support (requires admin + reboot)
     ```powershell
     reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f
     ```

   - **Option B**: Use `subst` to map a shorter path (no reboot needed)
     ```powershell
     # Replace with your actual project path (must be ASCII)
     subst T: "C:\Users\YourUsername\path\to\TalkFlow"
     cd T:\
     npm run tauri build -- --features local-stt-gpu
     ```

Build output:
- Executable: `src-tauri/target/release/talkflow.exe`
- Installer (NSIS): `src-tauri/target/release/bundle/nsis/`

### Key Technologies

| Layer | Technology |
|-------|-----------|
| Desktop Framework | Tauri v2 |
| Frontend | React 19, TypeScript, Vite 7, TailwindCSS, Zustand |
| Backend | Rust, Tokio (async runtime) |
| Audio Capture | cpal |
| Local STT | whisper-rs (whisper.cpp bindings) |
| HTTP Client | reqwest (streaming support) |
| Windows Integration | windows crate (UI Automation, SendInput, Clipboard) |
| Credential Storage | keyring (Windows Credential Manager) |

---

## Project Structure

```
TalkFlow/
├── src/                          # Frontend (React + TypeScript)
│   ├── App.tsx                   #   Main app entry & window router
│   ├── App.css                   #   Global styles
│   ├── main.tsx                  #   React DOM mount
│   ├── i18n.ts                   #   Internationalization (10 languages)
│   ├── components/
│   │   ├── Settings.tsx          #   Settings window UI
│   │   ├── QuickActionIcon.tsx   #   Floating quick action widget
│   │   ├── PreviewWindow.tsx     #   LLM output preview window
│   │   └── RecordingIndicator.tsx#   Recording status overlay
│   ├── store/
│   │   └── useAppStore.ts        #   Zustand global state
│   └── utils/
│       └── windowBounds.ts       #   Window positioning helpers
│
├── src-tauri/                    # Backend (Rust)
│   ├── src/
│   │   ├── main.rs               #   Application entry point
│   │   ├── lib.rs                #   Tauri setup & plugin registration
│   │   ├── mode_router.rs        #   Mode A/B1/B2/C routing logic
│   │   ├── hotkey.rs             #   Global hotkey listener
│   │   ├── selection.rs          #   UI Automation text selection detection
│   │   ├── window_focus.rs       #   Foreground window lock & verification
│   │   ├── audio_capture.rs      #   Microphone audio capture (cpal)
│   │   ├── stt.rs                #   Speech-to-text (cloud & local Whisper)
│   │   ├── llm.rs                #   LLM API calls (streaming)
│   │   ├── clipboard.rs          #   Clipboard cache / restore
│   │   ├── injection.rs          #   Text injection via Ctrl+V simulation
│   │   └── undo.rs               #   Undo last injection (Alt+Z)
│   └── Cargo.toml                #   Rust dependencies & feature flags
│
├── public/                       # Static assets
├── .github/workflows/
│   └── release.yml               # CI/CD: auto-build on tag push
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

---

## Configuration

| Category | Options |
|----------|---------|
| **General** | Display language, LLM output language, global hotkey, wake word, launch at startup |
| **Voice & STT** | STT engine selection, local model management (install/delete/switch), microphone source, STT output strategy (pure STT / LLM polish), smart punctuation, vocabulary import, foreground app context awareness |
| **Quick Actions** | Add, edit, delete Quick Action commands |
| **LLM** | Output mode (streaming preview / direct injection), Provider, Model, API Key, multimodal toggle |
| **Privacy** | Incognito mode (disable all LLM calls, local STT only) |

---

## Versioning

Version numbers are managed centrally via `npm version`, auto-synced to all config files:

```bash
npm version patch   # 0.1.1 -> 0.1.2
npm version minor   # 0.1.1 -> 0.2.0
npm version major   # 0.1.1 -> 1.0.0
```

This automatically:
1. Updates `package.json` version
2. Syncs to `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
3. Creates a git commit and git tag (e.g., `v0.1.2`)

> **Sync script**: `scripts/sync-version.js`, triggered automatically by the `"version"` hook in `package.json`.

---

## CI/CD & Release

This project uses GitHub Actions for automated builds. Pushing a `v*` tag triggers the workflow:

```bash
# Bump version and push tag to trigger auto-build
npm version patch
git push origin main --tags
```

After CI completes, a Draft Release with the installer will appear on the **Releases** page.

> **Note**: Cloud CI builds with `local-stt` (CPU only) by default. For GPU acceleration, use the `local-stt-gpu` feature (Vulkan backend, typically falls back to CPU when GPU is unavailable).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| UI unchanged after update | Make sure you're running `src-tauri/target/release/talkflow.exe`, or reinstall via the NSIS package |
| Local Whisper shows as disabled | Rebuild with `--features local-stt` or `--features local-stt-gpu` |
| Ollama won't connect | Ensure Ollama is running and `localhost:11434` is accessible; model name must match an installed model |
| Replace failed / focus error | TalkFlow only injects into the window that was focused at hotkey trigger time; if focus changes during processing, it cancels and warns |
| Quick Action icon not appearing | Some apps (games, custom-drawn UIs) don't support UI Automation API — use Mode B2 voice path instead |
| Simulated input blocked | Some Electron apps / games block Ctrl+V simulation — paste manually |

---

## Security & Privacy

- **Focus verification**: Confirms the target window hasn't changed before injection, preventing input to unintended locations
- **Clipboard protection**: Caches before operations and restores after — users never lose clipboard content
- **Incognito mode**: Disable all cloud LLM calls with one click, local STT only
- **Secure storage**: API Keys stored encrypted via Windows Credential Manager (keyring)
- **No background uploads**: All AI calls only happen when explicitly triggered by the user

---

## License

This project is licensed under the [MIT License](./LICENSE).
