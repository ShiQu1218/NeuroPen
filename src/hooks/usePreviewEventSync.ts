import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useAppStore, type AppLanguage, type PreferredLanguage, type QuickActionCommand } from "../store/useAppStore";
import type { PreviewSourceMode } from "../utils/previewWindow";
import type { PreviewAttachment } from "../utils/previewAttachments";

const PREVIEW_WIDTH = 480;
const PREVIEW_MIN_HEIGHT = 340;

export interface PreviewSession {
  type: "text" | "screenshot";
  selectedText: string;
  sourceMode: PreviewSourceMode;
  instruction: string;
  attachments: PreviewAttachment[];
}

interface UsePreviewEventSyncOptions {
  fallbackTtsActiveRef: MutableRefObject<boolean>;
  keepPreviewInBounds: (width: number, height: number) => Promise<void>;
  setAnimKey: Dispatch<SetStateAction<number>>;
  setPreviewSession: Dispatch<SetStateAction<PreviewSession | null>>;
}

export function usePreviewEventSync({
  fallbackTtsActiveRef,
  keepPreviewInBounds,
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

      await register<{ text: string }>("llm://token", (event) => {
        const currentState = useAppStore.getState();
        // Record time-to-first-token once, then keep appending incremental output.
        if (currentState.llmOutput === "" && llmStartTime > 0) {
          currentState.setLlmDurationMs(Date.now() - llmStartTime);
        }
        currentState.setLlmOutput(currentState.llmOutput + event.payload.text);
      });

      await register("llm://done", () => {
        const currentState = useAppStore.getState();
        if (llmStartTime > 0) {
          currentState.setLlmDurationMs(Date.now() - llmStartTime);
        }
        currentState.setIsLlmLoading(false);
      });

      await register<{ message: string }>("llm://error", (event) => {
        const currentState = useAppStore.getState();
        currentState.setLlmError(event.payload.message);
        currentState.setIsLlmLoading(false);
      });

      await register<{
        selectedText?: string;
        instruction?: string;
        sessionType?: "text" | "screenshot";
        sourceMode?: PreviewSourceMode;
        startLoading?: boolean;
      }>("neuropen://preview-session", (event) => {
        const startLoading = event.payload.startLoading ?? true;
        llmStartTime = startLoading ? Date.now() : 0;
        void invoke("clear_conversation");
        // Every preview session starts from a known window size so old long answers
        // do not leave the next session oversized before new content arrives.
        void (async () => {
          try {
            await getCurrentWindow().setSize(
              new LogicalSize(PREVIEW_WIDTH, PREVIEW_MIN_HEIGHT)
            );
            await keepPreviewInBounds(PREVIEW_WIDTH, PREVIEW_MIN_HEIGHT);
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
          });
          return;
        }
        setPreviewSession({
          type: "text",
          selectedText: event.payload.selectedText ?? "",
          sourceMode: event.payload.sourceMode ?? "C",
          instruction: event.payload.instruction ?? "",
          attachments: [],
        });
      });

      await register<{ text: string }>("neuropen://preview-static-output", (event) => {
        const currentState = useAppStore.getState();
        currentState.setLlmOutput(event.payload.text ?? "");
        currentState.setIsLlmLoading(false);
        currentState.setLlmError("");
      });

      await register<{
        llmProvider?: "openAi" | "gemini" | "claude" | "grok" | "ollama" | "qwen" | "doubao" | "deepseek";
        llmModel?: string;
        llmModelOptions?: string[];
        language?: AppLanguage;
        preferredLanguage?: PreferredLanguage;
        modeAPrompt?: string;
        modeBPrompt?: string;
        modeCPrompt?: string;
        modeAStreamOutput?: boolean;
        modeBStreamOutput?: boolean;
        ttsVoice?: string;
        ttsRate?: string;
        ttsPitch?: string;
        quickActionCommands?: QuickActionCommand[];
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
  }, [fallbackTtsActiveRef, keepPreviewInBounds, setAnimKey, setPreviewSession]);
}
