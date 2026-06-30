import { useEffect, useRef, useState, useCallback } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePreviewDragGuard } from "./usePreviewDragGuard";
import { usePreviewEventSync, type PreviewSession } from "./usePreviewEventSync";
import { usePreviewTts } from "./usePreviewTts";
import { useI18n } from "../i18n";
import { useAppStore, type QuickActionAttachment, type QuickActionCommand } from "../store/useAppStore";
import { mainWindowService, type LoadedAttachment } from "../services/mainWindowService";
import { resolveLanguageVariantPromptInstructionForText } from "../utils/languageVariants";
import {
  buildOtherPreferenceCategory,
  buildQuickActionPreferenceCategory,
  composePromptOverride,
  generatePreferenceRequestId,
  type PreferenceFeedbackRating,
} from "../utils/preferenceLearning";
import {
  DEFAULT_RETAINED_DOCUMENT_INSTRUCTION,
  buildAttachmentInstruction,
  resolveRetainedDocumentInstruction,
  type PreviewAttachment,
} from "../utils/previewAttachments";
import {
  fitPreviewWindowToContent,
  resetPreviewWindowSize,
} from "../utils/previewLayout";

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

function toQuickActionAttachment(attachment: PreviewAttachment): QuickActionAttachment {
  if (attachment.kind === "image") {
    return {
      kind: "image",
      name: attachment.name,
      mimeType: attachment.mimeType,
      base64Data: attachment.base64Data,
    };
  }
  return {
    kind: "text",
    name: attachment.name,
    mimeType: attachment.mimeType,
    textContent: attachment.textContent,
    truncated: attachment.truncated,
  };
}

function toPreviewAttachmentFromCommand(attachment: QuickActionAttachment): PreviewAttachment {
  if (attachment.kind === "image") {
    return {
      ...attachment,
      source: "file",
    };
  }
  return {
    ...attachment,
    source: "file",
  };
}

function buildDocumentCommandLabel(attachments: PreviewAttachment[], fallback: string) {
  if (attachments.length === 1) {
    return attachments[0].name;
  }
  if (attachments.length > 1) {
    return `${fallback} (${attachments.length})`;
  }
  return fallback;
}

function dedupeAttachments(attachments: PreviewAttachment[]) {
  const seen = new Set<string>();
  return attachments.filter((attachment) => {
    // Use a short content fingerprint so repeated drag/drop or picker selections
    // do not duplicate context while avoiding a full hash pass on large files.
    const identity =
      attachment.kind === "image"
        ? `${attachment.kind}:${attachment.name}:${attachment.base64Data.slice(0, 48)}`
        : `${attachment.kind}:${attachment.name}:${attachment.textContent.slice(0, 48)}`;
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

function clearPreviewAttachments(session: PreviewSession | null): PreviewSession | null {
  if (!session || session.attachments.length === 0) {
    return session;
  }
  return {
    ...session,
    attachments: [],
  };
}

export function usePreviewWindowController() {
  const [refinementInput, setRefinementInput] = useState("");
  const [previewSession, setPreviewSession] = useState<PreviewSession | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);
  const outputContentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const keyboardCopyBlockedUntilRef = useRef(0);
  const { t } = useI18n();

  const llmOutput = useAppStore((state) => state.llmOutput);
  const isLlmLoading = useAppStore((state) => state.isLlmLoading);
  const llmError = useAppStore((state) => state.llmError);
  const incognito = useAppStore((state) => state.incognito);
  const preferenceLearningEnabled = useAppStore((state) => state.preferenceLearningEnabled);
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

  // Native window dragging can race with Ctrl+C on release, so keep keyboard copy blocked until pointer activity settles.
  const suppressKeyboardCopy = useCallback((durationMs = 800) => {
    keyboardCopyBlockedUntilRef.current = Math.max(
      keyboardCopyBlockedUntilRef.current,
      Date.now() + durationMs
    );
  }, []);

  const appendLoadedAttachments = useCallback((loadedAttachments: LoadedAttachment[]) => {
    const nextAttachments = loadedAttachments.map(toPreviewAttachment);
    if (nextAttachments.length === 0) {
      return false;
    }
    setPreviewSession((current) => ({
      type: current?.type === "screenshot" ? "text" : (current?.type ?? "text"),
      selectedText: current?.selectedText ?? "",
      sourceMode: current?.sourceMode ?? "C",
      instruction: current?.instruction ?? "",
      attachments: dedupeAttachments([...(current?.attachments ?? []), ...nextAttachments]),
      promptAppendix: current?.promptAppendix ?? "",
      preferredLanguage: current?.preferredLanguage ?? "",
      requestId: current?.requestId ?? "",
      preferenceCategoryKey: current?.preferenceCategoryKey ?? "",
      preferenceCategoryLabel: current?.preferenceCategoryLabel ?? "",
      quickActionCommandId: current?.quickActionCommandId,
      feedbackRating: current?.feedbackRating ?? null,
    }));
    setLlmError("");
    return true;
  }, [setLlmError]);

  const runPreviewInstruction = useCallback(
    async (
      instruction: string,
      options?: { command?: QuickActionCommand; attachments?: PreviewAttachment[] },
    ) => {
      const state = useAppStore.getState();
      const input = instruction.trim();
      if (!input) return;
      const selectedText = previewSession?.type === "text" ? previewSession.selectedText : "";
      const sourceMode = previewSession?.sourceMode ?? "C";
      const attachments = options?.attachments ?? previewSession?.attachments ?? [];
      const attachmentsSnapshot = attachments;
      const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
      const instructionToSend = buildAttachmentInstruction(input, selectedText, attachments);
      const { promptMode, promptOverride: basePrompt } = resolvePromptForPreviewMode(sourceMode);
      const streamOutput = resolveStreamingForPreviewMode(sourceMode);
      const sessionCommand = previewSession?.quickActionCommandId
        ? state.quickActionCommands.find((command) => command.id === previewSession.quickActionCommandId)
        : undefined;
      const categoryCommand = options?.command ?? sessionCommand;
      const category = categoryCommand
        ? buildQuickActionPreferenceCategory(categoryCommand)
        : buildOtherPreferenceCategory(t("history.preferenceOther"));
      const requestId = generatePreferenceRequestId();
      const learnedSummary =
        state.preferenceLearningEnabled
          ? await mainWindowService.preferenceGetSummary(category.key).catch(() => null)
          : null;
      const promptOverride = composePromptOverride(
        basePrompt,
        previewSession?.promptAppendix ?? "",
        learnedSummary ?? "",
      );
      const preferredLanguage =
        previewSession?.preferredLanguage.trim() ||
        resolveLanguageVariantPromptInstructionForText(
          `${selectedText}\n${instructionToSend}`,
          state.preferredLanguage,
          state.customLanguageVariants
        );
      // Attachments are one-shot context for the current question. Clear them once
      // the request is launched so follow-up refinements do not resend stale files.
      state.setCurrentRequestContext({
        requestId,
        preferenceCategoryKey: category.key,
        preferenceCategoryLabel: category.label,
        quickActionCommandId: category.quickActionCommandId,
      });
      state.setCurrentFeedbackRating(null);
      setPreviewSession((current) => {
        const next = clearPreviewAttachments(current);
        if (!next) {
          return next;
        }
        return {
          ...next,
          instruction: input,
          promptAppendix: next.promptAppendix,
          preferredLanguage: next.preferredLanguage,
          requestId,
          preferenceCategoryKey: category.key,
          preferenceCategoryLabel: category.label,
          quickActionCommandId: category.quickActionCommandId,
          feedbackRating: null,
        };
      });
      await emit("neuropen://llm-session-context", {
        mode: sourceMode,
        selectedText,
        instruction: input,
        requestId,
        preferenceCategoryKey: category.key,
        preferenceCategoryLabel: category.label,
        quickActionCommandId: category.quickActionCommandId,
      });
      setLlmOutput("");
      setIsLlmLoading(true);
      setLlmError("");
      try {
        if (imageAttachments.length > 0) {
          await mainWindowService.callLlmWithImages({
            instruction: instructionToSend,
            images: imageAttachments.map((attachment) => ({
              imageBase64: attachment.base64Data,
              imageMimeType: attachment.mimeType,
            })),
            outputMode: "PreviewStream",
            provider: state.llmProvider,
            model: state.llmModel,
            preferredLanguage,
            promptMode: promptMode as "A" | "B" | "C",
            promptOverride,
            streamOutput,
            requestId,
          });
        } else {
          await mainWindowService.callLlm({
            selectedText,
            instruction: instructionToSend,
            outputMode: "PreviewStream",
            provider: state.llmProvider,
            model: state.llmModel,
            preferredLanguage,
            promptMode: promptMode as "A" | "B" | "C",
            promptOverride,
            streamOutput,
            requestId,
          });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (attachmentsSnapshot.length > 0) {
          // Restore one-shot attachments when the request fails so the user can
          // retry without re-picking files or losing screenshot context.
          setPreviewSession((current) => {
            if (!current || current.attachments.length > 0) {
              return current;
            }
            return {
              ...current,
              attachments: attachmentsSnapshot,
            };
          });
        }
        setIsLlmLoading(false);
        setLlmError(reason);
      } finally {
        // Fallback: if backend done/error event is missed, ensure UI exits loading state.
        setIsLlmLoading(false);
      }
    },
    [previewSession, resolvePromptForPreviewMode, resolveStreamingForPreviewMode, setIsLlmLoading, setLlmError, setLlmOutput, t]
  );

  const handleRateOutput = useCallback(
    async (rating: PreferenceFeedbackRating) => {
      const state = useAppStore.getState();
      if (
        !previewSession ||
        !previewSession.requestId ||
        !previewSession.preferenceCategoryKey ||
        !llmOutput.trim() ||
        state.incognito ||
        !state.preferenceLearningEnabled
      ) {
        return;
      }

      await mainWindowService.preferenceRateResult({
        requestId: previewSession.requestId,
        rating,
        mode: previewSession.sourceMode,
        inputText: previewSession.selectedText,
        instruction: previewSession.instruction,
        output: llmOutput,
        outputProvider: state.llmProvider,
        outputModel: state.llmModel,
        categoryKey: previewSession.preferenceCategoryKey,
        categoryLabel: previewSession.preferenceCategoryLabel,
        quickActionCommandId: previewSession.quickActionCommandId,
        analysisProvider: state.llmProvider,
        analysisModel: state.llmModel,
        appLanguage: state.language,
      });

      state.setCurrentFeedbackRating(rating);
      setPreviewSession((current) =>
        current
          ? {
              ...current,
              feedbackRating: rating,
            }
          : current
      );
    },
    [llmOutput, previewSession]
  );

  const handleAttachFile = useCallback(async () => {
    const win = getCurrentWindow();
    // Drop always-on-top temporarily so the native picker can appear above the preview window.
    await win.setAlwaysOnTop(false).catch(() => { });
    await setPreviewFocusable(true, true);
    try {
      const { attachments: loadedAttachments, skippedCount } = await mainWindowService.pickAttachments();
      if (appendLoadedAttachments(loadedAttachments)) {
        showToast(t("preview.attachmentReady"));
      } else if (skippedCount > 0) {
        setLlmError(t("preview.attachmentReadFailed"));
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason && reason !== "No file selected.") {
        setLlmError(reason || t("preview.attachmentReadFailed"));
      }
    } finally {
      await win.setAlwaysOnTop(true).catch(() => { });
      await setPreviewFocusable(true, true);
    }
  }, [appendLoadedAttachments, setLlmError, setPreviewFocusable, showToast, t]);

  const handleSaveDocumentQuickAction = useCallback(async () => {
    const win = getCurrentWindow();
    await win.setAlwaysOnTop(false).catch(() => { });
    await setPreviewFocusable(true, true);
    try {
      const { attachments: loadedAttachments, skippedCount } = await mainWindowService.pickAttachments();
      const previewAttachments = loadedAttachments.map(toPreviewAttachment);
      if (previewAttachments.length === 0) {
        if (skippedCount > 0) {
          setLlmError(t("preview.attachmentReadFailed"));
        }
        return;
      }

      appendLoadedAttachments(loadedAttachments);
      const state = useAppStore.getState();
      const commandAttachments = previewAttachments.map(toQuickActionAttachment);
      const nextCommand: QuickActionCommand = {
        id: `document-${Date.now()}`,
        label: buildDocumentCommandLabel(previewAttachments, t("quickAction.uploadDocument")),
        instruction: DEFAULT_RETAINED_DOCUMENT_INSTRUCTION,
        attachments: commandAttachments,
      };
      const nextCommands = [...state.quickActionCommands, nextCommand];
      state.setQuickActionCommands(nextCommands);
      await emit("neuropen://settings-saved", { quickActionCommands: nextCommands });
      showToast(t("preview.documentQuickActionSaved"));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason && reason !== "No file selected.") {
        setLlmError(reason || t("preview.attachmentReadFailed"));
      }
    } finally {
      await win.setAlwaysOnTop(true).catch(() => { });
      await setPreviewFocusable(true, true);
    }
  }, [appendLoadedAttachments, setLlmError, setPreviewFocusable, showToast, t]);

  const handleQuickActionCommand = useCallback(async (command: QuickActionCommand) => {
    const retainedAttachments = command.attachments ?? [];
    if (command.action === "documentUpload" && retainedAttachments.length === 0) {
      await handleSaveDocumentQuickAction();
      return;
    }

    if (retainedAttachments.length > 0) {
      const previewAttachments = retainedAttachments.map(toPreviewAttachmentFromCommand);
      const nextAttachments = dedupeAttachments([...(previewSession?.attachments ?? []), ...previewAttachments]);
      setPreviewSession((current) => ({
        type: current?.type === "screenshot" ? "text" : (current?.type ?? "text"),
        selectedText: current?.selectedText ?? "",
        sourceMode: current?.sourceMode ?? "C",
        instruction: current?.instruction ?? "",
        attachments: dedupeAttachments([...(current?.attachments ?? []), ...previewAttachments]),
        promptAppendix: current?.promptAppendix ?? "",
        preferredLanguage: current?.preferredLanguage ?? "",
        requestId: current?.requestId ?? "",
        preferenceCategoryKey: current?.preferenceCategoryKey ?? "",
        preferenceCategoryLabel: current?.preferenceCategoryLabel ?? "",
        quickActionCommandId: command.id,
        feedbackRating: current?.feedbackRating ?? null,
      }));
      setLlmError("");
      await mainWindowService.clearConversation().catch((err) => {
        console.warn("[Preview] clear_conversation failed before retained document command:", err);
      });
      await runPreviewInstruction(resolveRetainedDocumentInstruction(command.instruction), {
        command,
        attachments: nextAttachments,
      });
      return;
    }
    await runPreviewInstruction(command.instruction, { command });
  }, [handleSaveDocumentQuickAction, previewSession?.attachments, runPreviewInstruction, setLlmError]);

  const handleRemoveAttachment = useCallback((indexToRemove: number) => {
    setPreviewSession((current) =>
      current
        ? {
            ...current,
            type: current.type === "screenshot" ? "text" : current.type,
            attachments: current.attachments.filter((_, index) => index !== indexToRemove),
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
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      const win = getCurrentWindow();
      const dispose = await win.onDragDropEvent(async (event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsFileDragActive(true);
          return;
        }

        if (event.payload.type === "leave") {
          setIsFileDragActive(false);
          return;
        }

        setIsFileDragActive(false);
        const droppedPaths = event.payload.paths.filter((path) => path.trim().length > 0);
        if (droppedPaths.length === 0) {
          return;
        }

        try {
          const { attachments: loadedAttachments, skippedCount } =
            await mainWindowService.loadAttachmentsFromPaths(droppedPaths);
          if (appendLoadedAttachments(loadedAttachments)) {
            showToast(t("preview.attachmentReady"));
          } else if (skippedCount > 0) {
            setLlmError(t("preview.attachmentReadFailed"));
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          setLlmError(reason || t("preview.attachmentReadFailed"));
        }
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
  }, [appendLoadedAttachments, setLlmError, showToast, t]);

  useEffect(() => {
    let cancelled = false;
    const unlistenFns: Array<() => void> = [];

    void (async () => {
      const win = getCurrentWindow();
      const register = async (promise: Promise<() => void>) => {
        const unlisten = await promise;
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenFns.push(unlisten);
      };

      await register(
        win.onResized(() => {
          suppressKeyboardCopy(1200);
        })
      );
      await register(
        win.onMoved(() => {
          suppressKeyboardCopy(1200);
        })
      );
      await register(
        win.onScaleChanged(() => {
          suppressKeyboardCopy(1200);
        })
      );
      await register(
        win.onFocusChanged(({ payload: focused }) => {
          if (!focused) {
            suppressKeyboardCopy(1200);
          }
        })
      );
    })();

    return () => {
      cancelled = true;
      unlistenFns.forEach((unlisten) => unlisten());
    };
  }, [suppressKeyboardCopy]);

  useEffect(() => {
    if (!outputRef.current) {
      return;
    }
    if (!llmOutput.trim()) {
      void (async () => {
        try {
          await resetPreviewWindowSize();
        } catch (err) {
          console.warn("[Preview] reset size failed:", err);
        }
      })();
      return;
    }

    outputRef.current.scrollTop = outputRef.current.scrollHeight;
    void (async () => {
      try {
        await fitPreviewWindowToContent(
          outputContentRef.current,
          outputRef.current,
        );
      } catch (err) {
        console.warn("[Preview] grow size failed:", err);
      }
    })();
  }, [llmOutput, previewSession?.attachments.length]);

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
    await setPreviewFocusable(true, true);
  }, [llmOutput, setLlmError, setPreviewFocusable, showToast, t]);

  const handleClose = useCallback(async () => {
    stopFallbackTts();
    await invoke("tts_stop").catch(() => { });
    await invoke("clear_conversation");
    await setPreviewFocusable(false);
    await resetPreviewWindowSize();
    await getCurrentWindow().hide();
    setLlmOutput("");
    setIsLlmLoading(false);
    setLlmError("");
    setRefinementInput("");
    setToastMessage("");
    setPreviewSession(null);
    useAppStore.getState().clearCurrentRequestContext();
  }, [setIsLlmLoading, setLlmError, setLlmOutput, setPreviewFocusable, stopFallbackTts]);

  const handleRefinement = useCallback(async () => {
    const input = refinementInput.trim();
    if (!input) return;
    setRefinementInput("");
    await runPreviewInstruction(input);
  }, [refinementInput, runPreviewInstruction]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (event.key === "Escape") {
        event.preventDefault();
        void handleClose();
        return;
      }
      if (event.ctrlKey && event.key === "c" && !isEditableTarget && !window.getSelection()?.toString()) {
        if (
          isDragInteractionLocked() ||
          Date.now() < keyboardCopyBlockedUntilRef.current
        ) {
          return;
        }
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
    [handleClose, handleCopy, handleReplace, handleTtsToggle, isDragInteractionLocked]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return {
    attachments: previewSession?.attachments ?? [],
    animKey,
    handleAttachFile,
    handleClose,
    handleCopy,
    handleRateOutput,
    handleRefinement,
    handleRemoveAttachment,
    handleReplace,
    handleQuickActionCommand,
    handleSaveDocumentQuickAction,
    handleStartDrag,
    handleTtsToggle,
    hasOutput: llmOutput.length > 0,
    inputRef,
    isFileDragActive,
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
    suppressKeyboardCopy,
    sttDurationMs,
    swallowDragRelease,
    t,
    toastMessage,
    canRateOutput:
      !!previewSession?.requestId &&
      !!previewSession?.preferenceCategoryKey &&
      !!llmOutput.trim() &&
      !isLlmLoading &&
      !incognito &&
      preferenceLearningEnabled,
    feedbackRating: previewSession?.feedbackRating ?? null,
    feedbackDisabledReason: incognito
      ? t("preview.preferenceDisabledIncognito")
      : !preferenceLearningEnabled
        ? t("preview.preferenceDisabledSetting")
        : "",
  };
}
