> English | **[繁體中文](./README.zh-TW.md)**

<p align="center">
  <img src="./public/brand-icon.svg" alt="NeuroPen icon" width="160" />
</p>

<h1 align="center">NeuroPen</h1>

<p align="center">
  <strong>Voice-first AI for any Windows app</strong><br/>
  Hold one hotkey to dictate, rewrite selected text, or ask about a screenshot without breaking focus or switching windows.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows" alt="Windows" />
  <img src="https://img.shields.io/badge/Framework-Tauri%20v2-FFC131?logo=tauri" alt="Tauri" />
  <img src="https://img.shields.io/badge/Frontend-React%2019%20%2B%20TypeScript-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/Backend-Rust-DEA584?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT" />
</p>

<p align="center">
  <img src="./assets/demo/mode_B1.gif" alt="NeuroPen quick action demo" width="920" />
</p>

---

## Table of Contents

- [Why NeuroPen](#why-neuropen)
- [Common Use Cases](#common-use-cases)
- [Features](#features)
- [Workflows](#workflows)
- [Core Workflow Safeguards](#core-workflow-safeguards)
- [UI Modules](#ui-modules)
- [Supported Models](#supported-models)
- [Getting Started (Users)](#getting-started-users)
- [Getting Started (Developers)](#getting-started-developers)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Community & Roadmap](#community--roadmap)
- [CI/CD & Release](#cicd--release)
- [Troubleshooting](#troubleshooting)
- [Security & Privacy](#security--privacy)
- [License](#license)

---

## Why NeuroPen

Most AI tools start by asking you to open a tab, paste text, and manage context manually. NeuroPen is built for the opposite workflow: stay inside the app you are already using, trigger AI with a hotkey, and keep moving.

| What usually slows people down | What NeuroPen changes |
|------|--------------------|
| Switching between your editor, browser, chat app, and AI tab | Works in any focused Windows app with a global hotkey |
| Copying text out, prompting, then pasting it back | Can rewrite selected text or inject output back into the original target |
| Losing momentum on short writing tasks | Handles quick dictation, translation, summarizing, polishing, and follow-up questions from one flow |
| Worrying about pasting into the wrong place | Verifies target focus before injection and restores the clipboard after the workflow |

---

## Common Use Cases

| Use case | How it feels |
|------|--------------|
| **Dictate anywhere** | Hold `Alt + Backtick`, speak in Notion, Word, chat apps, or browser inputs, then release to transcribe |
| **Rewrite selected text** | Highlight a paragraph and run a Quick Action or speak an instruction like "make this more concise" |
| **Translate without tab switching** | Select text in any app and convert it to your target language from the floating action surface |
| **Ask about what is on screen** | Press `Alt + S`, capture a region, and send the screenshot into a multimodal preview session |
| **Keep app-specific behavior** | Use App Profiles so different apps can get different tone, language, output mode, and direct-paste behavior |

---

## Features

| Capability | Why it matters |
|------|----------------|
| **Global voice capture** | Start speaking from any app with `Alt + Backtick` instead of opening a separate AI window |
| **Selection-aware routing** | NeuroPen detects whether you are dictating, transforming selected text, or asking the assistant |
| **Quick Action surface** | Selected text gets a floating action entry point with customizable preset commands |
| **Selection Voice Command** | Speak an instruction over highlighted text for rewriting, translating, summarizing, or polishing |
| **Assistant chat** | Wake-word detection turns free speech into an assistant request with streaming responses |
| **Preview-first or direct injection** | Review output in `PreviewStream` or send it straight back into the focused target app |
| **Focus-safe injection + undo** | Verifies focus before paste and supports one-step rollback with `Alt + Z` |
| **Screenshot-to-LLM** | `Alt + S` captures a region and opens a multimodal prompt flow in the preview window |
| **Cloud and local models** | Supports OpenAI Whisper API plus local Whisper, SenseVoice, Moonshine, Ollama, llama.cpp, and LM Studio |
| **Model management** | Install, switch, cancel, and delete supported local STT and Piper TTS models inside the app |
| **App Profiles** | Apply per-app tone, prompt appendix, language variant, output mode, and direct-paste defaults |
| **History and tray workflow** | Keep a local history, launch from tray, and stay available in the background |

---

## Workflows

| Workflow | Trigger | What you get |
|------|---------|---------------|
| **Voice Input** | No selection + `Alt + Backtick` + no wake word | Speech-to-text result, optionally refined or translated, then shown in preview or injected at the cursor |
| **Quick Action** | Text selected + Quick Action click | A fast selected-text transformation in the preview window |
| **Selection Voice Command** | Text selected + `Alt + Backtick` + spoken instruction | LLM rewrite of the selected text based on your spoken instruction |
| **Assistant Chat** | No selection + wake word detected in transcript | Assistant response in preview or direct injection, depending on settings |
| **Screenshot Prompt** | `Alt + S` + captured region + prompt | A multimodal preview session that uses the captured image as context |

### Workflow Demos

**Voice Input: speak and keep typing**
![Voice Input Demo](./assets/demo/mode_A.jpg)

**Quick Action: transform selected text without copy/paste**
![Quick Action Demo](./assets/demo/mode_B1.gif)

**Selection Voice Command: talk over selected content**
![Selection Voice Command Demo](./assets/demo/mode_B2.gif)

## Core Workflow Safeguards

NeuroPen is designed for "works in any app" workflows, so output safety matters as much as model quality. Before text goes back into another application, the app uses a strict injection sequence:

1. Lock foreground window and cache clipboard.
2. Process STT/LLM request.
3. Verify target focus is unchanged.
4. Inject result and restore clipboard.

If focus changes during processing, injection is cancelled and the clipboard is restored instead of risking edits in the wrong place.

---

## UI Modules

- **Settings Window**: Configure STT, LLM, TTS, quick actions, hotkeys, history, and per-app defaults.
- **Quick Action Icon**: Floating selected-text surface for one-click presets and custom instructions.
- **Output Preview Window**: Streaming output with follow-up prompts, copy/replace controls, and screenshot attachment preview.
- **Recording Indicator**: Lightweight overlay that confirms recording state and elapsed time.
- **History Panel**: Search, copy, and delete prior local outputs.
- **Screenshot Overlay**: Region capture surface for screenshot-backed prompting.
- **App Profiles**: Priority-ordered rules that adapt tone, prompt appendix, language, and output behavior by app.

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
| llama.cpp | Local | OpenAI-compatible local server, default `http://127.0.0.1:8080/v1/chat/completions` |
| LM Studio | Local | OpenAI-compatible local server, default `http://127.0.0.1:1234/v1/chat/completions` |

### llama.cpp Setup

NeuroPen can connect to a local `llama.cpp` server through its OpenAI-compatible API.

1. Install a Windows CUDA build of `llama.cpp` and start `llama-server`
2. Load a GGUF model on port `8080`
3. In NeuroPen Settings -> `LLM`, choose `llama.cpp (Local)`
4. Set the model field to the model alias currently loaded by `llama-server`

Example:

```powershell
cd C:\llama.cpp
.\llama-server.exe -m "C:\path\to\model.gguf" --port 8080 -ngl 99
```

Notes:

- NeuroPen expects the server at `http://127.0.0.1:8080/v1/chat/completions` by default
- `llama.cpp` does not require an API key in NeuroPen
- If you start `llama-server` with `-hf ...`, the downloaded GGUF model is typically cached under `%LOCALAPPDATA%\llama.cpp`

### LM Studio Setup

NeuroPen can also connect to the local LM Studio server through its OpenAI-compatible API.

1. Open LM Studio and click `Load Model` for the model you want to serve
2. After the model finishes loading, open the `Developer` tab and turn on the local server
3. Keep the server port on `1234`, because NeuroPen currently expects `http://127.0.0.1:1234/v1/chat/completions`
4. Verify the server is up by opening `http://127.0.0.1:1234/v1/models` in a browser or by running:

```powershell
Invoke-RestMethod http://127.0.0.1:1234/v1/models
```

5. In NeuroPen Settings -> `LLM`, choose `LM Studio (Local)`
6. Set the NeuroPen `Model` field to the `id` returned by `/v1/models`

Notes:

- NeuroPen expects LM Studio at `http://127.0.0.1:1234/v1/chat/completions` by default
- LM Studio does not require an API key in NeuroPen unless you enabled local server auth
- If you enable LM Studio auth, NeuroPen will send the saved API key as a bearer token
- If `Invoke-RestMethod` says the connection was refused, the LM Studio local server is not running yet even if the model is already loaded

### STT Engines

| Engine | Type | Notes |
|--------|------|-------|
| OpenAI Whisper API | Cloud | Requires API Key |
| Local Whisper | Local | Via whisper-rs / whisper.cpp, supports CPU and GPU (Vulkan) |
| SenseVoice | Local | Bundled local STT option for zh/en/ja/ko/yue speech recognition |
| Moonshine | Local | Lightweight English local STT models optimized for speed |

### Local Whisper Models

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| Whisper Small | ~461 MB | Fast | Good |
| Whisper Medium | ~1.5 GB | Medium | Better |
| Whisper Large | ~2.9 GB | Slow | Best |
| Whisper Turbo | ~1.5 GB | Fast | Better |

### Additional Local STT Models

| Model | Engine | Language coverage | Packaging | Notes |
|-------|--------|-------------------|-----------|-------|
| SenseVoice Small | SenseVoice | Chinese, English, Japanese, Korean, Cantonese | Multi-file bundle | Strong multilingual local option outside Whisper |
| Moonshine Base | Moonshine | English | Multi-file bundle | Fast and lightweight |
| Moonshine Tiny | Moonshine | English | Multi-file bundle | Smallest local STT option, favors speed over accuracy |

Local STT notes:

- NeuroPen's STT model manager can install, cancel, delete, and switch among local models.
- Only installed local models appear in the STT model dropdown.
- STT language selection supports `auto`, `en`, `zh`, `ja`, `ko`, `de`, `fr`, `es`, `ru`, and `ar`; effective language coverage still depends on the selected local model.

### TTS

| Engine | Notes |
|--------|-------|
| Piper TTS | Local playback with configurable model path, speed, and speaker id |

### Built-in Piper Voices

| Voice | Language | Quality | Speakers | Notes |
|-------|----------|---------|----------|-------|
| Huayan | zh-CN | medium | 1 | Default Chinese voice for Traditional and Simplified Chinese |
| Lessac | en-US | medium | 1 | Natural English assistant voice |
| Thorsten | de-DE | medium | 1 | German male voice |
| Siwis | fr-FR | medium | 1 | French single-speaker voice |
| Sharvard | es-ES | medium | 2 | Spanish voice with speaker switching via Speaker ID |
| Irina | ru-RU | medium | 1 | Russian single-speaker voice |
| Kareem | ar-SA | medium | 1 | Arabic single-speaker voice |

Piper TTS notes:

- The built-in TTS model manager supports install, cancel, delete, and "Set Active" switching.
- Manual model path remains available for custom `.onnx` voices.
- Speaker ID is mainly used for multi-speaker voices such as Sharvard.

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
3. Launch NeuroPen — it will reside in the system tray

### First-Time Setup

1. Right-click the system tray icon -> **Settings**
2. **General**: Set display language, global hotkey, wake word
3. **LLM**: Choose a provider, manage saved model list, set preferred output language, enter your API Key (e.g., OpenAI)
4. **Voice & STT**: Choose the STT model, select microphone source, and optionally install or switch a local STT model
5. **TTS**: Optionally install a Piper voice, set it active, or keep a manual `.onnx` path
6. Click "Save" and you're ready to go

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

- [Node.js](https://nodejs.org/) 24.14.0 (`.nvmrc`, npm 11.9.0)
- [Rust](https://www.rust-lang.org/) 1.93.1 (`rust-toolchain.toml`)
- Windows 10/11
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- (GPU build) [Vulkan SDK](https://vulkan.lunarg.com/sdk/home) — only required when building with `local-stt-gpu`

### Install & Run

```bash
# Clone the repository
git clone https://github.com/your-username/NeuroPen.git
cd NeuroPen

# Verify your local toolchain matches the repo
npm run doctor

# Install frontend dependencies from the lockfile
npm ci

# Run in development mode (with hot-reload)
npm run tauri dev
```

### Environment Consistency

- Node is pinned via `.nvmrc`, and npm is pinned via the `packageManager` field in `package.json`
- Rust is pinned via `rust-toolchain.toml`
- Run `npm run doctor` before development or CI changes
- Run `npm run doctor:gpu` before GPU-enabled builds to verify `VULKAN_SDK`

### Recommended Workflows

#### 1. Daily development

Use this for normal feature work. No signing key is needed.

```powershell
npm run doctor
npm ci
npm run tauri dev
```

#### 2. Local test build (cloud / no local STT)

Use this when you want a quick local executable for manual testing without signing.

```powershell
npm run doctor
npm run build:exe
```

#### 3. Local CPU build (local STT without Vulkan)

Use this when you want a local executable with Whisper support but do not need GPU acceleration.

```powershell
npm run doctor
npm run build:exe:local-stt
```

#### 4. Local GPU build (local STT with Vulkan)

Use this when you want a local executable with Whisper + Vulkan acceleration. `VULKAN_SDK` must be configured, but signing keys are still not part of the normal local workflow.

```powershell
npm run doctor:gpu
npm run build:exe:gpu
```

These scripts use `tauri build --no-bundle` and default `CARGO_TARGET_DIR` to `C:\np-target`, so the app gets the built frontend assets and still avoids the `can't find crate` failure you hit from the full desktop path.

If your machine still hits a Windows path-too-long issue, use `subst` as a fallback:

```powershell
subst T: "C:\Users\YourUsername\path\to\NeuroPen"
cd T:\
npm run doctor:gpu
npm run build:exe:gpu
```

After the build finishes, launch:

```powershell
C:\np-target\release\neuropen.exe
```

You can keep using that exe across reboots. Rebuild only when you want a newer test build.

#### 5. Signed release build

Use this only for official installer/updater artifacts. The signing key and password should never be committed to the repository. Prefer GitHub Actions secrets for this workflow.

- CI release: push a `v*` tag and let [release.yml](./.github/workflows/release.yml) read `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from GitHub secrets
- Local signed release from the project directory: export both variables in the current shell session, then run `npm run build:bundle`, `npm run build:bundle:local-stt`, or `npm run build:bundle:gpu`
- Do not set those variables to empty strings; empty values are not valid signing credentials
- These bundle scripts also set `CARGO_TARGET_DIR` to `C:\np-target`, so they avoid the `can't find crate` failure seen when running `npm run tauri build -- --features ...` directly from the full desktop path
- `npm run tauri build` creates the NSIS installer and updater artifacts, so it requires valid signing credentials in this repository configuration

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
   # PowerShell (permanent for the current user)
   # Replace the version number with your installed version (e.g., 1.4.341.1)
   setx VULKAN_SDK "C:\VulkanSDK\<YOUR_VERSION>"
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
     subst T: "C:\Users\YourUsername\path\to\NeuroPen"
     cd T:\
     npm run tauri build -- --features local-stt-gpu
     ```

Build output:
- Executable: `src-tauri/target/release/neuropen.exe`
- Installer (NSIS): `src-tauri/target/release/bundle/nsis/`

### Output Types

- Local executable only: use `npm run build:exe`, `npm run build:exe:local-stt`, or `npm run build:exe:gpu`, then run `C:\np-target\release\neuropen.exe`
- Signed installer/updater bundle: use `npm run build:bundle`, `npm run build:bundle:local-stt`, or `npm run build:bundle:gpu`

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

### Modularization Status

- **Frontend**: IPC calls are centralized into `src/services/*`, and major `useMainWindowController` event flows are split into `src/hooks/mainWindow/*`.
- **Frontend orchestration**: shared controller/bootstrap logic and STT final-routing helpers now live in `src/hooks/mainWindow/controllerHelpers.ts` and `src/hooks/mainWindow/sttFinalRouterHelpers.ts`, keeping the main hooks smaller without changing behavior.
- **i18n**: `src/i18n/messages.ts` is now an aggregator, with domain dictionaries split into `src/i18n/messages/{settings,preview,history,common}.ts`.
- **Store**: `useAppStore` types and defaults were extracted to `appStoreTypes.ts` and `appStoreDefaults.ts` while preserving existing exports.
- **Runtime safety**: recent cleanup also tightened session reset coverage, clipboard failure restoration, and panic-prone history state handling to reduce stale UI state and hidden failure paths.
- **Rust backend**: command implementations are grouped under `src-tauri/src/commands/*`, and STT/LLM helpers have been moved into focused submodules.

---

## Project Structure

```
NeuroPen/
├── src/                                  # Frontend (React + TypeScript)
│   ├── App.tsx                           #   Main app entry & window router
│   ├── i18n.ts                           #   i18n public API (translate/useI18n)
│   ├── hooks/
│   │   ├── useMainWindowController.ts    #   Main orchestrator hook
│   │   └── mainWindow/                   #   Listener + orchestration helpers
│   │       ├── controllerHelpers.ts
│   │       ├── sttFinalRouterHelpers.ts
│   │       └── ...                       #   selection/screenshot/STT route modules
│   ├── services/                         #   IPC service layer (Tauri command wrappers)
│   ├── i18n/
│   │   ├── catalog.ts
│   │   ├── messages.ts                   #   Aggregator
│   │   ├── localeOverrides.ts
│   │   └── messages/                     #   Domain dictionaries
│   │       ├── settings.ts
│   │       ├── preview.ts
│   │       ├── history.ts
│   │       └── common.ts
│   ├── store/
│   │   ├── useAppStore.ts
│   │   ├── appStoreTypes.ts
│   │   └── appStoreDefaults.ts
│   ├── components/
│   │   ├── Settings.tsx
│   │   └── settings/
│   └── utils/
│
├── src-tauri/                            # Backend (Rust)
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs                        #   Tauri app assembly & command registration
│   │   ├── commands/                     #   Grouped command handlers
│   │   ├── stt.rs
│   │   ├── stt/                          #   STT submodules (models/api_keys)
│   │   ├── llm.rs
│   │   └── llm/                          #   LLM helper submodules (formatting)
│   └── Cargo.toml
│
├── public/                               # Static assets
├── .github/workflows/
│   ├── validate.yml                      # CI validation on push and pull request
│   └── release.yml                       # Draft release build on tag push
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

---

## Configuration

| Category | Options |
|----------|---------|
| **General** | Display language, global hotkey, wake word, launch at startup |
| **Voice & STT** | STT engine selection, local model management (install/delete/switch), microphone source, STT output strategy (pure STT / LLM polish), smart punctuation, vocabulary import |
| **Quick Actions** | Add, edit, delete Quick Action commands |
| **LLM** | Output mode (streaming preview / direct injection), Provider, saved model list, Model, preferred output language, API Key, multimodal toggle |
| **App Profiles** | Keyword-based per-app profiles (e.g. Notion, VS Code, LINE): tone hint, prompt appendix, language override, output mode override, direct paste — ordered by priority, first match wins |

---

## Community & Roadmap

- Start with [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, OpenSpec workflow, and validation expectations.
- Project conduct expectations live in [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- Current public priorities live in [ROADMAP.md](./ROADMAP.md).
- Ongoing release notes now start in [CHANGELOG.md](./CHANGELOG.md).
- GitHub issue and PR flows are guided by the repository templates under [`.github/ISSUE_TEMPLATE`](./.github/ISSUE_TEMPLATE) and [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md).

NeuroPen is currently maintained as an actively iterated Windows-first project. Small, focused pull requests are preferred. For larger behavior changes or architectural work, open an issue first so the affected OpenSpec capability and review scope are clear.

Maintainers aim to triage new issues and pull requests within about one week when the project is actively monitored, but response time is not guaranteed.

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
| UI unchanged after update | Make sure you're running `src-tauri/target/release/neuropen.exe`, or reinstall via the NSIS package |
| Local Whisper shows as disabled | Rebuild with `--features local-stt` or `--features local-stt-gpu` |
| Ollama won't connect | Ensure Ollama is running and `localhost:11434` is accessible; model name must match an installed model |
| llama.cpp won't connect | Ensure `llama-server` is running and `localhost:8080/v1/chat/completions` is reachable; model name must match the loaded server model alias |
| LM Studio won't connect | Ensure the LM Studio local server is enabled and `localhost:1234/v1/chat/completions` is reachable; model name must match the served model id |
| Replace failed / focus error | NeuroPen only injects into the window that was focused at hotkey trigger time; if focus changes during processing, it cancels and warns |
| Quick Action icon not appearing | Some apps (games, custom-drawn UIs) don't support UI Automation API — use the Selection Voice Command (B2) path instead |
| Simulated input blocked | Some Electron apps / games block Ctrl+V simulation — paste manually |

---

## Security & Privacy

- **Focus verification**: Confirms the target window hasn't changed before injection, preventing input to unintended locations
- **Clipboard protection**: Caches before operations and restores after — users never lose clipboard content
- **Secure storage**: API Keys stored encrypted via Windows Credential Manager (keyring)
- **No background uploads**: All AI calls only happen when explicitly triggered by the user

---

## License

This project is licensed under the [MIT License](./LICENSE).
