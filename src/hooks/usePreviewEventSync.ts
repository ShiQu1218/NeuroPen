import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  useAppStore,
  type AppLanguage,
  type AppProfile,
  type CustomLanguageVariant,
  type PreferredLanguage,
  type QuickActionCommand,
  type ThemePreference,
} from "../store/useAppStore";
import type { PreviewSourceMode } from "../utils/previewWindow";
import type { PreviewAttachment } from "../utils/previewAttachments";
import { resetPreviewWindowSize } from "../utils/previewLayout";

export interface PreviewSession {
  type: "text" | "screenshot";
  selectedText: string;
  sourceMode: PreviewSourceMode;
  instruction: string;
  attachments: PreviewAttachment[];
  promptAppendix: string;
  preferredLanguage: string;
  requestId: string;
  preferenceCategoryKey: string;
  preferenceCategoryLabel: string;
  quickActionCommandId?: string;
  feedbackRating: "up" | "down" | null;
}

interface UsePreviewEventSyncOptions {
  fallbackTtsActiveRef: MutableRefObject<boolean>;
  setAnimKey: Dispatch<SetStateAction<number>>;
  setPreviewSession: Dispatch<SetStateAction<PreviewSession | null>>;
}

export function usePreviewEventSync({
  fallbackTtsActiveRef,
  setAnimKey,
  setPreviewSession,
}: UsePreviewEventSyncOptions) {
  useEffect(() => {
    let cancelled = false;
    const unlisten: Array<() => void> = [];
    let llmStartTime = 0;

    const state = useAppStore.getState();

    void (async () => {
      const register = async <T,>(event: string, handler: (e: { payload: T }) => void) => {
        const unlistenEvent = await listen<T>(event, handler);
        if (cancelled) {
          unlistenEvent();
        } else {
          unlisten.push(unlistenEvent);
        }
      };

      await register<{ text: string; requestId?: string }>("llm://token", (event) => {
        const currentState = useAppStore.getState();
        if (
          event.payload.requestId &&
          currentState.currentRequestId &&
          event.payload.requestId !== currentState.currentRequestId
        ) {
          return;
        }
        // Record time-to-first-token once, then keep appending incremental output.
        if (currentState.llmOutput === "" && llmStartTime > 0) {
          currentState.setLlmDurationMs(Date.now() - llmStartTime);
        }
        currentState.setLlmOutput(currentState.llmOutput + event.payload.text);
      });

      await register<{ requestId?: string }>("llm://done", (event) => {
        const currentState = useAppStore.getState();
        if (
          event.payload?.requestId &&
          currentState.currentRequestId &&
          event.payload.requestId !== currentState.currentRequestId
        ) {
          return;
        }
        if (llmStartTime > 0) {
          currentState.setLlmDurationMs(Date.now() - llmStartTime);
        }
        currentState.setIsLlmLoading(false);
      });

      await register<{ message: string; requestId?: string }>("llm://error", (event) => {
        const currentState = useAppStore.getState();
        if (
          event.payload.requestId &&
          currentState.currentRequestId &&
          event.payload.requestId !== currentState.currentRequestId
        ) {
          return;
        }
        currentState.setLlmError(event.payload.message);
        currentState.setIsLlmLoading(false);
      });

      await register<{
        selectedText?: string;
        instruction?: string;
        sessionType?: "text" | "screenshot";
        sourceMode?: PreviewSourceMode;
        startLoading?: boolean;
        promptAppendix?: string;
        preferredLanguage?: string;
        requestId?: string;
        preferenceCategoryKey?: string;
        preferenceCategoryLabel?: string;
        quickActionCommandId?: string;
      }>("neuropen://preview-session", (event) => {
        const startLoading = event.payload.startLoading ?? true;
        llmStartTime = startLoading ? Date.now() : 0;
        void invoke("clear_conversation");
        // Every preview session starts from a known window size so old long answers
        // do not leave the next session oversized before new content arrives.
        void (async () => {
          try {
            await resetPreviewWindowSize();
          } catch (err) {
            console.warn("[Preview] preview-session resize failed:", err);
          }
        })();
        setAnimKey((key) => key + 1);
        const currentState = useAppStore.getState();
        currentState.setLlmOutput("");
        currentState.setIsLlmLoading(startLoading);
        currentState.setLlmError("");
        currentState.setLastSelectedText(event.payload.selectedText ?? "");
        currentState.setLastInstruction(event.payload.instruction ?? "");
        currentState.setLlmDurationMs(0);
        currentState.setCurrentRequestContext({
          requestId: event.payload.requestId,
          preferenceCategoryKey: event.payload.preferenceCategoryKey,
          preferenceCategoryLabel: event.payload.preferenceCategoryLabel,
          quickActionCommandId: event.payload.quickActionCommandId,
        });
        currentState.setCurrentFeedbackRating(null);
        if (event.payload.sessionType === "screenshot") {
          // Screenshot session starts with an attachment preview, not an LLM call yet.
          // Keep loading false even if the follow-up attachment event is delayed/missed.
          currentState.setIsLlmLoading(false);
          setPreviewSession({
            type: "screenshot",
            selectedText: "",
            sourceMode: "C",
            instruction: "",
            attachments: [],
            promptAppendix: event.payload.promptAppendix ?? "",
            preferredLanguage: event.payload.preferredLanguage ?? "",
            requestId: event.payload.requestId ?? "",
            preferenceCategoryKey: event.payload.preferenceCategoryKey ?? "",
            preferenceCategoryLabel: event.payload.preferenceCategoryLabel ?? "",
            quickActionCommandId: event.payload.quickActionCommandId,
            feedbackRating: null,
          });
          return;
        }
        setPreviewSession({
          type: "text",
          selectedText: event.payload.selectedText ?? "",
          sourceMode: event.payload.sourceMode ?? "C",
          instruction: event.payload.instruction ?? "",
          attachments: [],
          promptAppendix: event.payload.promptAppendix ?? "",
          preferredLanguage: event.payload.preferredLanguage ?? "",
          requestId: event.payload.requestId ?? "",
          preferenceCategoryKey: event.payload.preferenceCategoryKey ?? "",
          preferenceCategoryLabel: event.payload.preferenceCategoryLabel ?? "",
          quickActionCommandId: event.payload.quickActionCommandId,
          feedbackRating: null,
        });
      });

      await register<{ text: string }>("neuropen://preview-static-output", (event) => {
        const currentState = useAppStore.getState();
        currentState.setLlmOutput(event.payload.text ?? "");
        currentState.setIsLlmLoading(false);
        currentState.setLlmError("");
      });

      await register<{
        llmProvider?: "openAi" | "gemini" | "claude" | "grok" | "ollama" | "llamaCpp" | "lmStudio" | "qwen" | "doubao" | "deepseek";
        llmModel?: string;
        llmModelOptions?: string[];
        language?: AppLanguage;
        themePreference?: ThemePreference;
        preferredLanguage?: PreferredLanguage;
        customLanguageVariants?: CustomLanguageVariant[];
        modeAPrompt?: string;
        modeBPrompt?: string;
        modeCPrompt?: string;
        modeAStreamOutput?: boolean;
        modeBStreamOutput?: boolean;
        contextAwareTone?: boolean;
        ttsVoice?: string;
        ttsRate?: string;
        ttsPitch?: string;
        quickActionCommands?: QuickActionCommand[];
        preferenceLearningEnabled?: boolean;
        appProfiles?: AppProfile[];
      }>("neuropen://settings-saved", (event) => {
        if (event.payload.llmProvider) {
          state.setLlmProvider(event.payload.llmProvider);
        }
        if (event.payload.llmModel) {
          state.setLlmModel(event.payload.llmModel);
        }
        if (event.payload.llmModelOptions) {
          state.setLlmModelOptions(event.payload.llmModelOptions);
        }
        if (event.payload.language) {
          state.setLanguage(event.payload.language);
        }
        if (event.payload.themePreference) {
          state.setThemePreference(event.payload.themePreference);
        }
        if (event.payload.customLanguageVariants) {
          state.setCustomLanguageVariants(event.payload.customLanguageVariants);
        }
        if (event.payload.preferredLanguage) {
          state.setPreferredLanguage(event.payload.preferredLanguage);
        }
        if (typeof event.payload.modeAPrompt === "string") {
          state.setModeAPrompt(event.payload.modeAPrompt);
        }
        if (typeof event.payload.modeBPrompt === "string") {
          state.setModeBPrompt(event.payload.modeBPrompt);
        }
        if (typeof event.payload.modeCPrompt === "string") {
          state.setModeCPrompt(event.payload.modeCPrompt);
        }
        if (typeof event.payload.modeAStreamOutput === "boolean") {
          state.setModeAStreamOutput(event.payload.modeAStreamOutput);
        }
        if (typeof event.payload.modeBStreamOutput === "boolean") {
          state.setModeBStreamOutput(event.payload.modeBStreamOutput);
        }
        // Preview follow-up requests reuse app-profile and TTS settings from the
        // shared store, so keep this window in sync without requiring a reopen.
        if (typeof event.payload.contextAwareTone === "boolean") {
          state.setContextAwareTone(event.payload.contextAwareTone);
        }
        if (typeof event.payload.ttsVoice === "string") {
          state.setTtsVoice(event.payload.ttsVoice);
        }
        if (typeof event.payload.ttsRate === "string") {
          state.setTtsRate(event.payload.ttsRate);
        }
        if (typeof event.payload.ttsPitch === "string") {
          state.setTtsPitch(event.payload.ttsPitch);
        }
        if (event.payload.quickActionCommands) {
          state.setQuickActionCommands(event.payload.quickActionCommands);
        }
        if (typeof event.payload.preferenceLearningEnabled === "boolean") {
          state.setPreferenceLearningEnabled(event.payload.preferenceLearningEnabled);
        }
        if (event.payload.appProfiles) {
          state.setAppProfiles(event.payload.appProfiles);
        }
      });

      await register("tts://start", () => {
        fallbackTtsActiveRef.current = false;
        useAppStore.getState().setIsTtsPlaying(true);
      });

      await register("tts://done", () => {
        fallbackTtsActiveRef.current = false;
        useAppStore.getState().setIsTtsPlaying(false);
      });

      await register("tts://error", () => {
        fallbackTtsActiveRef.current = false;
        useAppStore.getState().setIsTtsPlaying(false);
      });

      await register<{ imageBase64: string }>("neuropen://screenshot-attached", (event) => {
        // Screenshot mode is attachment-first: the preview opens immediately and the
        // user can ask a follow-up question without triggering an LLM call yet.
        setPreviewSession({
          type: "screenshot",
          selectedText: "",
          sourceMode: "C",
          instruction: "",
          attachments: [{
            kind: "image",
            name: "screenshot.png",
            mimeType: "image/png",
            base64Data: event.payload.imageBase64 || "",
            source: "screenshot",
          }],
          promptAppendix: "",
          preferredLanguage: "",
          requestId: "",
          preferenceCategoryKey: "",
          preferenceCategoryLabel: "",
          quickActionCommandId: undefined,
          feedbackRating: null,
        });
        setAnimKey((key) => key + 1);
        const currentState = useAppStore.getState();
        currentState.setLlmOutput("");
        currentState.setIsLlmLoading(false);
        currentState.setLlmError("");
      });
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, [fallbackTtsActiveRef, setAnimKey, setPreviewSession]);
}
