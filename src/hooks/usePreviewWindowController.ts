import { useEffect, useRef, useState, useCallback } from "react";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { usePreviewDragGuard } from "./usePreviewDragGuard";
import { usePreviewEventSync, type PreviewSession } from "./usePreviewEventSync";
import { usePreviewTts } from "./usePreviewTts";
import { useI18n } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { clampToMonitorBounds } from "../utils/windowBounds";

const PREVIEW_WIDTH = 480;
const PREVIEW_MIN_HEIGHT = 340;
const PREVIEW_MAX_HEIGHT = 620;
const PREVIEW_CHROME_HEIGHT = 240;

export function usePreviewWindowController() {
  const [refinementInput, setRefinementInput] = useState("");
  const [previewSession, setPreviewSession] = useState<PreviewSession | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const outputRef = useRef<HTMLDivElement>(null);
  const outputContentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const llmOutput = useAppStore((state) => state.llmOutput);
  const isLlmLoading = useAppStore((state) => state.isLlmLoading);
  const llmError = useAppStore((state) => state.llmError);
  const quickActionCommands = useAppStore((state) => state.quickActionCommands);
  const modeAPrompt = useAppStore((state) => state.modeAPrompt);
  const modeBPrompt = useAppStore((state) => state.modeBPrompt);
  const modeCPrompt = useAppStore((state) => state.modeCPrompt);
  const sttDurationMs = useAppStore((state) => state.sttDurationMs);
  const llmDurationMs = useAppStore((state) => state.llmDurationMs);
  const setLlmOutput = useAppStore((state) => state.setLlmOutput);
  const setIsLlmLoading = useAppStore((state) => state.setIsLlmLoading);
  const setLlmError = useAppStore((state) => state.setLlmError);
  const { fallbackTtsActiveRef, handleTtsToggle, isTtsPlaying, stopFallbackTts } = usePreviewTts(llmOutput);

  const resolvePromptForPreviewMode = useCallback(
    (sourceMode: PreviewSession["sourceMode"] | undefined) => {
      switch (sourceMode) {
        case "A":
          return { promptMode: "A", promptOverride: modeAPrompt };
        case "B1":
        case "B2":
          return { promptMode: "B", promptOverride: modeBPrompt };
        case "C":
        default:
          return { promptMode: "C", promptOverride: modeCPrompt };
      }
    },
    [modeAPrompt, modeBPrompt, modeCPrompt]
  );

  const keepPreviewInBounds = useCallback(async (width: number, height: number) => {
    try {
      const win = getCurrentWindow();
      const pos = await win.outerPosition();
      const clamped = await clampToMonitorBounds(pos.x, pos.y, width, height);
      await win.setPosition(new PhysicalPosition(clamped.x, clamped.y));
    } catch (err) {
      console.warn("[Preview] keepPreviewInBounds failed:", err);
    }
  }, []);

  const setPreviewFocusable = useCallback(async (focusable: boolean, focus = false) => {
    const win = getCurrentWindow();
    await win.setFocusable(focusable).catch(() => { });
    if (focusable && focus) {
      await win.setFocus().catch(() => { });
    }
  }, []);

  const { handleStartDrag, isDragInteractionLocked, swallowDragRelease } = usePreviewDragGuard({
    setPreviewFocusable,
  });

  usePreviewEventSync({
    fallbackTtsActiveRef,
    keepPreviewInBounds,
    setAnimKey,
    setPreviewSession,
  });

  const runPreviewInstruction = useCallback(
    async (instruction: string) => {
      const state = useAppStore.getState();
      const input = instruction.trim();
      if (!input) return;
      const selectedText = previewSession?.type === "text" ? previewSession.selectedText : "";
      const sourceMode = previewSession?.sourceMode ?? "C";
      const screenshotToSend = previewSession?.type === "screenshot" ? previewSession.imageBase64 : "";
      const { promptMode, promptOverride } = resolvePromptForPreviewMode(sourceMode);
      await emit("talkflow://llm-session-context", {
        mode: sourceMode,
        selectedText,
        instruction: input,
      });
      if (screenshotToSend && previewSession?.type === "screenshot") {
        setPreviewSession({ ...previewSession, imageBase64: "" });
      }
      setLlmOutput("");
      setIsLlmLoading(true);
      setLlmError("");
      try {
        if (screenshotToSend) {
          await invoke("call_llm_with_image", {
            imageBase64: screenshotToSend,
            instruction: input,
            outputMode: "PreviewStream",
            provider: state.llmProvider,
            model: state.llmModel,
            preferredLanguage: state.preferredLanguage,
            promptMode,
            promptOverride,
          });
        } else {
          await invoke("call_llm", {
            selectedText,
            instruction: input,
            outputMode: "PreviewStream",
            provider: state.llmProvider,
            model: state.llmModel,
            preferredLanguage: state.preferredLanguage,
            promptMode,
            promptOverride,
          });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        setIsLlmLoading(false);
        setLlmError(reason);
      }
    },
    [previewSession, resolvePromptForPreviewMode, setIsLlmLoading, setLlmError, setLlmOutput]
  );

  useEffect(() => {
    void setPreviewFocusable(false);
  }, [setPreviewFocusable]);

  useEffect(() => {
    if (!outputRef.current) {
      return;
    }
    if (!llmOutput.trim()) {
      void (async () => {
        try {
          await getCurrentWindow().setSize(
            new LogicalSize(PREVIEW_WIDTH, PREVIEW_MIN_HEIGHT)
          );
          await keepPreviewInBounds(PREVIEW_WIDTH, PREVIEW_MIN_HEIGHT);
        } catch (err) {
          console.warn("[Preview] reset size failed:", err);
        }
      })();
      return;
    }

    outputRef.current.scrollTop = outputRef.current.scrollHeight;
    const outputHeight = Math.max(
      60,
      outputContentRef.current?.scrollHeight ?? outputRef.current.scrollHeight,
    );
    const nextHeight = Math.min(
      PREVIEW_MAX_HEIGHT,
      Math.max(PREVIEW_MIN_HEIGHT, outputHeight + PREVIEW_CHROME_HEIGHT)
    );
    void (async () => {
      try {
        await getCurrentWindow().setSize(new LogicalSize(PREVIEW_WIDTH, nextHeight));
        await keepPreviewInBounds(PREVIEW_WIDTH, nextHeight);
      } catch (err) {
        console.warn("[Preview] grow size failed:", err);
      }
    })();
  }, [keepPreviewInBounds, llmOutput]);

  const handleCopy = useCallback(async () => {
    await invoke("copy_to_clipboard", { text: llmOutput });
  }, [llmOutput]);

  const handleReplace = useCallback(async () => {
    const restored = await invoke<boolean>("restore_focus");
    if (!restored) {
      setLlmError(t("preview.replaceNoTarget"));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const focusOk = await invoke<boolean>("verify_focus");
    if (!focusOk) {
      setLlmError(t("preview.replaceFocusChanged"));
      await invoke("restore_clipboard");
      return;
    }
    await invoke("inject_text", { text: llmOutput, recordForUndo: true });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await invoke("restore_clipboard");
    await getCurrentWindow().hide();
  }, [llmOutput, setLlmError, t]);

  const handleClose = useCallback(async () => {
    stopFallbackTts();
    await invoke("tts_stop").catch(() => { });
    await invoke("clear_conversation");
    await invoke("restore_clipboard");
    await setPreviewFocusable(false);
    await getCurrentWindow().setSize(new LogicalSize(PREVIEW_WIDTH, PREVIEW_MIN_HEIGHT));
    await getCurrentWindow().hide();
    setLlmOutput("");
    setIsLlmLoading(false);
    setLlmError("");
    setPreviewSession(null);
  }, [setIsLlmLoading, setLlmError, setLlmOutput, setPreviewFocusable, stopFallbackTts]);

  const handleRefinement = useCallback(async () => {
    const input = refinementInput.trim();
    if (!input) return;
    setRefinementInput("");
    await runPreviewInstruction(input);
  }, [refinementInput, runPreviewInstruction]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void handleClose();
        return;
      }
      if (event.ctrlKey && event.key === "c" && !window.getSelection()?.toString()) {
        event.preventDefault();
        void handleCopy();
        return;
      }
      if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        void handleReplace();
        return;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (event.ctrlKey && event.key === "t") {
        event.preventDefault();
        void handleTtsToggle();
      }
    },
    [handleClose, handleCopy, handleReplace, handleTtsToggle]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return {
    animKey,
    handleClose,
    handleCopy,
    handleRefinement,
    handleReplace,
    handleStartDrag,
    handleTtsToggle,
    hasOutput: llmOutput.length > 0,
    inputRef,
    isDragInteractionLocked,
    isLlmLoading,
    isTtsPlaying,
    llmDurationMs,
    llmError,
    llmOutput,
    outputContentRef,
    outputRef,
    previewSession,
    quickActionCommands,
    refinementInput,
    runPreviewInstruction,
    setPreviewFocusable,
    setPreviewSession,
    setRefinementInput,
    sttDurationMs,
    swallowDragRelease,
    t,
  };
}
