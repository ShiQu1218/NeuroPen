import { useEffect, useState } from "react";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import "./App.css";

import PreviewWindow from "./components/PreviewWindow";
import QuickActionIcon from "./components/QuickActionIcon";
import Settings from "./components/Settings";
import RecordingIndicator from "./components/RecordingIndicator";
import { useAppStore } from "./store/useAppStore";
import type { AppLanguage, PunctuationMode } from "./store/useAppStore";

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

const inferAppToneHint = (windowTitle: string) => {
  const lower = windowTitle.toLowerCase();
  if (/(word|excel|powerpoint|notion|docs|outlook)/.test(lower)) {
    return "Use formal and concise business writing style.";
  }
  if (/(discord|slack|line|wechat|telegram)/.test(lower)) {
    return "Use casual chat-friendly style.";
  }
  if (/(code|visual studio|github|terminal|powershell)/.test(lower)) {
    return "Keep technical terms and code symbols unchanged.";
  }
  return "Keep neutral and clear style.";
};

const applyPunctuationMode = (text: string, mode: PunctuationMode) => {
  const base = text.trim();
  if (!base || mode === "off") return base;
  let normalized = base.replace(/\s+/g, " ");
  if (mode === "aggressive") {
    normalized = normalized
      .replace(/([，,;；])\s*/g, "$1 ")
      .replace(/([。.!?！？])\s*/g, "$1\n");
  }
  if (!/[。.!?！？]$/.test(normalized)) {
    normalized += "。";
  }
  return normalized;
};

const normalizeSttEngine = (engine: string): "openAi" | "localWhisper" =>
  engine === "localWhisper" ? "localWhisper" : "openAi";

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const clampToMonitorBounds = async (x: number, y: number, width: number, height: number) => {
  const monitors = await availableMonitors();
  if (monitors.length === 0) {
    return { x, y };
  }
  const targetMonitor = monitors.find(
    (monitor) =>
      x >= monitor.position.x &&
      x <= monitor.position.x + monitor.size.width &&
      y >= monitor.position.y &&
      y <= monitor.position.y + monitor.size.height
  ) ?? monitors[0];
  const minX = targetMonitor.position.x;
  const minY = targetMonitor.position.y;
  const maxX = targetMonitor.position.x + targetMonitor.size.width - width;
  const maxY = targetMonitor.position.y + targetMonitor.size.height - height;
  return {
    x: Math.round(clampNumber(x, minX, Math.max(minX, maxX))),
    y: Math.round(clampNumber(y, minY, Math.max(minY, maxY))),
  };
};

const containsNonLatinScript = (text: string) =>
  /[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF]/.test(text);

const isLikelyUnexpectedEnglishTranslation = (original: string, refined: string) => {
  if (!containsNonLatinScript(original) || containsNonLatinScript(refined)) {
    return false;
  }
  const condensed = refined.replace(/\s+/g, "");
  if (!condensed) return false;
  const latinCount = (condensed.match(/[A-Za-z]/g) ?? []).length;
  return latinCount / condensed.length > 0.6;
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
  const [, setStatusMsg] = useState("按住熱鍵開始錄音");

  const {
    setIsRecording,
    setSelectedText,
    setCurrentMode,
    setSttError,
    setSttEngine,
    setSttModelPath,
    setWakeWord,
    setHotkey,
    setOutputMode,
    setSttOutputStrategy,
    setPunctuationMode,
    setContextAwareTone,
    setVocabularyTerms,
    setLlmProvider,
    setLlmModel,
    setQuickActionCommands,
    setLanguage,
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
    let pendingHotkeyReleaseAt = 0;

    (async () => {
      // ── 0. Prevent sub-windows from being destroyed on close ──
      for (const label of ["settings", "preview", "quick-action", "recording-indicator"]) {
        preventCloseDestroy(label);
      }

      const initialStore = useAppStore.getState();
      await invoke("set_runtime_stt_config", {
        engine: normalizeSttEngine(String(initialStore.sttEngine)),
        modelPath: initialStore.sttModelPath,
      }).catch((err) => {
        console.warn("[App] set_runtime_stt_config init failed:", err);
      });

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

      const stopRecordingNow = async () => {
        const store = useAppStore.getState();
        if (!store.isRecording) return;
        try {
          const normalizedSttEngine = store.sttModelPath ? "localWhisper" : "openAi";
          await invoke("stop_recording", {
            engine: normalizedSttEngine,
            modelPath: store.sttModelPath,
          });
          store.setIsRecording(false);
          pendingHotkeyReleaseAt = 0;
          setStatusMsg("辨識中…");
        } catch (err) {
          console.error("[App] stop_recording failed:", err);
          store.setSttError(String(err));
          store.setIsRecording(false);
          pendingHotkeyReleaseAt = 0;
          setStatusMsg("停止錄音失敗");
        }
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

      await safeRegister<{
        wakeWord: string;
        hotkey: string;
        sttEngine: "openAi" | "localWhisper";
        sttModelPath?: string;
        outputMode: "DirectInject" | "PreviewStream";
        sttOutputStrategy?: "raw" | "llmRefine";
        punctuationMode?: "off" | "balanced" | "aggressive";
        contextAwareTone?: boolean;
        vocabularyTerms?: string[];
        llmProvider: "openAi" | "gemini" | "claude" | "grok" | "ollama";
        llmModel: string;
        language?: AppLanguage;
        quickActionCommands?: Array<{ id: string; label: string; instruction: string }>;
      }>(
        "talkflow://settings-saved",
        (event) => {
          const payload = event.payload;
          if (payload.wakeWord) {
            setWakeWord(payload.wakeWord);
          }
          if (payload.hotkey) {
            setHotkey(payload.hotkey);
          }
          if (payload.sttEngine) {
            setSttEngine(normalizeSttEngine(payload.sttEngine));
          }
          if (typeof payload.sttModelPath === "string") {
            setSttModelPath(payload.sttModelPath);
          }
          if (payload.sttEngine || typeof payload.sttModelPath === "string") {
            void invoke("set_runtime_stt_config", {
              engine: normalizeSttEngine(payload.sttEngine ?? "openAi"),
              modelPath: typeof payload.sttModelPath === "string" ? payload.sttModelPath : "",
            }).catch((err) => {
              console.warn("[App] set_runtime_stt_config sync failed:", err);
            });
          }
          if (payload.outputMode) {
            setOutputMode(payload.outputMode);
          }
          if (payload.sttOutputStrategy) {
            setSttOutputStrategy(payload.sttOutputStrategy);
          }
          if (payload.punctuationMode) {
            setPunctuationMode(payload.punctuationMode);
          }
          if (typeof payload.contextAwareTone === "boolean") {
            setContextAwareTone(payload.contextAwareTone);
          }
          if (payload.vocabularyTerms) {
            setVocabularyTerms(payload.vocabularyTerms);
          }
          if (payload.llmProvider) {
            setLlmProvider(payload.llmProvider);
          }
          if (payload.llmModel) {
            setLlmModel(payload.llmModel);
          }
          if (payload.language) {
            setLanguage(payload.language);
          }
          if (payload.quickActionCommands) {
            setQuickActionCommands(payload.quickActionCommands);
          }
          setStatusMsg("設定已更新");
          setTimeout(() => setStatusMsg("按住熱鍵開始錄音"), 2000);
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

            // Position QA icon below selection end (fallback to cursor).
            const x = typeof anchor_x === "number" ? anchor_x : cursor_x;
            const y = typeof anchor_y === "number" ? anchor_y : cursor_y;
            const currentFingerprint = `${text}::${x}::${y}`;
            // Lock target window + cache clipboard once per unique selection.
            if (currentFingerprint !== lastSelectionFingerprint) {
              // Auto-close old Preview Window only when the selection actually changed.
              const previewWin = await WebviewWindow.getByLabel("preview");
              if (previewWin) {
                const isVisible = await previewWin.isVisible();
                if (isVisible) {
                  await previewWin.hide();
                  const s = useAppStore.getState();
                  s.setLlmOutput("");
                  s.setIsLlmLoading(false);
                  s.setLlmError("");
                }
              }
              try {
                await invoke("trigger_hotkey");
                lastSelectionFingerprint = currentFingerprint;
              } catch (err) {
                console.warn("[App] trigger_hotkey failed:", err);
              }
            }
            await qaWin.setSize(new LogicalSize(40, 40));
            const qaSize = await qaWin.outerSize();
            const clampedQaPos = await clampToMonitorBounds(
              x + 8,
              y + 8,
              qaSize.width,
              qaSize.height
            );
            await qaWin.setPosition(new PhysicalPosition(clampedQaPos.x, clampedQaPos.y));
            await qaWin.show();
            await emit("talkflow://qa-show");
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
          const sttEngine = store.sttModelPath ? "localWhisper" : "openAi";
          if (sttEngine === "openAi") {
            const hasKey = await invoke<boolean>("has_stt_api_key");
            if (!hasKey) {
              pendingHotkeyReleaseAt = 0;
              setSttError("請先在設定中輸入 Whisper STT API Key");
              setStatusMsg("請先設定 STT API Key");
              return;
            }
          }

          try {
            await invoke("start_recording");
            setIsRecording(true);
            if (pendingHotkeyReleaseAt > 0 && Date.now() - pendingHotkeyReleaseAt < 800) {
              await stopRecordingNow();
            } else {
              pendingHotkeyReleaseAt = 0;
            }
          } catch (err) {
            console.error("[App] start_recording failed:", err);
            setSttError(String(err));
            setStatusMsg("錄音啟動失敗");
            pendingHotkeyReleaseAt = 0;
          }
        } else {
          // ── Mode A or C ── start recording
          // Check API key before starting (for OpenAI engine)
          const sttEngine = store.sttModelPath ? "localWhisper" : "openAi";
          if (sttEngine === "openAi") {
            const hasKey = await invoke<boolean>("has_stt_api_key");
            if (!hasKey) {
              pendingHotkeyReleaseAt = 0;
              setSttError("請先在設定中輸入 Whisper STT API Key");
              setStatusMsg("請先設定 STT API Key");
              return;
            }
          }

          setCurrentMode("A");
          setStatusMsg("錄音中… 放開熱鍵停止");
          try {
            await invoke("start_recording");
            setIsRecording(true);
            if (pendingHotkeyReleaseAt > 0 && Date.now() - pendingHotkeyReleaseAt < 800) {
              await stopRecordingNow();
            } else {
              pendingHotkeyReleaseAt = 0;
            }
          } catch (err) {
            console.error("[App] start_recording failed:", err);
            setSttError(String(err));
            setStatusMsg("錄音啟動失敗");
            pendingHotkeyReleaseAt = 0;
          }
        }
      });

      // ── 2. hotkey RELEASE → stop recording ──
      await safeRegister("talkflow://hotkey-release", async () => {
        pendingHotkeyReleaseAt = Date.now();
        console.log("[App] hotkey released → stopping recording");
        await stopRecordingNow();
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
            let finalText = applyPunctuationMode(result.transcript, store.punctuationMode);
            if (store.sttOutputStrategy === "llmRefine" && !store.incognito) {
              try {
                setStatusMsg("LLM 潤飾中…");
                const title = store.contextAwareTone
                  ? await invoke<string>("get_foreground_window_title")
                  : "";
                const toneHint = store.contextAwareTone ? inferAppToneHint(title) : "Keep original style.";
                const vocabHint = store.vocabularyTerms.length
                  ? `Prefer these domain terms exactly when relevant: ${store.vocabularyTerms.join(", ")}.`
                  : "";
                const refined = await invoke<string>("call_llm_text", {
                  selectedText: finalText,
                  instruction: `Only do light in-place polishing for this speech-to-text transcript (punctuation, formatting, and minor fluency fixes). Keep the exact same language and script as the original transcript, and never translate it. ${toneHint} ${vocabHint}`,
                  provider: store.llmProvider,
                  model: store.llmModel,
                });
                if (refined?.trim()) {
                  const candidate = refined.trim();
                  if (!isLikelyUnexpectedEnglishTranslation(finalText, candidate)) {
                    finalText = candidate;
                  }
                }
              } catch (err) {
                console.warn("[App] call_llm_text failed, fallback to STT output:", err);
              }
            }
            setStatusMsg("注入文字中…");
            const ok = await invoke<boolean>("verify_focus");
            if (!ok) {
              setStatusMsg("焦點視窗已變更，取消注入。");
              await invoke("restore_clipboard");
              return;
            }
            await invoke("inject_text", {
              text: finalText,
              recordForUndo: true,
            });
            // Wait for target app to process the paste
            await new Promise((r) => setTimeout(r, 150));
            await invoke("restore_clipboard");
            setStatusMsg("已注入文字");
            setTimeout(() => setStatusMsg("按住熱鍵開始錄音"), 2000);
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
            if (store.outputMode === "PreviewStream") {
              await emit("talkflow://preview-session", {
                selectedText: store.selectedText,
                instruction: result.transcript,
              });

              const previewWin = await WebviewWindow.getByLabel("preview");
              if (previewWin) {
                await previewWin.show();
                await previewWin.setFocus();
              }
            }

            setStatusMsg("LLM 處理中…");
            await invoke("call_llm", {
              selectedText: store.selectedText,
              instruction: result.transcript,
              outputMode: store.outputMode,
              provider: store.llmProvider,
              model: store.llmModel,
            });
            if (store.outputMode === "DirectInject") {
              await invoke("restore_clipboard");
              setStatusMsg("已注入文字");
              setTimeout(() => setStatusMsg("按住熱鍵開始錄音"), 2000);
            }
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
            if (store.outputMode === "PreviewStream") {
              await emit("talkflow://preview-session", {
                selectedText: "",
                instruction: result.transcript,
              });

              const previewWin = await WebviewWindow.getByLabel("preview");
              if (previewWin) {
                await previewWin.show();
                await previewWin.setFocus();
              }
            }

            setStatusMsg("LLM 處理中…");
            await invoke("call_llm", {
              selectedText: "",
              instruction: result.transcript,
              outputMode: store.outputMode,
              provider: store.llmProvider,
              model: store.llmModel,
            });
            if (store.outputMode === "DirectInject") {
              await invoke("restore_clipboard");
              setStatusMsg("已注入文字");
              setTimeout(() => setStatusMsg("按住熱鍵開始錄音"), 2000);
            }
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
          setTimeout(() => setStatusMsg("按住熱鍵開始錄音"), 2000);
        }
      );
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  return null;
}

export default App;
