import { useEffect, useRef, useState } from "react";
import { currentMonitor } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, emit, emitTo } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { useI18n } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import type {
  AppLanguage,
  LlmProvider,
  PreferredLanguage,
  SttLanguage,
  TranslationTarget,
} from "../store/useAppStore";
import {
  applyPunctuationMode,
  buildSelectionFingerprint,
  inferAppToneHint,
  isLikelyUnexpectedEnglishTranslation,
  normalizeSttEngine,
  normalizeSttLanguage,
  stripWrappingQuotes,
} from "../utils/appText";
import { clampToMonitorBounds } from "../utils/windowBounds";
import {
  emitPreviewSession,
  emitPreviewStaticOutput,
  showPreviewWindow,
} from "../utils/previewWindow";
import {
  hideWindowByLabel,
  isAnyTalkFlowWindowFocused,
  preventCloseDestroy,
} from "../utils/windowLifecycle";

interface RegisteredHotkeys {
  triggerHotkey: string;
  triggerPersisted: boolean;
  screenshotHotkey: string;
  screenshotPersisted: boolean;
}

const isLikelyAuthError = (err: unknown) =>
  /(401|unauthorized|api\s*key|authentication|invalid key)/i.test(String(err));

export function useMainWindowController() {
  const { t } = useI18n();
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
    setMicrophoneSource,
    setLaunchOnStartup,
    setHistoryEnabled,
    setTranslationTarget,
    setScreenshotHotkey,
    resetSession,
  } = useAppStore();

  useEffect(() => {
    if (!statusReadyRef.current) {
      statusReadyRef.current = true;
      return;
    }
    void emit("talkflow://status", { message: statusMsg });
  }, [statusMsg]);

  useEffect(() => {
    // `cancelled` flag handles React StrictMode double-mount:
    // StrictMode: mount → cleanup (cancelled=true) → re-mount.
    // Without this flag, the first mount's async listeners never get cleaned
    // up because `unlisten` is still empty when cleanup runs synchronously.
    let cancelled = false;
    const unlisten: Array<() => void> = [];
    let qaInteracting = false;
    let lastSelectionFingerprint = "";
    let suppressedSelectionFingerprint = "";
    let selectionWatchSuppressedUntil = 0;
    let pendingHotkeyReleaseAt = 0;
    let qaHideTimer: ReturnType<typeof setTimeout> | null = null;

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
      const backendHotkeys = await invoke<RegisteredHotkeys>("get_registered_hotkeys").catch((err) => {
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
        await invoke("change_hotkey", { hotkeyStr: initialTriggerHotkey }).catch((err) => {
          console.warn("[App] change_hotkey init failed, keeping stored value:", err);
        });
      }
      if (!backendHotkeys || backendHotkeys.screenshotHotkey !== initialScreenshotHotkey) {
        await invoke("change_screenshot_hotkey", { hotkeyStr: initialScreenshotHotkey }).catch((err) => {
          console.warn("[App] change_screenshot_hotkey init failed:", err);
        });
      }
      await invoke("set_runtime_stt_config", {
        engine: normalizeSttEngine(String(hydratedStore.sttEngine)),
        modelPath: hydratedStore.sttModelPath,
        sttLanguage: normalizeSttLanguage(hydratedStore.sttLanguage),
      }).catch((err) => {
        console.warn("[App] set_runtime_stt_config init failed:", err);
      });
      await invoke("set_audio_device", {
        name: hydratedStore.microphoneSource ?? "",
      }).catch((err) => {
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
          await invoke("stop_recording", {
            engine: normalizedSttEngine,
            modelPath: normalizedSttEngine === "localWhisper" ? store.sttModelPath : "",
            sttLanguage: normalizeSttLanguage(store.sttLanguage),
          });
          store.setIsRecording(false);
          pendingHotkeyReleaseAt = 0;
          setStatusMsg(t("status.recognizing"));
        } catch (err) {
          console.error("[App] stop_recording failed:", err);
          store.setSttError(String(err));
          store.setIsRecording(false);
          pendingHotkeyReleaseAt = 0;
          setStatusMsg(t("status.stopRecordingFailed"));
        }
      };

      await safeRegister<{ active: boolean }>(
        "talkflow://qa-interacting",
        async (event) => {
          qaInteracting = !!event.payload.active;
          if (qaInteracting && qaHideTimer) {
            clearTimeout(qaHideTimer);
            qaHideTimer = null;
          }
          if (Date.now() < selectionWatchSuppressedUntil) {
            return;
          }
          if (!qaInteracting) {
            const sel = await invoke<{ has_selection: boolean }>("get_selection");
              if (!sel.has_selection) {
                lastSelectionFingerprint = "";
                suppressedSelectionFingerprint = "";
                await hideWindowByLabel("quick-action");
              }
            }
          }
        );

      await safeRegister<{ cooldownMs?: number }>("talkflow://qa-suppress-current-selection", async (event) => {
        suppressedSelectionFingerprint = lastSelectionFingerprint;
        selectionWatchSuppressedUntil = Date.now() + Math.max(300, event.payload.cooldownMs ?? 1200);
        await hideWindowByLabel("quick-action");
      });

      await safeRegister<{
        mode: "A" | "B1" | "B2" | "C";
        selectedText?: string;
        instruction?: string;
      }>("talkflow://llm-session-context", (event) => {
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
        microphoneSource?: string;
        launchOnStartup?: boolean;
        quickActionCommands?: Array<{ id: string; label: string; instruction: string }>;
        historyEnabled?: boolean;
        translationTarget?: TranslationTarget;
        screenshotHotkey?: string;
      }>(
        "talkflow://settings-saved",
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
            void invoke("set_runtime_stt_config", {
              engine: normalizeSttEngine(payload.sttEngine ?? "openAi"),
              modelPath: typeof payload.sttModelPath === "string" ? payload.sttModelPath : "",
              sttLanguage: normalizeSttLanguage(payload.sttLanguage),
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
          if (payload.llmModelOptions) {
            setLlmModelOptions(payload.llmModelOptions);
          }
          if (payload.language) {
            setLanguage(payload.language);
          }
          if (payload.preferredLanguage) {
            setPreferredLanguage(payload.preferredLanguage);
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
          if (payload.translationTarget) {
            setTranslationTarget(payload.translationTarget);
          }
          if (typeof payload.screenshotHotkey === "string") {
            setScreenshotHotkey(payload.screenshotHotkey);
          }
          setStatusMsg(t("status.settingsUpdated"));
          setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 2000);
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
          if (Date.now() < selectionWatchSuppressedUntil) {
            return;
          }
          if (!store.selectionEnabled) {
            lastSelectionFingerprint = "";
            suppressedSelectionFingerprint = "";
            await hideWindowByLabel("quick-action");
            return;
          }

          // Don't show Quick Action Icon while recording
          if (store.isRecording) return;
          // Freeze watcher-driven UI updates while quick-action is interacting.
          if (qaInteracting) return;
          // Ignore internal selections from TalkFlow windows (preview/quick-action/etc).
          if (await isAnyTalkFlowWindowFocused()) return;

          const qaWin = await WebviewWindow.getByLabel("quick-action");
          if (!qaWin) return;

          if (has_selection) {
            if (qaHideTimer) {
              clearTimeout(qaHideTimer);
              qaHideTimer = null;
            }
            const selectionText = (text ?? "").trim();
            setSelectedText(selectionText);
            if (selectionText) {
              await emit("talkflow://stable-selection", { text: selectionText });
            }

            // Position QA icon below selection end (fallback to cursor).
            const x = typeof anchor_x === "number" ? anchor_x : cursor_x;
            const y = typeof anchor_y === "number" ? anchor_y : cursor_y;
            const currentFingerprint = buildSelectionFingerprint(selectionText, anchor_x, anchor_y);
            if (suppressedSelectionFingerprint) {
              if (currentFingerprint === suppressedSelectionFingerprint) {
                lastSelectionFingerprint = currentFingerprint;
                return;
              }
              suppressedSelectionFingerprint = "";
            }
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
            suppressedSelectionFingerprint = "";
            if (qaInteracting) return;
            if (qaHideTimer) {
              clearTimeout(qaHideTimer);
            }
            qaHideTimer = setTimeout(() => {
              qaHideTimer = null;
              if (qaInteracting) return;
              void (async () => {
                const sel = await invoke<{ has_selection: boolean }>("get_selection").catch(() => ({ has_selection: false }));
                if (!sel.has_selection) {
                  await qaWin.hide().catch(() => {});
                }
              })();
            }, 180);
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
        if (!store.sttEnabled) {
          setStatusMsg(t("status.sttFeatureDisabled"));
          setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 1500);
          return;
        }

        // ── New session ──
        const { has_selection, selected_text } = event.payload;
        if (import.meta.env.DEV) console.log("[App] talkflow://mode-start", event.payload);

        resetSession();

        if (has_selection && selected_text && store.selectionEnabled) {
          // ── Mode B2 ── hide Quick Action Icon, start recording
          setSelectedText(selected_text);
          setCurrentMode("B2");
          setStatusMsg(t("status.selectionRecording"));

          // Hide Quick Action Icon if it was shown by selection watcher
          const qaWin = await WebviewWindow.getByLabel("quick-action");
          if (qaWin) {
            qaInteracting = false;
            await qaWin.hide();
          }

          // Check API key before starting (for OpenAI engine)
          const sttEngine = normalizeSttEngine(store.sttEngine);
          if (sttEngine === "openAi") {
            const hasKey = await invoke<boolean>("has_stt_api_key");
            if (!hasKey) {
              pendingHotkeyReleaseAt = 0;
              setSttError(t("error.sttApiKeyRequired"));
              setStatusMsg(t("status.setupSttApiKey"));
              return;
            }
          }

          try {
            await invoke("start_recording");
            // Start streaming partial transcription
            invoke("start_streaming_stt", {
              engine: sttEngine,
              modelPath: sttEngine === "localWhisper" ? store.sttModelPath : "",
            }).catch((e) => console.warn("[App] streaming STT start failed:", e));
            setIsRecording(true);
            if (pendingHotkeyReleaseAt > 0 && Date.now() - pendingHotkeyReleaseAt < 800) {
              await stopRecordingNow();
            } else {
              pendingHotkeyReleaseAt = 0;
            }
          } catch (err) {
            console.error("[App] start_recording failed:", err);
            setSttError(String(err));
            setStatusMsg(t("status.recordingStartFailed"));
            pendingHotkeyReleaseAt = 0;
          }
        } else {
          // ── Mode A or C ── start recording
          // Check API key before starting (for OpenAI engine)
          const sttEngine = normalizeSttEngine(store.sttEngine);
          if (sttEngine === "openAi") {
            const hasKey = await invoke<boolean>("has_stt_api_key");
            if (!hasKey) {
              pendingHotkeyReleaseAt = 0;
              setSttError(t("error.sttApiKeyRequired"));
              setStatusMsg(t("status.setupSttApiKey"));
              return;
            }
          }

          setCurrentMode("A");
          setStatusMsg(t("status.recordingReleaseToStop"));
          try {
            await invoke("start_recording");
            // Start streaming partial transcription
            invoke("start_streaming_stt", {
              engine: sttEngine,
              modelPath: sttEngine === "localWhisper" ? store.sttModelPath : "",
            }).catch((e) => console.warn("[App] streaming STT start failed:", e));
            setIsRecording(true);
            if (pendingHotkeyReleaseAt > 0 && Date.now() - pendingHotkeyReleaseAt < 800) {
              await stopRecordingNow();
            } else {
              pendingHotkeyReleaseAt = 0;
            }
          } catch (err) {
            console.error("[App] start_recording failed:", err);
            setSttError(String(err));
            setStatusMsg(t("status.recordingStartFailed"));
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

      await safeRegister("hotkey://screenshot", async () => {
        const store = useAppStore.getState();
        if (store.isRecording) {
          return;
        }
        if (!store.screenshotEnabled) {
          setStatusMsg(t("status.screenshotFeatureDisabled"));
          setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 1500);
          return;
        }
        try {
          const overlayWin = await WebviewWindow.getByLabel("screenshot-overlay");
          const monitor = await currentMonitor();
          if (overlayWin && monitor) {
            const scale = monitor.scaleFactor;
            // monitor.size returns physical pixels; LogicalSize needs logical pixels.
            await overlayWin.setSize(new LogicalSize(
              monitor.size.width / scale,
              monitor.size.height / scale
            ));
            await overlayWin.setPosition(
              new PhysicalPosition(monitor.position.x, monitor.position.y)
            );
            await overlayWin.show();
            await overlayWin.setFocus();
            await emitTo("screenshot-overlay", "talkflow://screenshot-start");
            setStatusMsg(t("status.screenshotDragHint"));
          } else {
            setStatusMsg(t("status.screenshotUnavailable"));
          }
        } catch (err) {
          console.error("[App] screenshot overlay open failed:", err);
          setStatusMsg(t("status.screenshotOpenFailed"));
        }
      });

      await safeRegister<{ x: number; y: number; w: number; h: number; cancelled?: boolean }>(
        "talkflow://screenshot-region",
        async (event) => {
          const overlayWin = await WebviewWindow.getByLabel("screenshot-overlay");
          if (overlayWin) {
            await overlayWin.hide().catch(() => { });
          }
          const store = useAppStore.getState();
          if (event.payload.cancelled) {
            setStatusMsg(t("status.screenshotCancelled"));
            setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 1200);
            return;
          }
          if (store.incognito) {
            setStatusMsg(t("status.screenshotDisabledIncognito"));
            setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 2000);
            return;
          }
          if (store.llmProvider !== "ollama") {
            const hasLlmKey = await invoke<boolean>("has_api_key").catch(() => false);
            if (!hasLlmKey) {
              setSttError(t("error.llmApiKeyRequired"));
              setStatusMsg(t("status.screenshotNeedsLlmApiKey"));
              return;
            }
          }
          setStatusMsg(t("status.screenshotCapturing"));
          try {
            const shot = await invoke<{ base64Png?: string; base64_png?: string }>(
              "take_screenshot_region",
              {
                x: event.payload.x,
                y: event.payload.y,
                w: event.payload.w,
                h: event.payload.h,
              }
            );
            const imageBase64 = shot.base64Png ?? shot.base64_png ?? "";
            if (!imageBase64) {
              setStatusMsg(t("status.screenshotNoImage"));
              return;
            }
            // Store the screenshot as a pending attachment instead of sending immediately.
            // NOTE: We must pass the image via a Tauri event because each window
            // has its own Zustand store instance — store state is not shared.
            store.setCurrentMode("C");
            store.setLlmOutput("");
            store.setIsLlmLoading(false);
            store.setLlmError("");
            store.setLastSelectedText("");
            store.setLastInstruction("");
            void invoke("clear_conversation");
            await emitPreviewSession({
              sessionType: "screenshot",
              sourceMode: "C",
              selectedText: "",
              instruction: "",
            });
            await showPreviewWindow({ focusable: true, focus: true });
            // Send the screenshot to the preview window via event
            await emit("talkflow://screenshot-attached", { imageBase64 });
            setStatusMsg(t("status.screenshotAttachedAsk"));
          } catch (err) {
            console.error("[App] screenshot flow failed:", err);
            setStatusMsg(t("status.screenshotFailed"));
          }
        }
      );

      // ── 3. STT final result → route transcript ──
      await safeRegister<{ text: string }>("stt://final", async (event) => {
        const transcript = event.payload.text;
        if (import.meta.env.DEV) console.log("[App] stt://final:", transcript);
        if (!transcript.trim()) {
          setStatusMsg(t("status.noValidSpeech"));
          setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 1500);
          return;
        }

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

          if (import.meta.env.DEV) console.log("[App] route_transcript result:", result);
          const mode = result.mode as "A" | "B2" | "C";
          store.setCurrentMode(mode);

          if (mode === "A") {
            // ── Mode A — inject STT text directly or show preview ──
            let finalText = applyPunctuationMode(result.transcript, store.punctuationMode);
            let usedLlmForModeA = false;
            let postInjectWarning = "";
            const shouldRefine = store.sttOutputStrategy === "llmRefine" && !store.incognito;
            const shouldTranslate =
              store.sttOutputStrategy === "llmRefine" &&
              store.translationTarget &&
              store.translationTarget !== "off" &&
              !store.incognito;
            const llmNeedsApiKey = store.llmProvider !== "ollama";
            let llmReady = true;
            if (llmNeedsApiKey && (shouldRefine || shouldTranslate)) {
              llmReady = await invoke<boolean>("has_api_key").catch(() => false);
            }
            if (shouldRefine && llmReady) {
              try {
                usedLlmForModeA = true;
                setStatusMsg(t("status.llmRefining"));
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
                  preferredLanguage: store.preferredLanguage,
                });
                if (refined?.trim()) {
                  const candidate = stripWrappingQuotes(refined);
                  if (!isLikelyUnexpectedEnglishTranslation(finalText, candidate)) {
                    finalText = candidate;
                  }
                }
              } catch (err) {
                console.warn("[App] call_llm_text failed, fallback to STT output:", err);
                if (isLikelyAuthError(err)) {
                  setSttError(t("error.llmApiKeyRequired"));
                  postInjectWarning = t("status.llmApiMissingSkipRefine");
                } else {
                  const reason = err instanceof Error ? err.message : String(err);
                  setSttError(t("error.llmRefineFailedOriginal", { reason }));
                  postInjectWarning = t("status.llmRefineFailedUsingOriginal");
                }
              }
            } else if (shouldRefine && !llmReady) {
              setSttError(t("error.llmApiKeyRequired"));
              postInjectWarning = t("status.llmApiMissingSkipRefine");
            }
            // Feature 7: Live translation mode
            if (shouldTranslate && llmReady) {
              try {
                usedLlmForModeA = true;
                setStatusMsg(t("status.translating"));
                const translated = await invoke<string>("call_llm_text", {
                  selectedText: finalText,
                  instruction: `Translate to ${store.translationTarget}. Output ONLY the translation, nothing else.`,
                  provider: store.llmProvider,
                  model: store.llmModel,
                  preferredLanguage: store.translationTarget,
                });
                if (translated?.trim()) {
                  finalText = translated.trim();
                }
              } catch (err) {
                console.warn("[App] Translation failed, using original:", err);
                setSttError(t("error.translationFailedOriginal"));
                setStatusMsg(t("status.translationFailedUsingOriginal"));
              }
            } else if (shouldTranslate && !llmReady) {
              setSttError(t("error.translationNeedsLlmApiKey"));
              postInjectWarning = t("status.llmApiMissingOriginalOutput");
            }

            if (store.outputMode === "PreviewStream") {
              store.setLastSelectedText(finalText);
              store.setLastInstruction("");
              await emitPreviewSession({
                sessionType: "text",
                sourceMode: "A",
                selectedText: finalText,
                instruction: "",
              });
              await showPreviewWindow({ focusable: true, focus: true });
              await emitPreviewStaticOutput(finalText);

              if (store.historyEnabled && !store.incognito) {
                void invoke("history_save", {
                  mode: "A",
                  inputText: result.transcript,
                  instruction: "",
                  output: finalText,
                  provider: usedLlmForModeA ? store.llmProvider : "",
                  model: usedLlmForModeA ? store.llmModel : "",
                });
              }

              if (postInjectWarning) {
                setStatusMsg(postInjectWarning);
                setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 3500);
              } else {
                setStatusMsg(t("status.readyHoldHotkey"));
              }
              return;
            }

            setStatusMsg(t("status.injectingText"));
            const ok = await invoke<boolean>("verify_focus");
            if (!ok) {
              setStatusMsg(t("status.focusChangedCancelInject"));
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

            // Feature 3: Save to history
            if (store.historyEnabled && !store.incognito) {
              void invoke("history_save", {
                mode: "A",
                inputText: result.transcript,
                instruction: "",
                output: finalText,
                provider: usedLlmForModeA ? store.llmProvider : "",
                model: usedLlmForModeA ? store.llmModel : "",
              });
            }

            const injectSuccessStatus = usedLlmForModeA
              ? t("status.llmProcessedInjected")
              : t("status.textInjected");
            setStatusMsg(postInjectWarning || injectSuccessStatus);
            setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), postInjectWarning ? 3500 : 2000);
          } else if (mode === "B2") {
            // ── Mode B2 — voice command on selected text ──
            if (store.incognito) {
              setStatusMsg(t("status.incognitoNoLlm"));
              return;
            }
            store.setLlmOutput("");
            store.setIsLlmLoading(true);
            store.setLlmError("");
            store.setLastSelectedText(store.selectedText);
            store.setLastInstruction(result.transcript);
            await emitPreviewSession({
              sessionType: "text",
              sourceMode: "B2",
              selectedText: store.selectedText,
              instruction: result.transcript,
            });
            await showPreviewWindow({ focusable: true, focus: true });

            setStatusMsg(t("status.llmProcessing"));
            try {
              await invoke("call_llm", {
                selectedText: store.selectedText,
                instruction: result.transcript,
                outputMode: "PreviewStream",
                provider: store.llmProvider,
                model: store.llmModel,
                preferredLanguage: store.preferredLanguage,
              });
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              store.setIsLlmLoading(false);
              store.setLlmError(reason);
              await invoke("restore_clipboard").catch(() => {});
              setStatusMsg(t("status.routeFailed", { reason }));
              setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 2500);
            }
          } else if (mode === "C") {
            // ── Mode C — LLM query ──
            if (store.incognito) {
              setStatusMsg(t("status.incognitoNoLlm"));
              return;
            }
            store.setLlmOutput("");
            store.setIsLlmLoading(true);
            store.setLlmError("");
            store.setLastInstruction(result.transcript);
            if (store.outputMode === "PreviewStream") {
              await emitPreviewSession({
                sessionType: "text",
                sourceMode: "C",
                selectedText: "",
                instruction: result.transcript,
              });
              await showPreviewWindow({ focusable: true, focus: true });
            }

            setStatusMsg(t("status.llmProcessing"));
            try {
              await invoke("call_llm", {
                selectedText: "",
                instruction: result.transcript,
                outputMode: store.outputMode,
                provider: store.llmProvider,
                model: store.llmModel,
                preferredLanguage: store.preferredLanguage,
              });
              if (store.outputMode === "DirectInject") {
                await invoke("restore_clipboard");
                setStatusMsg(t("status.textInjected"));
                setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 2000);
              }
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              store.setIsLlmLoading(false);
              store.setLlmError(reason);
              await invoke("restore_clipboard").catch(() => {});
              setStatusMsg(t("status.routeFailed", { reason }));
              setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 2500);
            }
          }
        } catch (err) {
          console.error("[App] route_transcript error:", err);
          setStatusMsg(t("status.routeFailed", { reason: String(err) }));
        }
      });

      // ── 3.5. History save on LLM done (Feature 3) ──
      await safeRegister("llm://done", () => {
        const s = useAppStore.getState();
        if (s.llmOutput.trim() && !s.incognito && s.historyEnabled) {
          const mode = s.currentMode || "C";
          void invoke("history_save", {
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
        setStatusMsg(t("status.sttError", { reason: event.payload.message }));
      });

      // ── 5. Undo result ──
      await safeRegister<{ success: boolean; reason?: string }>(
        "talkflow://undo-result",
        (event) => {
          if (event.payload.success) {
            setStatusMsg(t("status.undoSuccess"));
          } else {
            setStatusMsg(t("status.undoFailed", { reason: event.payload.reason ?? "" }));
          }
          setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 2000);
        }
      );
    })();

    return () => {
      cancelled = true;
      if (qaHideTimer) {
        clearTimeout(qaHideTimer);
      }
      unlisten.forEach((fn) => fn());
    };
  }, [setSttLanguage]);
}
