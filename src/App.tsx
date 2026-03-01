import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import "./App.css";

import PreviewWindow from "./components/PreviewWindow";
import QuickActionIcon from "./components/QuickActionIcon";
import Settings from "./components/Settings";
import RecordingIndicator from "./components/RecordingIndicator";
import { useAppStore } from "./store/useAppStore";

const openSettings = async () => {
  const win = await WebviewWindow.getByLabel("settings");
  if (win) {
    await win.show();
    await win.setFocus();
  } else {
    console.warn("[App] settings window not found");
  }
};

/**
 * Prevent a window from being destroyed on close — hide it instead.
 */
const preventCloseDestroy = async (label: string) => {
  const win = await WebviewWindow.getByLabel(label);
  if (win) {
    await win.onCloseRequested(async (event) => {
      event.preventDefault();
      await win.hide();
    });
  }
};

function App() {
  const [windowLabel, setWindowLabel] = useState<string>("");

  useEffect(() => {
    setWindowLabel(getCurrentWindow().label);
  }, []);

  if (windowLabel === "main") {
    return <MainWindow />;
  }

  switch (windowLabel) {
    case "preview":
      return <PreviewWindow />;
    case "quick-action":
      return <QuickActionIcon />;
    case "settings":
      return <Settings />;
    case "recording-indicator":
      return <RecordingIndicator />;
    default:
      return null;
  }
}

/** Main window handles hotkey events and orchestrates the full flow. */
function MainWindow() {
  const [statusMsg, setStatusMsg] = useState("按住 Alt+Space 開始錄音");

  const {
    setIsRecording,
    setSelectedText,
    setCurrentMode,
    setSttError,
    resetSession,
  } = useAppStore();

  useEffect(() => {
    // `cancelled` flag handles React StrictMode double-mount:
    // StrictMode: mount → cleanup (cancelled=true) → re-mount.
    // Without this flag, the first mount's async listeners never get cleaned
    // up because `unlisten` is still empty when cleanup runs synchronously.
    let cancelled = false;
    const unlisten: Array<() => void> = [];
    let qaInteracting = false;
    let lastSelectionFingerprint = "";

    (async () => {
      // ── 0. Prevent sub-windows from being destroyed on close ──
      for (const label of ["settings", "preview", "quick-action", "recording-indicator"]) {
        preventCloseDestroy(label);
      }

      // Helper: register a listener only if this effect hasn't been cancelled
      async function safeRegister<T>(
        event: string,
        handler: (e: { payload: T }) => void | Promise<void>,
      ) {
        const u = await listen<T>(event, handler);
        if (cancelled) {
          u(); // immediately unregister if effect was already cleaned up
        } else {
          unlisten.push(u);
        }
      }

      const isTalkFlowWindowFocused = async () => {
        for (const label of ["main", "quick-action", "preview", "settings", "recording-indicator"]) {
          const win = await WebviewWindow.getByLabel(label);
          if (win && (await win.isFocused())) {
            return true;
          }
        }
        return false;
      };

      await safeRegister<{ active: boolean }>(
        "talkflow://qa-interacting",
        async (event) => {
          qaInteracting = !!event.payload.active;
          if (!qaInteracting) {
            lastSelectionFingerprint = "";
            const sel = await invoke<{ has_selection: boolean }>("get_selection");
            if (!sel.has_selection) {
              const qaWin = await WebviewWindow.getByLabel("quick-action");
              if (qaWin) {
                await qaWin.hide();
              }
            }
          }
        }
      );

      // ── 0.5. Selection watcher → auto-show/hide Quick Action Icon ──
      await safeRegister<{
        has_selection: boolean;
        text: string | null;
        cursor_x: number;
        cursor_y: number;
        anchor_x?: number | null;
        anchor_y?: number | null;
      }>(
        "talkflow://selection-changed",
        async (event) => {
          const { has_selection, text, cursor_x, cursor_y, anchor_x, anchor_y } = event.payload;
          const store = useAppStore.getState();

          // Don't show Quick Action Icon while recording
          if (store.isRecording) return;
          // Freeze watcher-driven UI updates while quick-action is interacting.
          if (qaInteracting) return;
          // Ignore internal selections from TalkFlow windows (preview/quick-action/etc).
          if (await isTalkFlowWindowFocused()) return;

          const qaWin = await WebviewWindow.getByLabel("quick-action");
          if (!qaWin) return;

          if (has_selection && text) {
            setSelectedText(text);
            await emit("talkflow://stable-selection", { text });

            // Auto-close old Preview Window when new selection appears
            const previewWin = await WebviewWindow.getByLabel("preview");
            if (previewWin) {
              const isVisible = await previewWin.isVisible();
              if (isVisible) {
                await previewWin.hide();
                // Reset LLM state in main window store
                const s = useAppStore.getState();
                s.setLlmOutput("");
                s.setIsLlmLoading(false);
                s.setLlmError("");
              }
            }

            // Position QA icon below selection end (fallback to cursor).
            const x = typeof anchor_x === "number" ? anchor_x : cursor_x;
            const y = typeof anchor_y === "number" ? anchor_y : cursor_y;
            const currentFingerprint = `${text}::${x}::${y}`;
            // Lock target window + cache clipboard once per unique selection.
            if (currentFingerprint !== lastSelectionFingerprint) {
              try {
                await invoke("trigger_hotkey");
                lastSelectionFingerprint = currentFingerprint;
              } catch (err) {
                console.warn("[App] trigger_hotkey failed:", err);
              }
            }
            await qaWin.setPosition(new PhysicalPosition(x + 8, y + 8));
            await qaWin.show();
          } else {
            lastSelectionFingerprint = "";
            if (qaInteracting) return;
            await qaWin.hide();
          }
        }
      );

      // ── 1. hotkey PRESS → start recording ──
      await safeRegister<{
        has_selection: boolean;
        selected_text: string | null;
        initial_mode: string;
        hwnd: number;
      }>("talkflow://mode-start", async (event) => {
        const store = useAppStore.getState();

        // Already recording → ignore (key repeat)
        if (store.isRecording) {
          return;
        }

        // ── New session ──
        const { has_selection, selected_text } = event.payload;
        console.log("[App] talkflow://mode-start", event.payload);

        resetSession();

        if (has_selection && selected_text) {
          // ── Mode B2 ── hide Quick Action Icon, start recording
          setSelectedText(selected_text);
          setCurrentMode("B2");
          setStatusMsg("文字已選取 — 錄音中…");

          // Hide Quick Action Icon if it was shown by selection watcher
          const qaWin = await WebviewWindow.getByLabel("quick-action");
          if (qaWin) {
            qaInteracting = false;
            await qaWin.hide();
          }

          // Check API key before starting (for OpenAI engine)
          const sttEngine = store.sttEngine;
          if (sttEngine === "openAi") {
            const hasKey = await invoke<boolean>("has_api_key");
            if (!hasKey) {
              setSttError("請先在設定中輸入 OpenAI API Key");
              setStatusMsg("請先設定 API Key");
              return;
            }
          }

          try {
            await invoke("start_recording");
            setIsRecording(true);
          } catch (err) {
            console.error("[App] start_recording failed:", err);
            setSttError(String(err));
            setStatusMsg("錄音啟動失敗");
          }
        } else {
          // ── Mode A or C ── start recording
          // Check API key before starting (for OpenAI engine)
          const sttEngine = store.sttEngine;
          if (sttEngine === "openAi") {
            const hasKey = await invoke<boolean>("has_api_key");
            if (!hasKey) {
              setSttError("請先在設定中輸入 OpenAI API Key");
              setStatusMsg("請先設定 API Key");
              return;
            }
          }

          setCurrentMode("A");
          setStatusMsg("錄音中… 放開熱鍵停止");
          try {
            await invoke("start_recording");
            setIsRecording(true);
          } catch (err) {
            console.error("[App] start_recording failed:", err);
            setSttError(String(err));
            setStatusMsg("錄音啟動失敗");
          }
        }
      });

      // ── 2. hotkey RELEASE → stop recording ──
      await safeRegister("talkflow://hotkey-release", async () => {
        const store = useAppStore.getState();
        if (!store.isRecording) return;

        console.log("[App] hotkey released → stopping recording");
        try {
          await invoke("stop_recording", {
            engine: store.sttEngine,
            modelPath: store.sttModelPath,
          });
          store.setIsRecording(false);
          setStatusMsg("辨識中…");
        } catch (err) {
          console.error("[App] stop_recording failed:", err);
          store.setSttError(String(err));
          store.setIsRecording(false);
          setStatusMsg("停止錄音失敗");
        }
      });

      // ── 3. STT final result → route transcript ──
      await safeRegister<{ text: string }>("stt://final", async (event) => {
        const transcript = event.payload.text;
        console.log("[App] stt://final:", transcript);

        const store = useAppStore.getState();
        store.setTranscript(transcript);

        try {
          const result = await invoke<{
            mode: string;
            transcript: string;
            selected_text: string | null;
            incognito: boolean;
          }>("route_transcript", {
            transcript,
            selectedText: store.selectedText || null,
            wakeWord: store.wakeWord,
            incognito: store.incognito,
          });

          console.log("[App] route_transcript result:", result);
          const mode = result.mode as "A" | "B2" | "C";
          store.setCurrentMode(mode);

          if (mode === "A") {
            // ── Mode A — inject STT text directly ──
            setStatusMsg("注入文字中…");
            const ok = await invoke<boolean>("verify_focus");
            if (!ok) {
              setStatusMsg("焦點視窗已變更，取消注入。");
              await invoke("restore_clipboard");
              return;
            }
            await invoke("inject_text", {
              text: result.transcript,
              recordForUndo: true,
            });
            // Wait for target app to process the paste
            await new Promise((r) => setTimeout(r, 150));
            await invoke("restore_clipboard");
            setStatusMsg("已注入文字");
            setTimeout(() => setStatusMsg("按住 Alt+Space 開始錄音"), 2000);
          } else if (mode === "B2") {
            // ── Mode B2 — voice command on selected text ──
            if (store.incognito) {
              setStatusMsg("隱私模式：不呼叫 LLM");
              return;
            }
            store.setLlmOutput("");
            store.setIsLlmLoading(true);
            store.setLlmError("");
            store.setLastSelectedText(store.selectedText);
            store.setLastInstruction(result.transcript);
            await emit("talkflow://preview-session", {
              selectedText: store.selectedText,
              instruction: result.transcript,
            });

            const previewWin = await WebviewWindow.getByLabel("preview");
            if (previewWin) {
              await previewWin.show();
              await previewWin.setFocus();
            }

            setStatusMsg("LLM 處理中…");
            await invoke("call_llm", {
              selectedText: store.selectedText,
              instruction: result.transcript,
              outputMode: "PreviewStream",
            });
          } else if (mode === "C") {
            // ── Mode C — LLM query ──
            if (store.incognito) {
              setStatusMsg("隱私模式：不呼叫 LLM");
              return;
            }
            store.setLlmOutput("");
            store.setIsLlmLoading(true);
            store.setLlmError("");
            store.setLastInstruction(result.transcript);
            await emit("talkflow://preview-session", {
              selectedText: "",
              instruction: result.transcript,
            });

            const previewWin = await WebviewWindow.getByLabel("preview");
            if (previewWin) {
              await previewWin.show();
              await previewWin.setFocus();
            }

            setStatusMsg("LLM 處理中…");
            await invoke("call_llm", {
              selectedText: "",
              instruction: result.transcript,
              outputMode: "PreviewStream",
            });
          }
        } catch (err) {
          console.error("[App] route_transcript error:", err);
          setStatusMsg("路由失敗: " + String(err));
        }
      });

      // ── 4. STT error ──
      await safeRegister<{ message: string }>("stt://error", (event) => {
        console.error("[App] stt://error:", event.payload.message);
        const store = useAppStore.getState();
        store.setSttError(event.payload.message);
        store.setIsRecording(false);
        setStatusMsg("語音辨識錯誤: " + event.payload.message);
      });

      // ── 5. Undo result ──
      await safeRegister<{ success: boolean; reason?: string }>(
        "talkflow://undo-result",
        (event) => {
          if (event.payload.success) {
            setStatusMsg("已復原");
          } else {
            setStatusMsg("無法復原: " + (event.payload.reason ?? ""));
          }
          setTimeout(() => setStatusMsg("按住 Alt+Space 開始錄音"), 2000);
        }
      );
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  const currentMode = useAppStore((s) => s.currentMode);
  const isRec = useAppStore((s) => s.isRecording);
  const sttError = useAppStore((s) => s.sttError);

  return (
    <main className="relative flex flex-col items-center justify-center h-screen bg-gray-50 text-gray-700">
      <button
        className="absolute top-3 right-3 p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
        onClick={openSettings}
        title="設定"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      <h1 className="text-2xl font-semibold mb-2">TalkFlow</h1>
      <p className="text-gray-400 text-sm">Windows AI Voice Assistant</p>

      {/* Status indicator */}
      <div className="mt-6 flex flex-col items-center gap-2">
        {isRec && (
          <span className="flex items-center gap-2 text-red-500 text-sm font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            錄音中…
          </span>
        )}
        {currentMode && (
          <span className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded">
            Mode {currentMode}
          </span>
        )}
        {sttError && (
          <span className="text-xs text-red-500">{sttError}</span>
        )}
        <p className="mt-2 text-xs text-gray-300">{statusMsg}</p>
      </div>
    </main>
  );
}

export default App;
