# TalkFlow MVP v1.0 — 任務追蹤

**最後更新**: 2026-02-28 | **規格版本**: v1.4

## 進度圖例
- [ ] 待開始  - [x] 已完成  - [~] 進行中

---

## Phase 0 — 專案初始化 & 腳手架
- [x] 0.1 新增 Rust 相依套件（windows, tokio, reqwest, tauri-plugin-global-shortcut）
- [x] 0.2 新增前端相依套件（zustand, tailwindcss）
- [x] 0.3 設定 tauri.conf.json 多視窗（settings, preview, quick-action, recording-indicator）
- [x] 0.4 設定 capabilities（global-shortcut, clipboard 權限）
- [x] 0.5 建立 Rust 模組骨架（hotkey.rs, window_focus.rs, clipboard.rs, injection.rs, selection.rs, stt.rs, mode_router.rs, llm.rs, undo.rs）
- [x] 0.6 建立前端元件骨架（PreviewWindow, QuickActionIcon, Settings, RecordingIndicator）
- [x] 0.7 建立 Zustand store
- [x] 0.8 安裝相依套件並驗收（npm install + cargo check）

---

## Phase 1 — Rust 後端基礎設施
- [x] 1.1 全域熱鍵監聽（Alt+Space, Alt+Z）
- [x] 1.2 焦點視窗鎖定（GetForegroundWindow, verify_focus_unchanged）
- [x] 1.3 剪貼簿管理員（cache / read / write / restore）
- [x] 1.4 文字注入（寫剪貼簿 + 模擬 Ctrl+V）
- [x] 1.5 UI Automation 選取偵測（靜默降級）
- [x] 1.6 Undo 堆疊（最後一次注入）
- [x] 1.7 驗收：Alt+Space 觸發、文字注入 Notepad、Alt+Z 還原

---

## Phase 2 — STT 整合 & 模式路由
- [x] 2.1 cpal 麥克風音訊捕捉
- [x] 2.2 OpenAI Whisper API STT（WAV 編碼、API 呼叫、事件發射）
- [x] 2.3 喚醒詞偵測（轉寫後掃描，strip wake word 並切換 Mode C）
- [x] 2.4 模式路由邏輯（A / B1 / B2 / C 分流，route_on_trigger + route_after_stt）
- [x] 2.5 Incognito 模式 flag（RouteResult 包含 incognito，前端 store 已連接）
- [x] 2.6 RecordingIndicator 前端 UI（stt 事件監聽、脈衝動畫、計時器、自動顯隱）
- [x] 2.7 驗收：cargo check + tsc --noEmit 通過（僅 warnings）
- [x] 2.8 reqwest multipart feature 啟用（改用 OpenAI Whisper API，免 CMake/C++）
- [x] 2.9  Cargo `local-stt` 可選特性閘控（Cargo.toml features 表、whisper-rs optional = true）
- [x] 2.10 stt.rs：SttEngine enum、SttCapabilities struct、get_capabilities()、stop_recording 多引擎分派
- [x] 2.11 transcribe_local 實作（cfg feature gate；無 feature 返回友善錯誤；有 feature 用 spawn_blocking + FullParams zh）
- [x] 2.12 lib.rs：get_stt_capabilities 指令、stop_recording 新簽章（engine + model_path）、invoke_handler 更新
- [x] 2.13 useAppStore.ts：SttEngine 型別、sttEngine 持久化欄位、localSttAvailable 執行期欄位
- [x] 2.14 Settings.tsx：STT 引擎 radio、未編譯 amber 提示、條件式模型路徑欄位、條件式 API Key 欄位、capability fetch effect
- [x] 2.15 驗收：cargo check 通過（無 feature）；tsc --noEmit 通過；Settings 引擎切換視覺正確

---

## Phase 3 — LLM 整合 & 輸出邏輯
- [x] 3.1 OpenAI 串流客戶端（SSE 解析，llm://token 事件）
- [x] 3.2 B1 預設指令系統提示（翻譯、摘要、修正語法、正式化）
- [x] 3.3 LLM 輸出模式（DirectInject / PreviewStream）
- [x] 3.4 call_llm Tauri 指令暴露
- [ ] 3.5 驗收：Mode B2 語音指令串流預覽、DirectInject 直接注入

---

## Phase 4 — 前端 UI 元件
- [x] 4.1 Output Preview Window（串流顯示、複製/取代/關閉、補充指令輸入）
- [x] 4.2 Quick Action Icon（選取偵測浮現、預設指令展開、自訂輸入）
- [x] 4.3 Settings UI（熱鍵、喚醒詞、STT 模型、LLM 模式、API Key、隱私模式）
- [ ] 4.4 Preview Window 中 Alt+Space 語音輸入到補充指令欄
- [x] 4.5 驗收：所有 UI 元件可互動，設定儲存後持久化

---

## Phase 5 — 整合、安全與收尾
- [ ] 5.1 焦點安全確認（注入前驗證，失敗時警告）
- [ ] 5.2 剪貼簿安全全程測試
- [ ] 5.3 Alt+Z Undo 確認只還原直接注入
- [ ] 5.4 錯誤處理（STT 失敗、LLM 失敗、注入被封鎖、UI Automation 降級）
- [ ] 5.5 Mode A 端對端測試
- [ ] 5.6 Mode B1 端對端測試
- [ ] 5.7 Mode B2 端對端測試
- [ ] 5.8 Mode C 端對端測試
- [ ] 5.9 DirectInject 模式端對端測試
- [ ] 5.10 Incognito 模式驗證

---

## MVP 完成條件（全部打勾才算完成）
- [ ] 三種模式（A / B1+B2 / C）均可端對端運作
- [ ] 剪貼簿從不遺失使用者原始內容
- [ ] Alt+Z Undo 有效
- [ ] 焦點改變時注入被取消並警告
- [ ] Settings UI 可設定並持久化
- [ ] Incognito 模式有效隔離 LLM
- [ ] `npm run tauri build` 產生可分發安裝檔
- [ ] Settings STT 引擎選擇持久化，切換後 stop_recording 使用對應引擎
