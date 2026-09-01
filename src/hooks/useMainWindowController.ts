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
import { resolveSttModelReference, useAppStore } from "../store/useAppStore";
import { openAssistantDialog } from "../utils/previewWindow";
import { normalizeSttEngine, normalizeSttLanguage } from "../utils/appText";
import { generatePreferenceRequestId } from "../utils/preferenceLearning";

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
    // The native hotkey events and microphone startup are asynchronous. Keep the
    // physical press state separate from the store so a release that happens
    // during initialization is still honoured after a slow device/API startup.
    let hotkeyHeld = false;
    let recordingStartupInFlight = false;
    let releaseRequestedDuringStartup = false;
    let recordingStopInFlight = false;
    // Keep the target captured for this recording separate from the selection
    // watcher's latest lock. A later QA selection must not retarget its final STT.
    let recordingFocusSessionId: number | undefined;
    const pendingFinalFocusSessionIds: number[] = [];

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
      if (!store.isRecording || recordingStopInFlight) return;
      recordingStopInFlight = true;
      // The backend may emit stt://final or stt://error before this invoke
      // resolves. Queue the captured target before awaiting so that event always
      // consumes the right recording, rather than leaving a stale token for the
      // next final result.
      const stoppedFocusSessionId = recordingFocusSessionId;
      recordingFocusSessionId = undefined;
      if (stoppedFocusSessionId !== undefined) {
        pendingFinalFocusSessionIds.push(stoppedFocusSessionId);
      }
      try {
        const normalizedSttEngine = normalizeSttEngine(store.sttEngine);
        await mainWindowService.stopRecording(
          normalizedSttEngine,
          resolveSttModelReference(normalizedSttEngine, store.sttModelPath),
          normalizeSttLanguage(store.sttLanguage),
        );
        store.setIsRecording(false);
        setStatusMsg(tLive("status.recognizing"));
      } catch (err) {
        // A final/error event may already have consumed this entry. Remove only
        // this recording's still-pending token so a newer final cannot inherit it.
        if (stoppedFocusSessionId !== undefined) {
          const pendingIndex = pendingFinalFocusSessionIds.indexOf(stoppedFocusSessionId);
          if (pendingIndex !== -1) {
            pendingFinalFocusSessionIds.splice(pendingIndex, 1);
          }
        }
        console.error("[App] stop_recording failed:", err);
        store.setSttError(String(err));
        store.setIsRecording(false);
        setStatusMsg(tLive("status.stopRecordingFailed"));
      } finally {
        recordingStopInFlight = false;
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
      const store = useAppStore.getState();
      store.setSttError(tLive("error.sttApiKeyRequired"));
      setStatusMsg(tLive("status.setupSttApiKey"));
      return false;
    };

    const startRecordingCapture = async (focusSessionId?: number) => {
      const store = useAppStore.getState();
      // Avoid opening the microphone at all if the key was released while an
      // earlier preparation step (for example API-key validation) was pending.
      if (!hotkeyHeld || releaseRequestedDuringStartup) {
        return;
      }
      try {
        await mainWindowService.startRecording();
        // Commit this token only after native capture accepted the start. A
        // rejected newer hotkey must not retarget a still-pending final result.
        recordingFocusSessionId = focusSessionId;
        mainWindowService.setActiveFocusSession(focusSessionId);
        store.setIsRecording(true);
        // Do not time-limit this latch: starting some audio devices can take longer
        // than the old 800 ms grace period. Once released, capture must stop even
        // when startup finishes much later.
        if (!hotkeyHeld || releaseRequestedDuringStartup) {
          await stopRecordingNow();
        }
      } catch (err) {
        console.error("[App] start_recording failed:", err);
        store.setSttError(String(err));
        store.setIsRecording(false);
        setStatusMsg(tLive("status.recordingStartFailed"));
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
        requestId?: string;
        sourceRequestId?: string;
        sessionId?: number;
        preferenceCategoryKey?: string;
        preferenceCategoryLabel?: string;
        quickActionCommandId?: string;
      }>("neuropen://llm-session-context", (event) => {
        const store = useAppStore.getState();
        store.setCurrentMode(event.payload.mode);
        store.setLastSelectedText(event.payload.selectedText ?? "");
        store.setLastInstruction(event.payload.instruction ?? "");
        store.setCurrentRequestContext({
          requestId: event.payload.requestId,
          preferenceCategoryKey: event.payload.preferenceCategoryKey,
          preferenceCategoryLabel: event.payload.preferenceCategoryLabel,
          quickActionCommandId: event.payload.quickActionCommandId,
        });
        store.setCurrentFeedbackRating(null);
        const requestId = event.payload.requestId?.trim();
        if (requestId && (event.payload.sourceRequestId || event.payload.sessionId)) {
          void mainWindowService
            .bindFocusSession(
              requestId,
              event.payload.sourceRequestId ? undefined : event.payload.sessionId,
              event.payload.sourceRequestId,
            )
            .catch((err) => console.warn("[App] bind focus session failed:", err));
        }
      });

      await safeRegister<SettingsSavedPayload>(
        "neuropen://settings-saved",
        (event) => {
          applySettingsSavedPayload(event.payload, tLive, setStatusMsg);
        }
      );

      await safeRegister<{ requestId?: string }>(
        "neuropen://cancel-preview-request",
        (event) => {
          const requestId = event.payload.requestId?.trim();
          if (!requestId) {
            return;
          }

          // Ask the backend to drop the matching network task even when this
          // window has already advanced to another request. Its registry also
          // records an early cancellation if the invoke has not registered yet.
          void mainWindowService.cancelLlmRequest(requestId).catch((err) => {
            console.warn("[App] cancel preview request failed:", err);
          });

          const store = useAppStore.getState();
          if (requestId !== store.currentRequestId) {
            return;
          }
          store.setLlmOutput("");
          store.setIsLlmLoading(false);
          store.setLlmError("");
          store.clearCurrentRequestContext();
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
        if (store.isRecording || recordingStartupInFlight) {
          return;
        }
        if (!store.sttEnabled) {
          setStatusMsg(tLive("status.sttFeatureDisabled"));
          setTimeout(() => setStatusMsg(tLive("status.readyHoldHotkey")), 1500);
          return;
        }

        hotkeyHeld = true;
        releaseRequestedDuringStartup = false;
        recordingStartupInFlight = true;
        try {
          // ── New session ──
          const { has_selection, selected_text } = event.payload;
          if (import.meta.env.DEV) console.log("[App] neuropen://mode-start", event.payload);

          resetSession();
          const sttEngine = normalizeSttEngine(store.sttEngine);

          if (has_selection && selected_text && store.selectionEnabled) {
            await prepareSelectionRecording(selected_text);
            if (await ensureSttReady(sttEngine)) {
              await startRecordingCapture(event.payload.sessionId);
            }
          } else {
            store.setCurrentMode("A");
            setStatusMsg(tLive("status.recordingReleaseToStop"));
            if (await ensureSttReady(sttEngine)) {
              await startRecordingCapture(event.payload.sessionId);
            }
          }
        } finally {
          recordingStartupInFlight = false;
          if (!useAppStore.getState().isRecording) {
            releaseRequestedDuringStartup = false;
          }
        }
      });

      // ── 2. hotkey RELEASE → stop recording ──
      await safeRegister("neuropen://hotkey-release", async () => {
        hotkeyHeld = false;
        if (recordingStartupInFlight) {
          releaseRequestedDuringStartup = true;
        }
        console.log("[App] hotkey released → stopping recording");
        await stopRecordingNow();
      });

      await safeRegister("hotkey://dialog", async () => {
        const store = useAppStore.getState();
        if (store.isRecording) {
          return;
        }
        // Capture and bind the app that owned focus before the dialog takes it.
        // The first prompt can then inherit this target just like later refinements.
        const requestId = generatePreferenceRequestId();
        const focus = await mainWindowService.lockWindow();
        await mainWindowService.bindFocusSession(requestId, focus.sessionId);
        store.setCurrentMode("C");
        await openAssistantDialog(requestId);
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
        takeFocusSessionId: () => pendingFinalFocusSessionIds.shift(),
      });

      await safeRegister<{ text: string; outputMode: "DirectInject" | "PreviewStream"; requestId?: string }>(
        "llm://result",
        (event) => {
          const store = useAppStore.getState();
          const requestId = event.payload.requestId?.trim();
          if (!requestId || requestId !== store.currentRequestId) {
            return;
          }
          // The backend emits a final result for both output modes. Keep it in the
          // main-window store so PreviewStream sessions can be persisted even
          // though incremental tokens belong to the Preview window.
          store.setLlmOutput(event.payload.text);

          if (event.payload.text.trim() && !store.incognito && store.historyEnabled) {
            const mode = store.currentMode || "C";
            void mainWindowService.historySave({
              mode,
              inputText: store.lastSelectedText || "",
              instruction: store.lastInstruction || "",
              output: event.payload.text,
              provider: store.llmProvider,
              model: store.llmModel,
              requestId,
              preferenceCategoryKey: store.currentPreferenceCategoryKey || undefined,
              preferenceCategoryLabel: store.currentPreferenceCategoryLabel || undefined,
              quickActionCommandId: store.currentQuickActionCommandId || undefined,
            });
          }
        }
      );

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
        pendingFinalFocusSessionIds.shift();
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
