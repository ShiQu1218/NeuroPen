<p align="center">
  <img src="public/talkflow-icon.png" alt="TalkFlow Logo" width="120" />
</p>

<h1 align="center">TalkFlow</h1>

<p align="center">
  <strong>Windows 桌面 AI 語音全能助手</strong><br/>
  在任何應用程式中，按一個快捷鍵就能語音輸入、翻譯、摘要、改寫、問答 — 不需要切換視窗。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows" alt="Windows" />
  <img src="https://img.shields.io/badge/Framework-Tauri%20v2-FFC131?logo=tauri" alt="Tauri" />
  <img src="https://img.shields.io/badge/Frontend-React%2019%20%2B%20TypeScript-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/Backend-Rust-DEA584?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT" />
</p>

---

## Table of Contents / 目錄

- [Features / 功能特色](#features--功能特色)
- [How It Works / 運作方式](#how-it-works--運作方式)
- [Architecture / 系統架構](#architecture--系統架構)
- [UI Components / 介面元件](#ui-components--介面元件)
- [Supported Models / 支援模型](#supported-models--支援模型)
- [Getting Started (Users) / 使用者快速開始](#getting-started-users--使用者快速開始)
- [Getting Started (Developers) / 開發者指南](#getting-started-developers--開發者指南)
- [Project Structure / 專案結構](#project-structure--專案結構)
- [Configuration / 設定說明](#configuration--設定說明)
- [CI/CD & Release / 自動化發佈](#cicd--release--自動化發佈)
- [Troubleshooting / 疑難排解](#troubleshooting--疑難排解)
- [Security & Privacy / 安全與隱私](#security--privacy--安全與隱私)
- [Roadmap / 開發藍圖](#roadmap--開發藍圖)
- [License / 授權](#license--授權)

---

## Features / 功能特色

| 功能 | 說明 |
|------|------|
| **全域語音輸入** | 在任何應用程式中按 `Alt + 反引號` 即時語音轉文字，直接輸入到游標位置 |
| **Quick Action 劃詞工具** | 選取文字後自動跳出浮動圖示，一鍵翻譯、摘要、改寫、修正語法 |
| **語音指令操作選取文字** | 選取文字 + 快捷鍵 + 語音說明需求，AI 自動處理 |
| **LLM 通用問答** | 不選字時呼喊喚醒詞（預設「助理」），直接向 AI 提問 |
| **串流預覽視窗** | LLM 回應逐字串流顯示，可追問、複製、取代或關閉 |
| **直接注入模式** | 可選擇跳過預覽，LLM 結果直接貼入輸入框 |
| **一鍵復原** | `Alt + Z` 還原上一次文字注入 |
| **本地 STT 支援** | 內建 Whisper (small/medium/large/turbo)，可完全離線語音辨識 |
| **多 LLM 提供商** | 支援 OpenAI、Gemini、Claude、Grok、Qwen、豆包、DeepSeek、Ollama |
| **10 國語言介面** | 繁中、簡中、English、日本語、Deutsch、Francais、العربية、Русский、Espanol、한국어 |
| **隱私模式** | 一鍵停用所有 LLM 呼叫，僅執行本地 STT |
| **系統匣常駐** | 啟動後隱藏於系統匣，右鍵開啟設定或退出 |

---

## How It Works / 運作方式

TalkFlow 根據「是否有選取文字」與「語音是否包含喚醒詞」自動分流到四種模式：

```
                         ┌──────────────┐
                         │  Alt + 反引號  │
                         │  (全域快捷鍵)  │
                         └──────┬───────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
              有選取文字？              無選取文字
                    │                       │
            ┌───────┴───────┐       ┌───────┴───────┐
            │               │       │               │
       透過滑鼠          透過語音    偵測到           未偵測到
      Quick Action       快捷鍵     喚醒詞            喚醒詞
            │               │       │               │
            ▼               ▼       ▼               ▼
     ┌──────────┐   ┌──────────┐ ┌──────────┐ ┌──────────┐
     │ Mode B1  │   │ Mode B2  │ │ Mode C   │ │ Mode A   │
     │ 劃詞快速 │   │ 語音指令 │ │ LLM 問答 │ │ 語音輸入 │
     │ 操作     │   │ 操作選字 │ │          │ │ (純 STT) │
     └────┬─────┘   └────┬─────┘ └────┬─────┘ └────┬─────┘
          │              │            │             │
          ▼              ▼            ▼             ▼
     ┌─────────────────────────┐  ┌─────────────────┐
     │   Output Preview Window │  │  直接注入到      │
     │   (串流預覽 / 複製 /    │  │  焦點輸入框      │
     │    取代 / 追問)         │  │                  │
     └─────────────────────────┘  └─────────────────┘
```

### Mode A — 直接語音輸入
> **場景**：你正在打字，想用語音代替鍵盤。
> **操作**：按住快捷鍵 → 說話 → 放開，文字即出現在游標位置。

### Mode B1 — Quick Action 劃詞操作
> **場景**：你選了一段英文，想翻譯成中文。
> **操作**：選字 → 點浮動圖示上的「翻譯」 → 預覽視窗顯示翻譯結果 → 點「取代」直接替換原文。

### Mode B2 — 語音指令操作選字
> **場景**：你選了一段文字，想用語音告訴 AI 怎麼改。
> **操作**：選字 → 按快捷鍵 → 說「幫我改成正式語氣」 → 預覽視窗顯示結果。

### Mode C — LLM 通用問答
> **場景**：你想問 AI 一個問題。
> **操作**：按快捷鍵 → 說「助理，明天台北天氣如何」 → 預覽視窗顯示回答。

---

## Architecture / 系統架構

```
┌──────────────────────────────────────────────────────────────────────┐
│                        TalkFlow Application                         │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Frontend (React + TypeScript)                 │ │
│  │                                                                  │ │
│  │  ┌──────────┐  ┌───────────────┐  ┌──────────┐  ┌───────────┐  │ │
│  │  │ Settings │  │ Quick Action  │  │ Preview  │  │ Recording │  │ │
│  │  │ Window   │  │ Icon + Panel  │  │ Window   │  │ Indicator │  │ │
│  │  └──────────┘  └───────────────┘  └──────────┘  └───────────┘  │ │
│  │                                                                  │ │
│  │  ┌──────────────────────┐  ┌──────────────────────────────────┐ │ │
│  │  │ Zustand State Store  │  │ i18n (10 Languages)              │ │ │
│  │  └──────────────────────┘  └──────────────────────────────────┘ │ │
│  └────────────────────────────┬────────────────────────────────────┘ │
│                               │ Tauri IPC (invoke / event)           │
│  ┌────────────────────────────┴────────────────────────────────────┐ │
│  │                      Backend (Rust / Tauri v2)                   │ │
│  │                                                                  │ │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │ │
│  │  │ hotkey.rs   │  │ mode_router  │  │ selection.rs           │ │ │
│  │  │ 全域快捷鍵  │──▶│ 模式分流     │◀─│ UI Automation 選字偵測 │ │ │
│  │  └─────────────┘  └──────┬───────┘  └────────────────────────┘ │ │
│  │                          │                                       │ │
│  │           ┌──────────────┼──────────────┐                       │ │
│  │           ▼              ▼              ▼                       │ │
│  │  ┌──────────────┐ ┌───────────┐ ┌──────────────┐              │ │
│  │  │ audio_capture│ │ stt.rs    │ │ llm.rs       │              │ │
│  │  │ 麥克風錄音   │─▶│ 語音轉文字│─▶│ LLM API 呼叫│              │ │
│  │  └──────────────┘ └───────────┘ └──────┬───────┘              │ │
│  │                                        │                       │ │
│  │           ┌────────────────────────────┤                       │ │
│  │           ▼                            ▼                       │ │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐       │ │
│  │  │ clipboard.rs     │  │ injection.rs                 │       │ │
│  │  │ 剪貼簿暫存/還原  │──▶│ 文字注入 (Ctrl+V 模擬)      │       │ │
│  │  └──────────────────┘  └──────────────────────────────┘       │ │
│  │                                                                │ │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐       │ │
│  │  │ window_focus.rs  │  │ undo.rs                      │       │ │
│  │  │ 焦點視窗鎖定     │  │ 復原上一次注入 (Alt+Z)       │       │ │
│  │  └──────────────────┘  └──────────────────────────────┘       │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     ┌────────────────┐ ┌───────────┐ ┌─────────────────┐
     │ Windows APIs   │ │ Cloud AI  │ │ Local Models    │
     │                │ │           │ │                 │
     │ • UI Automation│ │ • OpenAI  │ │ • Whisper.cpp   │
     │ • GetForeground│ │ • Gemini  │ │   (small/medium/│
     │   Window       │ │ • Claude  │ │    large/turbo) │
     │ • Clipboard    │ │ • Grok    │ │ • Ollama        │
     │ • SendInput    │ │ • Qwen    │ │                 │
     │                │ │ • Doubao  │ │                 │
     │                │ │ • DeepSeek│ │                 │
     └────────────────┘ └───────────┘ └─────────────────┘
```

### Text Injection Flow / 文字注入流程

```
 ① 快捷鍵觸發
    │
    ▼
 ② 暫存剪貼簿內容 ──────────────────────────────────────┐
    │                                                     │
    ▼                                                     │
 ③ 鎖定焦點視窗 (GetForegroundWindow)                    │
    │                                                     │
    ▼                                                     │
 ④ [Mode B] 模擬 Ctrl+C 讀取選字                         │
    │                                                     │
    ▼                                                     │
 ⑤ STT 語音辨識 / LLM 處理                               │
    │                                                     │
    ▼                                                     │
 ⑥ 確認焦點視窗未改變                                     │
    │     │                                               │
    │    焦點已變 → 取消注入，顯示警告                      │
    │                                                     │
    ▼                                                     │
 ⑦ 寫入結果到剪貼簿 → 模擬 Ctrl+V 貼上                    │
    │                                                     │
    ▼                                                     │
 ⑧ 還原原始剪貼簿內容 ◀──────────────────────────────────┘
```

---

## UI Components / 介面元件

### Settings Window / 設定視窗
左側分類導覽（一般、語音與 STT、快捷指令、LLM、隱私），右側內容可捲動，底部固定「取消 / 儲存」按鈕。

### Quick Action Icon / 劃詞快速操作
選取文字後自動淡入的浮動圖示。懸停展開面板，包含：
- 預設指令（翻譯成英文、翻譯成日文、摘要、修正語法、改為正式語氣）
- 自訂輸入框（輸入任意指令後送出）
- 使用者可在設定中自訂指令列表

### Output Preview Window / 預覽視窗

```
┌─────────────────────────────────────────┐
│  LLM 輸出內容（逐字串流 / 可捲動）       │
│                                          │
│  The quick brown fox jumps over the...   │
│                                          │
├──────────────────────────────────────────┤
│  [追問輸入框：再幫我改短一點...]  [送出]  │
├──────────────────────────────────────────┤
│        [複製]    [取代]    [關閉]         │
└──────────────────────────────────────────┘
```

- **複製**：將結果複製到剪貼簿
- **取代**：以結果取代原本選取的文字（Mode B）或注入游標位置（Mode C）
- **關閉**：放棄結果，原文不變
- **追問**：對當前結果追加指令，LLM 帶上下文重新回應

### Recording Indicator / 錄音指示器
螢幕下方中央的浮動指示器，顯示錄音狀態與秒數。

---

## Supported Models / 支援模型

### LLM Providers

| Provider | Type | Notes |
|----------|------|-------|
| OpenAI | Cloud | GPT-4o, GPT-4, GPT-3.5 等 |
| Gemini | Cloud | Google Gemini 系列 |
| Claude | Cloud | Anthropic Claude 系列 |
| Grok | Cloud | xAI Grok 系列 |
| Qwen | Cloud | 阿里通義千問 |
| 豆包 (Doubao) | Cloud | 字節跳動豆包 |
| DeepSeek | Cloud | DeepSeek 系列 |
| Ollama | Local | 本地執行，預設 `http://127.0.0.1:11434` |

### STT Engines

| Engine | Type | Notes |
|--------|------|-------|
| OpenAI Whisper API | Cloud | 需要 API Key |
| Local Whisper | Local | 透過 whisper-rs / whisper.cpp，支援 CPU 與 CUDA |

### Local Whisper Models

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| Whisper Small | ~461 MB | Fast | Good |
| Whisper Medium | ~1.5 GB | Medium | Better |
| Whisper Large | ~2.9 GB | Slow | Best |
| Whisper Turbo | ~1.5 GB | Fast | Better |

---

## Getting Started (Users) / 使用者快速開始

### System Requirements / 系統需求

- Windows 10 / 11
- 麥克風
- （雲端模式）網路連線 + API Key
- （本地 STT）建議 8 GB+ RAM；CUDA GPU 可加速

### Installation / 安裝

1. 前往 [Releases](../../releases) 頁面下載最新 `.exe` 安裝檔
2. 執行安裝程式（NSIS installer）
3. 啟動 TalkFlow — 程式會常駐在系統匣

### First-Time Setup / 首次設定

1. 右鍵點擊系統匣圖示 → **設定**
2. **一般**：設定顯示語言、全域快捷鍵、喚醒詞
3. **LLM**：選擇 Provider，輸入 API Key（如 OpenAI）
4. **語音與 STT**：選擇 STT 引擎（雲端 or 本地），安裝本地模型（可選）
5. 點「儲存」，即可開始使用

### Quick Usage / 快速上手

| 想做什麼 | 怎麼做 |
|----------|--------|
| 語音打字 | 在任何輸入框按 `Alt + 反引號` → 說話 → 放開 |
| 翻譯選字 | 選取文字 → 點浮動圖示 → 選「翻譯成英文」 |
| 語音改寫 | 選取文字 → 按快捷鍵 → 說「幫我改成正式語氣」 |
| 問 AI | 按快捷鍵 → 說「助理，幫我列出三個寫報告的技巧」 |
| 復原 | `Alt + Z` 還原上一次文字注入 |

---

## Getting Started (Developers) / 開發者指南

### Prerequisites / 環境需求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) toolchain (stable)
- Windows 10/11
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

### Install & Run / 安裝與啟動

```bash
# Clone the repository
git clone https://github.com/your-username/TalkFlow.git
cd TalkFlow

# Install frontend dependencies
npm install

# Run in development mode (with hot-reload)
npm run tauri dev
```

### Build / 建置

```bash
# Standard build
npm run tauri build

# Build with local STT (CPU)
npm run tauri build -- --features local-stt

# Build with local STT + CUDA acceleration
npm run tauri build -- --features local-stt,local-stt-cuda
```

Build output:
- Executable: `src-tauri/target/release/talkflow.exe`
- Installer (NSIS): `src-tauri/target/release/bundle/nsis/`

### Key Technologies / 關鍵技術

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

## Project Structure / 專案結構

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

## Configuration / 設定說明

| Category | Options |
|----------|---------|
| **一般 (General)** | 顯示語言、LLM 輸出偏好語言、全域快捷鍵、喚醒詞、開機自動啟動 |
| **語音與 STT (Voice & STT)** | STT 引擎選擇、本地模型管理（安裝/刪除/切換）、麥克風來源、STT 輸出策略（純 STT / LLM 潤飾）、智慧標點、詞彙庫匯入、前景 App 情境感知 |
| **快捷指令 (Quick Actions)** | 新增、編輯、刪除 Quick Action 指令 |
| **LLM** | 輸出模式（預覽串流 / 直接注入）、Provider、Model、API Key、多模態開關 |
| **隱私 (Privacy)** | 隱私模式（停用所有 LLM 呼叫，僅本地 STT） |

---

## CI/CD & Release / 自動化發佈

本專案使用 GitHub Actions 自動建置。推送 `v*` 標籤即觸發：

```bash
# Tag and push to trigger auto-build
git tag v0.1.0
git push origin v0.1.0
```

CI 完成後會在 **Releases** 頁面建立包含安裝檔的 Draft Release。

> **Note**: 雲端 CI 預設啟用 `local-stt` (CPU)。若需 CUDA 支援，請本機手動編譯後上傳。

---

## Troubleshooting / 疑難排解

| Problem | Solution |
|---------|----------|
| 更新後 UI 沒變 | 確認執行的是 `src-tauri/target/release/talkflow.exe`，或重新安裝 NSIS 包覆蓋舊版 |
| 本地 Whisper 顯示未啟用 | 需以 `--features local-stt` 或 `--features local-stt,local-stt-cuda` 重新建置 |
| Ollama 無法連線 | 確認 Ollama 正在執行且 `localhost:11434` 可存取，模型名稱與已安裝模型一致 |
| 取代失敗 / 焦點錯誤 | TalkFlow 僅對快捷鍵觸發時的焦點視窗注入；若焦點在處理期間改變，會取消並警告 |
| Quick Action 圖示未出現 | 部分應用（遊戲、自繪介面）不支援 UI Automation API，改用 Mode B2 語音路徑 |
| 模擬輸入被封鎖 | 部分 Electron app / 遊戲封鎖 Ctrl+V 模擬，請手動貼上 |

---

## Security & Privacy / 安全與隱私

- **焦點驗證**：注入前確認目標視窗未改變，防止輸入到非預期位置
- **剪貼簿保護**：操作前暫存、操作後還原，不污染使用者剪貼簿內容
- **隱私模式**：一鍵關閉所有雲端 LLM 呼叫，僅執行本地 STT
- **安全儲存**：API Key 使用 Windows Credential Manaer (keyring) 加密儲存
- **無後台上傳**：所有 AI 呼叫僅在使用者主動觸發時發生


---

## License / 授權

This project is licensed under the [MIT License](./LICENSE).