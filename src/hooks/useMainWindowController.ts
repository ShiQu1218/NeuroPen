import { useEffect, useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, emit } from "@tauri-apps/api/event";
import { useI18n } from "../i18n";
import type { SelectionListenerState } from "./mainWindow/listenerTypes";
import { registerScreenshotListeners } from "./mainWindow/screenshotListeners";
import { registerSelectionListeners } from "./mainWindow/selectionListeners";
import { registerSttFinalRouter } from "./mainWindow/sttFinalRouter";
import { mainWindowService } from "../services/mainWindowService";
import { useAppStore } from "../store/useAppStore";
import type {
  AppLanguage,
  AppProfile,
  LlmProvider,
  PreferredLanguage,
  SttLanguage,
  TranslationTarget,
} from "../store/useAppStore";
import { normalizeSttEngine, normalizeSttLanguage } from "../utils/appText";
import {
  hideWindowByLabel,
  preventCloseDestroy,
} from "../utils/windowLifecycle";

export function useMainWindowController() {
  const { t } = useI18n();
  // Keep a ref so event-listener closures always use the latest translation function.
  const tRef = useRef(t);
  tRef.current = t;
  const tLive: typeof t = (...args) => tRef.current(...args);
  const [statusMsg, setStatusMsg] = useState(t("status.readyHoldHotkey"));
  const statusReadyRef = useRef(false);

  const {
    setIsRecording,
    setSelectedText,
    setCurrentMode,
    setSttError,
    setSttEngine,
    setSttLanguage,
    setSttModelPath,
    setWakeWord,
    setSttEnabled,
    setSelectionEnabled,
    setScreenshotEnabled,
    setHotkey,
    setOutputMode,
    setSttOutputStrategy,
    setPunctuationMode,
    setContextAwareTone,
    setVocabularyTerms,
    setLlmProvider,
    setLlmModel,
    setLlmModelOptions,
    setQuickActionCommands,
    setLanguage,
    setPreferredLanguage,
    setModeAPrompt,
    setModeBPrompt,
    setModeCPrompt,
    setModeAStreamOutput,
    setModeBStreamOutput,
    setMicrophoneSource,
    setLaunchOnStartup,
    setHistoryEnabled,
    setAppProfiles,
    setTranslationTarget,
    setScreenshotHotkey,
    resetSession,
  } = useAppStore();

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
    const selectionState: SelectionListenerState = {
      qaInteracting: false,
      lastSelectionFingerprint: "",
      suppressedSelectionFingerprint: "",
      selectionWatchSuppressedUntil: 0,
      qaHideTimer: null,
      qaResyncTimer: null,
      lastSelectionSnapshot: null,
    };
    let pendingHotkeyReleaseAt = 0;

    (async () => {
      // ── 0. Prevent sub-windows from being destroyed on close ──
      for (const label of ["settings", "preview", "quick-action", "recording-indicator", "screenshot-overlay"]) {
        preventCloseDestroy(label);
      }

      // Wait for Zustand persist hydration so we read the real saved values
      if (!useAppStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          useAppStore.persist.onFinishHydration(() => resolve());
        });
      }

      const hydratedStore = useAppStore.getState();
      const backendHotkeys = await mainWindowService.getRegisteredHotkeys().catch((err) => {
        console.warn("[App] get_registered_hotkeys failed:", err);
        return null;
      });
      const initialTriggerHotkey =
        backendHotkeys?.triggerPersisted ? backendHotkeys.triggerHotkey : hydratedStore.hotkey;
      const initialScreenshotHotkey =
        backendHotkeys?.screenshotPersisted ? backendHotkeys.screenshotHotkey : hydratedStore.screenshotHotkey;
      if (initialTriggerHotkey !== hydratedStore.hotkey) {
        setHotkey(initialTriggerHotkey);
      }
      if (initialScreenshotHotkey !== hydratedStore.screenshotHotkey) {
        setScreenshotHotkey(initialScreenshotHotkey);
      }
      if (!backendHotkeys || backendHotkeys.triggerHotkey !== initialTriggerHotkey) {
        await mainWindowService.changeHotkey(initialTriggerHotkey).catch((err) => {
          console.warn("[App] change_hotkey init failed, keeping stored value:", err);
        });
      }
      if (!backendHotkeys || backendHotkeys.screenshotHotkey !== initialScreenshotHotkey) {
        await mainWindowService.changeScreenshotHotkey(initialScreenshotHotkey).catch((err) => {
          console.warn("[App] change_screenshot_hotkey init failed:", err);
        });
      }
      await mainWindowService.setRuntimeSttConfig(
        normalizeSttEngine(String(hydratedStore.sttEngine)),
        hydratedStore.sttModelPath,
        normalizeSttLanguage(hydratedStore.sttLanguage),
      ).catch((err) => {
        console.warn("[App] set_runtime_stt_config init failed:", err);
      });
      await mainWindowService.setAudioDevice(hydratedStore.microphoneSource ?? "").catch((err) => {
        console.warn("[App] set_audio_device init failed:", err);
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

      const stopRecordingNow = async () => {
        const store = useAppStore.getState();
        if (!store.isRecording) return;
        try {
          const normalizedSttEngine = normalizeSttEngine(store.sttEngine);
          await mainWindowService.stopRecording(
            normalizedSttEngine,
            normalizedSttEngine === "localWhisper" ? store.sttModelPath : "",
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

      await safeRegister<{
        wakeWord: string;
        hotkey: string;
        sttEnabled?: boolean;
        selectionEnabled?: boolean;
        screenshotEnabled?: boolean;
        sttEngine: "openAi" | "localWhisper";
        sttModelPath?: string;
        sttLanguage?: SttLanguage;
        outputMode: "DirectInject" | "PreviewStream";
        sttOutputStrategy?: "raw" | "llmRefine";
        punctuationMode?: "off" | "balanced" | "aggressive";
        contextAwareTone?: boolean;
        vocabularyTerms?: string[];
        llmProvider: LlmProvider;
        llmModel: string;
        llmModelOptions?: string[];
        language?: AppLanguage;
        preferredLanguage?: PreferredLanguage;
        modeAPrompt?: string;
        modeBPrompt?: string;
        modeCPrompt?: string;
        modeAStreamOutput?: boolean;
        modeBStreamOutput?: boolean;
        microphoneSource?: string;
        launchOnStartup?: boolean;
        quickActionCommands?: Array<{ id: string; label: string; instruction: string }>;
        historyEnabled?: boolean;
        appProfiles?: AppProfile[];
        translationTarget?: TranslationTarget;
        screenshotHotkey?: string;
      }>(
        "neuropen://settings-saved",
        (event) => {
          const payload = event.payload;
          if (payload.wakeWord) {
            setWakeWord(payload.wakeWord);
          }
          if (typeof payload.hotkey === "string") {
            setHotkey(payload.hotkey);
          }
          if (typeof payload.sttEnabled === "boolean") {
            setSttEnabled(payload.sttEnabled);
          }
          if (typeof payload.selectionEnabled === "boolean") {
            setSelectionEnabled(payload.selectionEnabled);
            if (!payload.selectionEnabled) {
              void (async () => {
                await hideWindowByLabel("quick-action");
              })();
            }
          }
          if (typeof payload.screenshotEnabled === "boolean") {
            setScreenshotEnabled(payload.screenshotEnabled);
            if (!payload.screenshotEnabled) {
              void (async () => {
                await hideWindowByLabel("screenshot-overlay");
              })();
            }
          }
          if (payload.sttEngine) {
            setSttEngine(normalizeSttEngine(payload.sttEngine));
          }
          if (payload.sttLanguage) {
            setSttLanguage(normalizeSttLanguage(payload.sttLanguage));
          }
          if (typeof payload.sttModelPath === "string") {
            setSttModelPath(payload.sttModelPath);
          }
          if (payload.sttEngine || payload.sttLanguage || typeof payload.sttModelPath === "string") {
            void mainWindowService.setRuntimeSttConfig(
              normalizeSttEngine(payload.sttEngine ?? "openAi"),
              typeof payload.sttModelPath === "string" ? payload.sttModelPath : "",
              normalizeSttLanguage(payload.sttLanguage),
            ).catch((err) => {
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
          if (payload.llmModelOptions) {
            setLlmModelOptions(payload.llmModelOptions);
          }
          if (payload.language) {
            setLanguage(payload.language);
          }
          if (payload.preferredLanguage) {
            setPreferredLanguage(payload.preferredLanguage);
          }
          if (typeof payload.modeAPrompt === "string") {
            setModeAPrompt(payload.modeAPrompt);
          }
          if (typeof payload.modeBPrompt === "string") {
            setModeBPrompt(payload.modeBPrompt);
          }
          if (typeof payload.modeCPrompt === "string") {
            setModeCPrompt(payload.modeCPrompt);
          }
          if (typeof payload.modeAStreamOutput === "boolean") {
            setModeAStreamOutput(payload.modeAStreamOutput);
          }
          if (typeof payload.modeBStreamOutput === "boolean") {
            setModeBStreamOutput(payload.modeBStreamOutput);
          }
          if (typeof payload.microphoneSource === "string") {
            setMicrophoneSource(payload.microphoneSource);
          }
          if (typeof payload.launchOnStartup === "boolean") {
            setLaunchOnStartup(payload.launchOnStartup);
          }
          if (payload.quickActionCommands) {
            setQuickActionCommands(payload.quickActionCommands);
          }
          if (typeof payload.historyEnabled === "boolean") {
            setHistoryEnabled(payload.historyEnabled);
          }
          if (payload.appProfiles) {
            setAppProfiles(payload.appProfiles);
          }
          if (payload.translationTarget) {
            setTranslationTarget(payload.translationTarget);
          }
          if (typeof payload.screenshotHotkey === "string") {
            setScreenshotHotkey(payload.screenshotHotkey);
          }
          setStatusMsg(tLive("status.settingsUpdated"));
          setTimeout(() => setStatusMsg(tLive("status.readyHoldHotkey")), 2000);
        }
      );

      await registerSelectionListeners({
        safeRegister,
        selectionState,
      });

      // ── 1. hotkey PRESS → start recording ──
      await safeRegister<{
        has_selection: boolean;
        selected_text: string | null;
        initial_mode: string;
        hwnd: number;
      }>("neuropen://mode-start", async (event) => {
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

        if (has_selection && selected_text && store.selectionEnabled) {
          // ── Mode B2 ── hide Quick Action Icon, start recording
          setSelectedText(selected_text);
          setCurrentMode("B2");
          setStatusMsg(tLive("status.selectionRecording"));

          // Hide Quick Action Icon if it was shown by selection watcher
          const qaWin = await WebviewWindow.getByLabel("quick-action");
          if (qaWin) {
            selectionState.qaInteracting = false;
            await qaWin.hide();
          }

          // Check API key before starting (for OpenAI engine)
          const sttEngine = normalizeSttEngine(store.sttEngine);
          if (sttEngine === "openAi") {
            const hasKey = await mainWindowService.hasSttApiKey();
            if (!hasKey) {
              pendingHotkeyReleaseAt = 0;
              setSttError(tLive("error.sttApiKeyRequired"));
              setStatusMsg(tLive("status.setupSttApiKey"));
              return;
            }
          }

          try {
            await mainWindowService.startRecording();
            // Start streaming partial transcription
            mainWindowService.startStreamingStt(
              sttEngine,
              sttEngine === "localWhisper" ? store.sttModelPath : "",
            ).catch((e) => console.warn("[App] streaming STT start failed:", e));
            setIsRecording(true);
            if (pendingHotkeyReleaseAt > 0 && Date.now() - pendingHotkeyReleaseAt < 800) {
              await stopRecordingNow();
            } else {
              pendingHotkeyReleaseAt = 0;
            }
          } catch (err) {
            console.error("[App] start_recording failed:", err);
            setSttError(String(err));
            setStatusMsg(tLive("status.recordingStartFailed"));
            pendingHotkeyReleaseAt = 0;
          }
        } else {
          // ── Mode A or C ── start recording
          // Check API key before starting (for OpenAI engine)
          const sttEngine = normalizeSttEngine(store.sttEngine);
          if (sttEngine === "openAi") {
            const hasKey = await mainWindowService.hasSttApiKey();
            if (!hasKey) {
              pendingHotkeyReleaseAt = 0;
              setSttError(tLive("error.sttApiKeyRequired"));
              setStatusMsg(tLive("status.setupSttApiKey"));
              return;
            }
          }

          setCurrentMode("A");
          setStatusMsg(tLive("status.recordingReleaseToStop"));
          try {
            await mainWindowService.startRecording();
            // Start streaming partial transcription
            mainWindowService.startStreamingStt(
              sttEngine,
              sttEngine === "localWhisper" ? store.sttModelPath : "",
            ).catch((e) => console.warn("[App] streaming STT start failed:", e));
            setIsRecording(true);
            if (pendingHotkeyReleaseAt > 0 && Date.now() - pendingHotkeyReleaseAt < 800) {
              await stopRecordingNow();
            } else {
              pendingHotkeyReleaseAt = 0;
            }
          } catch (err) {
            console.error("[App] start_recording failed:", err);
            setSttError(String(err));
            setStatusMsg(tLive("status.recordingStartFailed"));
            pendingHotkeyReleaseAt = 0;
          }
        }
      });

      // ── 2. hotkey RELEASE → stop recording ──
      await safeRegister("neuropen://hotkey-release", async () => {
        pendingHotkeyReleaseAt = Date.now();
        console.log("[App] hotkey released → stopping recording");
        await stopRecordingNow();
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

      // ── 3.5. History save on LLM done (Feature 3) ──
      await safeRegister("llm://done", () => {
        const s = useAppStore.getState();
        if (s.llmOutput.trim() && !s.incognito && s.historyEnabled) {
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
      if (selectionState.qaHideTimer) {
        clearTimeout(selectionState.qaHideTimer);
      }
      if (selectionState.qaResyncTimer) {
        clearTimeout(selectionState.qaResyncTimer);
      }
      unlisten.forEach((fn) => fn());
    };
  }, [setSttLanguage]);
}
