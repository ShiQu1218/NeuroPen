# 桌面端 AI 語音全能助手 TalkFlow

![TalkFlow](https://img.shields.io/badge/Status-Development-yellow.svg)
![React](https://img.shields.io/badge/Frontend-React%20%2B%20TypeScript-blue.svg)
![Tauri](https://img.shields.io/badge/Desktop-Tauri%20%2B%20Rust-orange.svg)

TalkFlow 是一款強大的系統級 AI 語音輔助工具，能整合您的工作流程。透過全域快捷鍵與語音辨識，您可以輕鬆地在任何應用程式中進行文字輸入、語言翻譯、內容摘要與 AI 問答。

## 🌟 核心功能

*   **全域語音輸入**：按下 `Alt + Space` 即可直接說話輸入文字，自動過濾啟動詞，支援即時語音轉文字（STT）。
*   **Quick Action 選單**：在任何程式中選取文字，自動跳出浮動圖示，提供快速翻譯、摘要、語法修正等功能。
*   **上下文感知問答**：結合剪貼簿或語音指令（例如：「助理，幫我總結這段文字」），AI 將在預覽視窗給予回覆。
*   **動態文字預覽與注入**：AI 輸出的內容可在專屬視窗預覽、手動修正，確認無誤後一鍵「取代」原有文字或「複製」內容。
*   **安全與隱私機制**：提供無痕模式與本地端模型選項，保障資料隱私。

## 🚀 立即開始開發 (Tauri + React + TypeScript + Vite)

### 開發環境需求

*   [Node.js](https://nodejs.org/) (建議 v18 以上)
*   [Rust](https://www.rust-lang.org/) 與其編譯工具鏈
*   Python (若有使用本地語音辨識模型與虛擬環境 `venv`)

### 安裝與運行

```bash
# 1. 安裝前端依賴
npm install

# 2. 啟動 Tauri 開發伺服器（首次編譯 Rust 核心可能需要幾分鐘）
npm run tauri dev
```

### 專案架構概覽

*   `src/`：前端 React 與 TypeScript 原始碼 (UI/UX 實作、選單設計)
*   `src-tauri/`：後端 Rust 核心原始碼 (全域快捷鍵綁定、UI Automation 剪貼簿控制、系統底層互操作)
*   `venv/` (選用)：供本地 AI / 語音處理模型使用的 Python 虛擬環境

## 🔧 技術堆疊

*   **前端**：React, TypeScript, Vite, TailwindCSS (可選)
*   **桌面整合**：Tauri (Rust)
*   **AI 引擎**：
    *   **STT (語音轉文字)**: Parakeet, Whisper, Moonshine (支援串流)
    *   **LLM (大型語言模型)**: OpenAI API, Gemini API 或本地離線模型

