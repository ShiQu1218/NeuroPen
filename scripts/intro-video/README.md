# NeuroPen 繁中介紹短片

48 秒、1920 × 1080、30 fps、H.264 / AAC。使用專案原有圖示與 Quick Action GIF，
搭配繁中字幕、Windows 本機 zh-TW 合成旁白及程式原創配樂。
語音輸入及截圖問答畫面有標示「功能示意」，不是即時推論錄影或效能測試。
旁白由本機語音引擎合成，預設嘗試 Yating，缺少時使用已安裝的 zh-TW 語音。

## 重製

需求：Windows、Python 3.10+、Pillow、NumPy、FFmpeg / FFprobe、微軟正黑體、
System.Speech 相容的 zh-TW 語音。沿用本機工具，不安裝 npm 相依套件。

在儲存庫根目錄執行 `python scripts/intro-video/build_intro.py`。
先檢視分鏡可加上 `--preview`。再次執行會更新本片的輸出，不影響程式設定。
修改 `narration.json` 可調整文案與秒數，修改 `build_intro.py` 可調整畫面與動態。

輸出位於儲存庫下的 `video-output/neuropen-intro/`，已排除 Git 追蹤。

## 成品與 DaVinci Resolve 剪輯

- `NeuroPen_Intro_zh-TW_1080p.mp4`：完整成品，已燒入字幕及混音。
- `NeuroPen_Resolve.xml`：Final Cut Pro 7 XML 格式時間軸；六段影片與旁白、配樂分軌。
- `NeuroPen_zh-TW.srt`：另外提供的字幕檔。
- `scenes/`：六段獨立、無聲、無底部字幕的分鏡影片。
- `audio/narration.wav`、`audio/music.wav`：獨立旁白、配樂，可個別調整音量。
- `audio/mix.wav`：成品使用的混音；與獨立音軌混音後音量略有不同。
- `storyboard.jpg`：六鏡總覽。

Resolve 開啟新專案後，使用 **File → Import → Timeline** 選取 XML，勾選匯入來源素材。
接著將 SRT 匯入 Media Pool 並放到時間軸的字幕軌，起點對齊 00:00:00:00。
若目錄搬移，請重新連結 `scenes/` 及 `audio/` 素材。
XML 使用絕對素材路徑；保留整個輸出資料夾，不要只搬走 XML。
分鏡可重新排序、修剪；主標題與示意畫面已合成到各段影片，修改它們需重製來源。
完成剪輯後，可用 **File → Export Project** 匯出原生 DRP。
此流程不依賴 Resolve scripting API，也不需更改任何 scripting 權限。

## 內容依據與限制

功能依據為專案 `README.zh-TW.md` 與 `src-tauri/src/hotkey.rs`。
快捷鍵為預設值；截圖問答需支援圖片的模型，本機模型需另行安裝，雲端服務可能收費。
旁白字幕以各句字數比例配置於該段音訊，未做逐字強制對齊。
此工具不會呼叫雲端 AI、不會變更 NeuroPen 設定、不會擷取私人桌面內容。
XML 實際匯入狀態以交付時的驗證結果為準，不等同已成功建立原生 DRP。
