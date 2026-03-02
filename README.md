# TalkFlow — Windows 桌面 AI 語音助理

![Status](https://img.shields.io/badge/Status-Development-yellow.svg)
![Frontend](https://img.shields.io/badge/Frontend-React%20%2B%20TypeScript-blue.svg)
![Desktop](https://img.shields.io/badge/Desktop-Tauri%20%2B%20Rust-orange.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

TalkFlow 是一個 **Windows 專用** 的系統級 AI 語音工具，支援全域熱鍵、選字快速操作、LLM 串流預覽、文字取代與多語介面。  
設計重點是「**不離開你目前的工作視窗**」：在任何 app 直接說話或劃詞就能完成輸入、重寫、翻譯、摘要與問答。

---

## 目錄

- [核心能力](#核心能力)
- [操作模式](#操作模式)
- [介面與互動](#介面與互動)
- [語言支援](#語言支援)
- [模型與提供商支援](#模型與提供商支援)
- [快速開始（開發）](#快速開始開發)
- [建置與發佈](#建置與發佈)
- [設定說明](#設定說明)
- [專案結構](#專案結構)
- [疑難排解](#疑難排解)
- [安全與隱私](#安全與隱私)
- [授權](#授權)

---

## 核心能力

- **全域語音輸入**：預設 `Alt + \`` 啟動錄音，放開熱鍵停止並執行路由。
- **Quick Action 劃詞工具**：選取文字後出現浮動圖示，可一鍵套用預設或自訂指令。
- **LLM 輸出雙模式**：
  - `PreviewStream`：先在預覽窗串流顯示，可補充指令、複製、取代。
  - `DirectInject`：直接注入目標輸入框。
- **系統匣常駐**：啟動後隱藏主視窗，透過 Tray 右鍵選單開啟設定或離開。
- **復原機制**：`Alt + Z` 可復原上一次可復原注入（主要為直接注入流程）。
- **可編輯快捷指令**：使用者可在設定新增、修改、刪除 Quick Action 指令。
- **本地 STT 模型管理**：支援模型安裝/刪除/切換（Whisper small/medium/large/turbo）。
- **進階 STT 策略**：支援純 STT 直出 / 先經 LLM 潤飾、智慧標點排版、詞彙庫套用、前景 App 情境語氣調整。

---

## 操作模式

TalkFlow 依「是否有選字」與「語音內容」進行路由：

1. **Mode A — 直接語音輸入**  
   無選字時，語音轉文字後直接注入目前焦點視窗。

2. **Mode B1 — 劃詞快速操作**  
   選字後點 Quick Action 指令，送 LLM 產生結果（預設走預覽串流）。

3. **Mode B2 — 選字後語音指令**  
   有選字時按熱鍵說明需求（如「幫我改正式一點」），LLM 根據選字產生結果。

4. **Mode C — 一般 LLM 問答**  
   無選字時，將語音當成一般提問送給 LLM。

### 多模態 LLM（開發中）

- 在 `設定 > LLM` 勾選多模態後，會直接把錄音與文字（若有選字）送給 LLM。
- 啟用多模態時，STT 選項會鎖定為不可選。
- 若無選字，則由 LLM 自行判斷最合適的回覆形式。

---

## 介面與互動

- **Settings 視窗**：左側目錄導覽、右側內容可捲動、底部固定「取消 / 儲存」。
- **Quick Action 視窗**：icon 淡入、展開面板、支援自訂輸入框。
- **Preview 視窗**：
  - 可拖曳
  - 串流顯示 LLM 輸出
  - 支援「複製 / 取代 / 關閉」
  - 支援 follow-up 補充指令（帶上下文）
- **錄音指示器**：顯示於螢幕下方中央，包含錄音狀態與秒數。

---

## 語言支援

可於 `設定 > 一般 > 顯示語言` 切換，儲存後即時套用並持久化。

### 目前可選語言

- `zh-TW` 繁體中文
- `zh-CN` 简体中文
- `en-US` English
- `ja-JP` 日本語
- `de-DE` Deutsch
- `fr-FR` Français
- `ar-SA` العربية
- `ru-RU` Русский
- `es-ES` Español
- `ko-KR` 한국어

> 註：部分語言目前仍含 fallback 文案（會優先顯示該語言，缺漏時回退到既有語系）。

---

## 模型與提供商支援

### LLM Provider

- OpenAI
- Gemini
- Claude
- Grok
- Qwen
- 豆包（Doubao）
- DeepSeek
- Ollama（本地，預設 `http://127.0.0.1:11434`）

### STT Engine

- OpenAI Whisper API
- Local Whisper（透過 `whisper-rs` / `whisper.cpp`）

### 本地 STT 模型

- Whisper Small
- Whisper Medium
- Whisper Large
- Whisper Turbo

---

## 快速開始（開發）

### 環境需求

- [Node.js](https://nodejs.org/)（建議 18+）
- [Rust](https://www.rust-lang.org/) toolchain
- Windows 10/11
- （選用）Python/venv：若你的流程有用到本地模型工具鏈

### 安裝

```bash
npm install
```

### 啟動開發模式

```bash
npm run tauri dev
```

---

## 建置與發佈

### 一般 Release

```bash
npm run tauri build
```

輸出通常位於：

- 可執行檔：`src-tauri\target\release\talkflow.exe`
- 安裝包（NSIS）：`src-tauri\target\release\bundle\nsis\`

### 啟用本地 STT（CPU）

```bash
npm run tauri build -- --features local-stt
```

### 啟用本地 STT（CUDA / NVIDIA）

```bash
npm run tauri build -- --features local-stt,local-stt-cuda
```

> 建議從專案根目錄執行 `npm run tauri build`，避免前端與 Rust 產物不同步。

---

## 設定說明

| 分類 | 內容 |
|---|---|
| 一般 | 顯示語言、LLM 輸出偏好語言、全域熱鍵、喚醒詞、開機自動啟動 |
| 語音與 STT | STT 引擎、本地模型管理（安裝/刪除/切換）、麥克風來源、STT 輸出策略、智慧標點、詞彙庫匯入、情境感知 |
| 快捷指令 | Quick Action 指令新增/編輯/刪除 |
| LLM | 輸出模式、Provider、Model、API Key、多模態勾選（直接把錄音和文字丟給 LLM；啟用後 STT 不可選） |
| 隱私 | 隱私模式（停用 LLM 呼叫） |

---

## 專案結構

```text
TalkFlow/
├─ src/                 # React + TypeScript 前端（Settings / Quick Action / Preview）
├─ src-tauri/           # Rust 後端（熱鍵、路由、注入、剪貼簿、STT/LLM）
├─ public/              # 靜態資源
├─ dist/                # 前端 build 輸出
├─ package.json
└─ README.md
```

---

## 疑難排解

### 1) 為什麼改了 UI 但 exe 看起來沒變？

- 請確認執行的是最新路徑：
  - `src-tauri\target\release\talkflow.exe`
- 若你用桌面捷徑，可能仍指向舊安裝路徑，建議重新用 NSIS 安裝覆蓋。

### 2) 本地 Whisper 顯示未啟用

- 需用對應 feature 重新建置（`local-stt` 或 `local-stt-cuda`）。

### 3) Ollama 無法呼叫

- 確認本機 Ollama 正在執行且 `11434` 可用。
- 確認模型名稱與 Ollama 已安裝模型一致。

### 4) 取代失敗 / 焦點錯誤

- TalkFlow 只會對鎖定焦點視窗注入；若使用期間焦點切換，會主動取消以避免誤貼。

---

## 安全與隱私

- 提供隱私模式，可關閉 LLM 呼叫。
- 注入流程包含焦點驗證，避免輸入到非預期視窗。
- 剪貼簿流程具還原機制，降低對使用者剪貼簿的污染。

---

## 技術棧

- 前端：React 19、TypeScript、Vite、TailwindCSS、Zustand
- 桌面：Tauri v2（Rust）
- AI：OpenAI / Gemini / Claude / Grok / Qwen / Doubao / DeepSeek / Ollama、Whisper（API / Local）

---

## 授權

本專案採用 [MIT License](./LICENSE)。

