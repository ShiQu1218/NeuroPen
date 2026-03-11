import { useEffect, useRef, useState, useCallback } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { usePreviewDragGuard } from "./usePreviewDragGuard";
import { usePreviewEventSync, type PreviewSession } from "./usePreviewEventSync";
import { usePreviewTts } from "./usePreviewTts";
import { useI18n } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { mainWindowService, type LoadedAttachment } from "../services/mainWindowService";
import type { PreviewAttachment } from "../utils/previewAttachments";
import { clampToMonitorBounds } from "../utils/windowBounds";

const PREVIEW_WIDTH = 480;
const PREVIEW_MIN_HEIGHT = 340;
const PREVIEW_MAX_HEIGHT = 620;
const PREVIEW_CHROME_HEIGHT = 240;

function toPreviewAttachment(attachment: LoadedAttachment): PreviewAttachment {
  if (attachment.kind === "image") {
    return {
      kind: "image",
      name: attachment.name,
      mimeType: attachment.mimeType ?? attachment.mime_type ?? "image/png",
      base64Data: attachment.base64Data ?? attachment.base64_data ?? "",
      source: "file",
    };
  }
  return {
    kind: "text",
    name: attachment.name,
    mimeType: attachment.mimeType ?? attachment.mime_type ?? "text/plain",
    textContent: attachment.textContent ?? attachment.text_content ?? "",
    truncated: attachment.truncated,
    source: "file",
  };
}

function buildAttachmentInstruction(
  input: string,
  selectedText: string,
  attachment: PreviewAttachment | null
) {
  if (!attachment) {
    return input;
  }
  if (attachment.kind === "image") {
    if (!selectedText.trim()) {
      return input;
    }
    return `Selected text for context:\n${selectedText}\n\nUser request:\n${input}`;
  }
  const truncatedNote = attachment.truncated
    ? "\n\nNote: The attached file was truncated to fit within the chat context."
    : "";
  return [
    `Attached file: ${attachment.name}`,
    `Type: ${attachment.mimeType}`,
    "",
    "File content:",
    '"""',
    attachment.textContent,
    '"""',
    truncatedNote,
    "",
    "User request:",
    input,
  ]
    .filter((part) => part !== "")
    .join("\n");
}

export function usePreviewWindowController() {
  const [refinementInput, setRefinementInput] = useState("");
  const [previewSession, setPreviewSession] = useState<PreviewSession | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const [toastMessage, setToastMessage] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);
  const outputContentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const { t } = useI18n();

  const llmOutput = useAppStore((state) => state.llmOutput);
  const isLlmLoading = useAppStore((state) => state.isLlmLoading);
  const llmError = useAppStore((state) => state.llmError);
  const quickActionCommands = useAppStore((state) => state.quickActionCommands);
  const modeAPrompt = useAppStore((state) => state.modeAPrompt);
  const modeBPrompt = useAppStore((state) => state.modeBPrompt);
  const modeCPrompt = useAppStore((state) => state.modeCPrompt);
  const modeAStreamOutput = useAppStore((state) => state.modeAStreamOutput);
  const modeBStreamOutput = useAppStore((state) => state.modeBStreamOutput);
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

  const resolveStreamingForPreviewMode = useCallback(
    (sourceMode: PreviewSession["sourceMode"] | undefined) => {
      switch (sourceMode) {
        case "A":
          return modeAStreamOutput;
        case "B1":
        case "B2":
          return modeBStreamOutput;
        case "C":
        default:
          return true;
      }
    },
    [modeAStreamOutput, modeBStreamOutput]
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

  const showToast = useCallback((message: string, durationMs = 1600) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage("");
      toastTimerRef.current = null;
    }, durationMs);
  }, []);

  const runPreviewInstruction = useCallback(
    async (instruction: string) => {
      const state = useAppStore.getState();
      const input = instruction.trim();
      if (!input) return;
      const selectedText = previewSession?.type === "text" ? previewSession.selectedText : "";
      const sourceMode = previewSession?.sourceMode ?? "C";
      const attachment = previewSession?.attachment ?? null;
      const imageAttachment = attachment?.kind === "image" ? attachment : null;
      const instructionToSend = buildAttachmentInstruction(input, selectedText, attachment);
      const { promptMode, promptOverride } = resolvePromptForPreviewMode(sourceMode);
      const streamOutput = resolveStreamingForPreviewMode(sourceMode);
      await emit("neuropen://llm-session-context", {
        mode: sourceMode,
        selectedText,
        instruction: input,
      });
      setLlmOutput("");
      setIsLlmLoading(true);
      setLlmError("");
      try {
        if (imageAttachment) {
          await invoke("call_llm_with_image", {
            imageBase64: imageAttachment.base64Data,
            imageMimeType: imageAttachment.mimeType,
            instruction: instructionToSend,
            outputMode: "PreviewStream",
            provider: state.llmProvider,
            model: state.llmModel,
            preferredLanguage: state.preferredLanguage,
            promptMode,
            promptOverride,
            streamOutput,
          });
        } else {
          await invoke("call_llm", {
            selectedText,
            instruction: instructionToSend,
            outputMode: "PreviewStream",
            provider: state.llmProvider,
            model: state.llmModel,
            preferredLanguage: state.preferredLanguage,
            promptMode,
            promptOverride,
            streamOutput,
          });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        setIsLlmLoading(false);
        setLlmError(reason);
      } finally {
        // Fallback: if backend done/error event is missed, ensure UI exits loading state.
        setIsLlmLoading(false);
      }
    },
    [previewSession, resolvePromptForPreviewMode, resolveStreamingForPreviewMode, setIsLlmLoading, setLlmError, setLlmOutput]
  );

  const handleAttachFile = useCallback(async () => {
    const win = getCurrentWindow();
    await win.setAlwaysOnTop(false).catch(() => { });
    await setPreviewFocusable(true, true);
    try {
      const loaded = await mainWindowService.pickAttachment();
      const nextAttachment = toPreviewAttachment(loaded);
      setPreviewSession((current) => ({
        type: current?.type === "screenshot" ? "text" : (current?.type ?? "text"),
        selectedText: current?.selectedText ?? "",
        sourceMode: current?.sourceMode ?? "C",
        instruction: current?.instruction ?? "",
        attachment: nextAttachment,
      }));
      setLlmError("");
      showToast(t("preview.attachmentReady"));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason && reason !== "No file selected.") {
        setLlmError(reason || t("preview.attachmentReadFailed"));
      }
    } finally {
      await win.setAlwaysOnTop(true).catch(() => { });
      await setPreviewFocusable(true, true);
    }
  }, [setLlmError, setPreviewFocusable, showToast, t]);

  const handleRemoveAttachment = useCallback(() => {
    setPreviewSession((current) =>
      current
        ? {
            ...current,
            type: current.type === "screenshot" ? "text" : current.type,
            attachment: null,
          }
        : current
    );
  }, []);

  useEffect(() => {
    void setPreviewFocusable(false);
  }, [setPreviewFocusable]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setRefinementInput("");
  }, [previewSession]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      const dispose = await listen("neuropen://preview-focus-input", () => {
        inputRef.current?.focus();
      });
      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

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
    showToast(t("preview.copySuccess"));
  }, [llmOutput, showToast, t]);

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
    showToast(t("preview.replaceSuccess"), 900);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await getCurrentWindow().hide();
  }, [llmOutput, setLlmError, showToast, t]);

  const handleClose = useCallback(async () => {
    stopFallbackTts();
    await invoke("tts_stop").catch(() => { });
    await invoke("clear_conversation");
    await setPreviewFocusable(false);
    await getCurrentWindow().setSize(new LogicalSize(PREVIEW_WIDTH, PREVIEW_MIN_HEIGHT));
    await getCurrentWindow().hide();
    setLlmOutput("");
    setIsLlmLoading(false);
    setLlmError("");
    setRefinementInput("");
    setToastMessage("");
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
    attachment: previewSession?.attachment ?? null,
    animKey,
    handleAttachFile,
    handleClose,
    handleCopy,
    handleRefinement,
    handleRemoveAttachment,
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
    setRefinementInput,
    sttDurationMs,
    swallowDragRelease,
    t,
    toastMessage,
  };
}
