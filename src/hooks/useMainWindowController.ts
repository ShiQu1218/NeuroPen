import { useEffect, useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, emit } from "@tauri-apps/api/event";
import { useI18n } from "../i18n";
import type { SafeRegister } from "./mainWindow/listenerTypes";
import {
  applySettingsSavedPayload,
  cleanupSelectionListenerState,
  createSelectionListenerState,
  initializeMainWindowRuntime,
  type ModeStartPayload,
  type SettingsSavedPayload,
} from "./mainWindow/controllerHelpers";
import { registerScreenshotListeners } from "./mainWindow/screenshotListeners";
import { registerSelectionListeners } from "./mainWindow/selectionListeners";
import { registerSttFinalRouter } from "./mainWindow/sttFinalRouter";
import { mainWindowService } from "../services/mainWindowService";
import { useAppStore } from "../store/useAppStore";
import { openAssistantDialog } from "../utils/previewWindow";
import { normalizeSttEngine, normalizeSttLanguage } from "../utils/appText";

export function useMainWindowController() {
  const { t } = useI18n();
  // Keep a ref so event-listener closures always use the latest translation function.
  const tRef = useRef(t);
  tRef.current = t;
  const tLive: typeof t = (...args) => tRef.current(...args);
  const [statusMsg, setStatusMsg] = useState(t("status.readyHoldHotkey"));
  const statusReadyRef = useRef(false);
  const resetSession = useAppStore((s) => s.resetSession);
  const setSttError = (message: string) => useAppStore.getState().setSttError(message);

  useEffect(() => {
    if (!statusReadyRef.current) {
      statusReadyRef.current = true;
      return;
    }
    void emit("neuropen://status", { message: statusMsg });
  }, [statusMsg]);

  // When the UI language changes, refresh the idle status message.
  const language = useAppStore((s) => s.language);
  useEffect(() => {
    setStatusMsg(t("status.readyHoldHotkey"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    // `cancelled` flag handles React StrictMode double-mount:
    // StrictMode: mount → cleanup (cancelled=true) → re-mount.
    // Without this flag, the first mount's async listeners never get cleaned
    // up because `unlisten` is still empty when cleanup runs synchronously.
    let cancelled = false;
    const unlisten: Array<() => void> = [];
    const selectionState = createSelectionListenerState();
    let pendingHotkeyReleaseAt = 0;

    const safeRegister: SafeRegister = async (event, handler) => {
      const u = await listen(event, handler);
      if (cancelled) {
        u();
      } else {
        unlisten.push(u);
      }
    };

    const stopRecordingNow = async () => {
      // Keep every stop path here so hotkey release, early aborts, and failures
      // all reset recording state and status text the same way.
      const store = useAppStore.getState();
      if (!store.isRecording) return;
      try {
        const normalizedSttEngine = normalizeSttEngine(store.sttEngine);
        await mainWindowService.stopRecording(
          normalizedSttEngine,
          normalizedSttEngine !== "openAi" ? store.sttModelPath : "",
          normalizeSttLanguage(store.sttLanguage),
        );
        store.setIsRecording(false);
        pendingHotkeyReleaseAt = 0;
        setStatusMsg(tLive("status.recognizing"));
      } catch (err) {
        console.error("[App] stop_recording failed:", err);
        store.setSttError(String(err));
        store.setIsRecording(false);
        pendingHotkeyReleaseAt = 0;
        setStatusMsg(tLive("status.stopRecordingFailed"));
      }
    };

    const ensureSttReady = async (sttEngine: ReturnType<typeof normalizeSttEngine>) => {
      if (sttEngine !== "openAi") {
        return true;
      }
      const hasKey = await mainWindowService.hasSttApiKey();
      if (hasKey) {
        return true;
      }
      pendingHotkeyReleaseAt = 0;
      const store = useAppStore.getState();
      store.setSttError(tLive("error.sttApiKeyRequired"));
      setStatusMsg(tLive("status.setupSttApiKey"));
      return false;
    };

    const startRecordingCapture = async (sttEngine: ReturnType<typeof normalizeSttEngine>) => {
      const store = useAppStore.getState();
      try {
        await mainWindowService.startRecording();
        // Partial STT is best-effort UI feedback; final routing still comes from the
        // stop-recording transcription path even if streaming startup fails.
        void mainWindowService.startStreamingStt(
          sttEngine,
          sttEngine !== "openAi" ? store.sttModelPath : "",
        ).catch((err) => console.warn("[App] streaming STT start failed:", err));
        store.setIsRecording(true);
        // If the key was released while startup was still in flight, stop immediately
        // after capture begins so the press-and-hold interaction still feels correct.
        if (pendingHotkeyReleaseAt > 0 && Date.now() - pendingHotkeyReleaseAt < 800) {
          await stopRecordingNow();
        } else {
          pendingHotkeyReleaseAt = 0;
        }
      } catch (err) {
        console.error("[App] start_recording failed:", err);
        store.setSttError(String(err));
        store.setIsRecording(false);
        setStatusMsg(tLive("status.recordingStartFailed"));
        pendingHotkeyReleaseAt = 0;
      }
    };

    const prepareSelectionRecording = async (selectedText: string) => {
      const store = useAppStore.getState();
      store.setSelectedText(selectedText);
      store.setCurrentMode("B2");
      setStatusMsg(tLive("status.selectionRecording"));

      // Hide the quick-action window once we commit to spoken follow-up so the
      // selection workflow has a single active surface.
      const qaWin = await WebviewWindow.getByLabel("quick-action");
      if (qaWin) {
        selectionState.qaInteracting = false;
        await qaWin.hide();
      }
    };

    (async () => {
      await initializeMainWindowRuntime();

      await safeRegister<{
        mode: "A" | "B1" | "B2" | "C";
        selectedText?: string;
        instruction?: string;
      }>("neuropen://llm-session-context", (event) => {
        const store = useAppStore.getState();
        store.setCurrentMode(event.payload.mode);
        store.setLastSelectedText(event.payload.selectedText ?? "");
        store.setLastInstruction(event.payload.instruction ?? "");
      });

      await safeRegister<SettingsSavedPayload>(
        "neuropen://settings-saved",
        (event) => {
          applySettingsSavedPayload(event.payload, tLive, setStatusMsg);
        }
      );

      await registerSelectionListeners({
        safeRegister,
        selectionState,
      });

      // ── 1. hotkey PRESS → start recording ──
      await safeRegister<ModeStartPayload>("neuropen://mode-start", async (event) => {
        const store = useAppStore.getState();

        // Already recording → ignore (key repeat)
        if (store.isRecording) {
          return;
        }
        if (!store.sttEnabled) {
          setStatusMsg(tLive("status.sttFeatureDisabled"));
          setTimeout(() => setStatusMsg(tLive("status.readyHoldHotkey")), 1500);
          return;
        }

        // ── New session ──
        const { has_selection, selected_text } = event.payload;
        if (import.meta.env.DEV) console.log("[App] neuropen://mode-start", event.payload);

        resetSession();
        const sttEngine = normalizeSttEngine(store.sttEngine);

        if (has_selection && selected_text && store.selectionEnabled) {
          await prepareSelectionRecording(selected_text);
          if (await ensureSttReady(sttEngine)) {
            await startRecordingCapture(sttEngine);
          }
        } else {
          store.setCurrentMode("A");
          setStatusMsg(tLive("status.recordingReleaseToStop"));
          if (await ensureSttReady(sttEngine)) {
            await startRecordingCapture(sttEngine);
          }
        }
      });

      // ── 2. hotkey RELEASE → stop recording ──
      await safeRegister("neuropen://hotkey-release", async () => {
        pendingHotkeyReleaseAt = Date.now();
        console.log("[App] hotkey released → stopping recording");
        await stopRecordingNow();
      });

      await safeRegister("hotkey://dialog", async () => {
        const store = useAppStore.getState();
        if (store.isRecording) {
          return;
        }
        store.setCurrentMode("C");
        await openAssistantDialog();
      });

      await registerScreenshotListeners({
        safeRegister,
        t: tLive,
        setStatusMsg,
        setSttError,
      });

      await registerSttFinalRouter({
        safeRegister,
        t: tLive,
        setStatusMsg,
        setSttError,
      });

      await safeRegister<{ text: string; outputMode: "DirectInject" | "PreviewStream" }>(
        "llm://result",
        (event) => {
          if (event.payload.outputMode !== "DirectInject") {
            return;
          }
          // Direct inject skips preview token updates, so keep the final output in
          // store long enough for the shared history-save handler to persist it.
          useAppStore.getState().setLlmOutput(event.payload.text);
        }
      );

      // ── 3.5. History save on LLM done (Feature 3) ──
      await safeRegister("llm://done", () => {
        const s = useAppStore.getState();
        if (s.llmOutput.trim() && !s.incognito && s.historyEnabled) {
          // Preview sessions can finish without direct injection, so persist the
          // generated result here when the backend signals completion.
          const mode = s.currentMode || "C";
          void mainWindowService.historySave({
            mode,
            inputText: s.lastSelectedText || "",
            instruction: s.lastInstruction || "",
            output: s.llmOutput,
            provider: s.llmProvider,
            model: s.llmModel,
          });
        }
      });

      // ── 3.6. STT metrics (Feature 13) ──
      await safeRegister<{ durationMs: number; audioLengthSecs: number }>(
        "stt://metrics",
        (event) => {
          useAppStore.getState().setSttDurationMs(event.payload.durationMs);
        }
      );

      // ── 4. STT error ──
      await safeRegister<{ message: string }>("stt://error", (event) => {
        console.error("[App] stt://error:", event.payload.message);
        const store = useAppStore.getState();
        store.setSttError(event.payload.message);
        store.setIsRecording(false);
        setStatusMsg(tLive("status.sttError", { reason: event.payload.message }));
      });

      // ── 5. Undo result ──
      await safeRegister<{ success: boolean; reason?: string }>(
        "neuropen://undo-result",
        (event) => {
          if (event.payload.success) {
            setStatusMsg(tLive("status.undoSuccess"));
          } else {
            setStatusMsg(tLive("status.undoFailed", { reason: event.payload.reason ?? "" }));
          }
          setTimeout(() => setStatusMsg(tLive("status.readyHoldHotkey")), 2000);
        }
      );
    })();

    return () => {
      cancelled = true;
      cleanupSelectionListenerState(selectionState);
      unlisten.forEach((fn) => fn());
    };
  }, [resetSession]);
}
