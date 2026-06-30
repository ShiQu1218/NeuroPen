import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { useI18n } from "../i18n";
import { mainWindowService } from "../services/mainWindowService";
import {
  useAppStore,
  type AppLanguage,
  type AppProfile,
  type CustomLanguageVariant,
  type PreferredLanguage,
  type QuickActionCommand,
  type ThemePreference,
} from "../store/useAppStore";
import {
  buildOtherPreferenceCategory,
  buildQuickActionPreferenceCategory,
  composePromptOverride,
  generatePreferenceRequestId,
} from "../utils/preferenceLearning";
import { resolveAppProfile } from "../utils/appText";
import {
  mergeLanguageVariantPreferences,
  resolveLanguageVariantPromptInstructionForText,
} from "../utils/languageVariants";
import { PREVIEW_DEFAULT_SIZE } from "../utils/previewLayout";
import { emitPreviewSession, showPreviewWindow } from "../utils/previewWindow";
import {
  buildAttachmentInstruction,
  resolveRetainedDocumentInstruction,
  type PreviewAttachment,
} from "../utils/previewAttachments";
import { clampToMonitorBounds } from "../utils/windowBounds";

const ICON_SIZE = { width: 40, height: 40 };
const EXPANDED_SIZE = { width: 220, height: 260 };

function toPreviewAttachmentFromCommand(
  attachment: NonNullable<QuickActionCommand["attachments"]>[number],
): PreviewAttachment {
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

export default function QuickActionIcon() {
  const quickActionCommands = useAppStore((s) => s.quickActionCommands);
  const visibleQuickActionCommands = quickActionCommands.filter(
    (command) => command.action !== "documentUpload" || (command.attachments?.length ?? 0) > 0,
  );
  const setQuickActionCommands = useAppStore((s) => s.setQuickActionCommands);
  const setOutputMode = useAppStore((s) => s.setOutputMode);
  const setLlmProvider = useAppStore((s) => s.setLlmProvider);
  const setLlmModel = useAppStore((s) => s.setLlmModel);
  const setLlmModelOptions = useAppStore((s) => s.setLlmModelOptions);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setThemePreference = useAppStore((s) => s.setThemePreference);
  const setPreferredLanguage = useAppStore((s) => s.setPreferredLanguage);
  const setCustomLanguageVariants = useAppStore((s) => s.setCustomLanguageVariants);
  const setModeAPrompt = useAppStore((s) => s.setModeAPrompt);
  const setModeBPrompt = useAppStore((s) => s.setModeBPrompt);
  const setModeCPrompt = useAppStore((s) => s.setModeCPrompt);
  const setModeAStreamOutput = useAppStore((s) => s.setModeAStreamOutput);
  const setModeBStreamOutput = useAppStore((s) => s.setModeBStreamOutput);
  const setContextAwareTone = useAppStore((s) => s.setContextAwareTone);
  const setPreferenceLearningEnabled = useAppStore((s) => s.setPreferenceLearningEnabled);
  const setAppProfiles = useAppStore((s) => s.setAppProfiles);
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [iconVisible, setIconVisible] = useState(true);
  const [animKey, setAnimKey] = useState(0);
  const [customInput, setCustomInput] = useState("");
  const [isInputFocused, setIsInputFocused] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeRaf = useRef<number | null>(null);
  const dragLockUntil = useRef(0);
  const stableSelectionRef = useRef("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const setWindowFocusable = useCallback(async (focusable: boolean, focus = false) => {
    const win = getCurrentWindow();
    await win.setFocusable(focusable).catch(() => { });
    if (focusable && focus) {
      await win.setFocus().catch(() => { });
    }
  }, []);
  const setQaInteracting = useCallback(async (active: boolean) => {
    await emit("neuropen://qa-interacting", { active });
  }, []);
  const pinSelectionAnchor = useCallback((cooldownMs = 1800) => {
    void emit("neuropen://qa-pin-selection-anchor", { cooldownMs });
  }, []);

  useEffect(() => {
    let unlistenSelection: (() => void) | null = null;
    let unlistenQaShow: (() => void) | null = null;
    let unlistenSettings: (() => void) | null = null;
    void (async () => {
      unlistenSelection = await listen<{ text: string }>(
        "neuropen://stable-selection",
        (event) => {
          stableSelectionRef.current = event.payload.text ?? "";
        }
      );
      unlistenQaShow = await listen("neuropen://qa-show", () => {
        if (fadeRaf.current !== null) {
          cancelAnimationFrame(fadeRaf.current);
        }
        setIconVisible(false);
        setAnimKey((k) => k + 1);
        fadeRaf.current = requestAnimationFrame(() => {
          setIconVisible(true);
          fadeRaf.current = null;
        });
      });
      unlistenSettings = await listen<{
        outputMode?: "DirectInject" | "PreviewStream";
        llmProvider?: "openAi" | "gemini" | "claude" | "grok" | "openRouter" | "ollama" | "llamaCpp" | "lmStudio" | "qwen" | "doubao" | "deepseek";
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
        quickActionCommands?: QuickActionCommand[];
        preferenceLearningEnabled?: boolean;
        appProfiles?: AppProfile[];
      }>(
        "neuropen://settings-saved",
        (event) => {
          if (event.payload.outputMode) {
            setOutputMode(event.payload.outputMode);
          }
          if (event.payload.llmProvider) {
            setLlmProvider(event.payload.llmProvider);
          }
          if (event.payload.llmModel) {
            setLlmModel(event.payload.llmModel);
          }
          if (event.payload.llmModelOptions) {
            setLlmModelOptions(event.payload.llmModelOptions);
          }
          if (event.payload.language) {
            setLanguage(event.payload.language);
          }
          if (event.payload.themePreference) {
            setThemePreference(event.payload.themePreference);
          }
          if (event.payload.customLanguageVariants) {
            setCustomLanguageVariants(event.payload.customLanguageVariants);
          }
          if (event.payload.preferredLanguage) {
            setPreferredLanguage(event.payload.preferredLanguage);
          }
          if (typeof event.payload.modeAPrompt === "string") {
            setModeAPrompt(event.payload.modeAPrompt);
          }
          if (typeof event.payload.modeBPrompt === "string") {
            setModeBPrompt(event.payload.modeBPrompt);
          }
          if (typeof event.payload.modeCPrompt === "string") {
            setModeCPrompt(event.payload.modeCPrompt);
          }
          if (typeof event.payload.modeAStreamOutput === "boolean") {
            setModeAStreamOutput(event.payload.modeAStreamOutput);
          }
          if (typeof event.payload.modeBStreamOutput === "boolean") {
            setModeBStreamOutput(event.payload.modeBStreamOutput);
          }
          // Quick Action resolves app-profile prompt appendix at invoke time, so its
          // local store must receive profile changes immediately after Apply.
          if (typeof event.payload.contextAwareTone === "boolean") {
            setContextAwareTone(event.payload.contextAwareTone);
          }
          if (event.payload.quickActionCommands) {
            setQuickActionCommands(event.payload.quickActionCommands);
          }
          if (typeof event.payload.preferenceLearningEnabled === "boolean") {
            setPreferenceLearningEnabled(event.payload.preferenceLearningEnabled);
          }
          if (event.payload.appProfiles) {
            setAppProfiles(event.payload.appProfiles);
          }
        }
      );
    })();
    return () => {
      if (collapseTimer.current) {
        clearTimeout(collapseTimer.current);
      }
      if (fadeRaf.current !== null) {
        cancelAnimationFrame(fadeRaf.current);
      }
      unlistenSelection?.();
      unlistenQaShow?.();
      unlistenSettings?.();
      void setWindowFocusable(false);
      void setQaInteracting(false);
    };
  }, [setAppProfiles, setContextAwareTone, setCustomLanguageVariants, setLanguage, setLlmModel, setLlmModelOptions, setLlmProvider, setModeAPrompt, setModeAStreamOutput, setModeBPrompt, setModeBStreamOutput, setModeCPrompt, setOutputMode, setPreferenceLearningEnabled, setPreferredLanguage, setQaInteracting, setQuickActionCommands, setThemePreference, setWindowFocusable]);

  useEffect(() => {
    void setWindowFocusable(false);
  }, [setWindowFocusable]);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  }, []);

  const expand = useCallback(() => {
    clearCollapseTimer();
    if (!expanded) {
      setExpanded(true);
      void setQaInteracting(true);
      void (async () => {
        try {
          const win = getCurrentWindow();
          await win.setSize(new LogicalSize(EXPANDED_SIZE.width, EXPANDED_SIZE.height));
          const pos = await win.outerPosition();
          const clamped = await clampToMonitorBounds(pos.x, pos.y, EXPANDED_SIZE.width, EXPANDED_SIZE.height);
          await win.setPosition(new PhysicalPosition(clamped.x, clamped.y));
        } catch {
          // noop
        }
      })();
    }
  }, [expanded]);

  const scheduleCollapse = useCallback(function scheduleCollapse(force = false) {
    const remainingDragLockMs = dragLockUntil.current - Date.now();
    clearCollapseTimer();
    // Window dragging can fire mouseleave before the native drag loop ends. Retry
    // after the lock expires so qa-interacting does not stay stuck at true.
    if (remainingDragLockMs > 0) {
      collapseTimer.current = setTimeout(() => {
        collapseTimer.current = null;
        scheduleCollapse(force);
      }, remainingDragLockMs + 16);
      return;
    }
    collapseTimer.current = setTimeout(() => {
      collapseTimer.current = null;
      if (Date.now() < dragLockUntil.current) {
        scheduleCollapse(force);
        return;
      }
      if (panelRef.current?.matches(":hover")) {
        void setQaInteracting(true);
        return;
      }
      if (isInputFocused && !force) {
        return;
      }
      setExpanded(false);
      setCustomInput("");
      void setWindowFocusable(false);
      void setQaInteracting(false);
      getCurrentWindow()
        .setSize(new LogicalSize(ICON_SIZE.width, ICON_SIZE.height))
        .catch(() => { });
    }, 180);
  }, [clearCollapseTimer, isInputFocused, setQaInteracting, setWindowFocusable]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const postExpandHoverCheck = setTimeout(() => {
      // A fast pointer sweep can expand the panel without ever delivering a
      // follow-up leave event on the mounted panel. Collapse it if nothing hovers it.
      if (!panelRef.current?.matches(":hover")) {
        scheduleCollapse();
      }
    }, 32);
    return () => clearTimeout(postExpandHoverCheck);
  }, [expanded, scheduleCollapse]);

  const resolveSelectedText = async () => {
    let selectedText = stableSelectionRef.current.trim();
    try {
      if (!selectedText) {
        const sel = await invoke<{ has_selection: boolean; text: string | null }>("get_selection");
        if (sel.has_selection && sel.text) {
          selectedText = sel.text;
        }
      }
    } catch (err) {
      console.error("[QuickAction] Failed to safely get selection:", err);
    }
    return selectedText;
  };

  const showPreviewAndCallLlm = async (
    instruction: string,
    command?: QuickActionCommand,
    pointer?: { x: number; y: number },
    retainedAttachments: PreviewAttachment[] = [],
  ) => {
    const currentState = useAppStore.getState();
    const llmOutputMode = "PreviewStream";
    const selectedText = await resolveSelectedText();

    if (!selectedText) {
      await setQaInteracting(false);
      return;
    }

    await emit("neuropen://qa-suppress-current-selection", { cooldownMs: 1600 });
    await mainWindowService.clearConversation().catch((err) => {
      console.warn("[QuickAction] clear_conversation failed before LLM call:", err);
    });
    const attachments = retainedAttachments;
    const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
    const instructionToSend = buildAttachmentInstruction(instruction, selectedText, attachments);
    const category = command
      ? buildQuickActionPreferenceCategory(command)
      : buildOtherPreferenceCategory(t("history.preferenceOther"));
    const requestId = generatePreferenceRequestId();
    let b1LanguagePreferences = currentState.preferredLanguage;
    let b1PreferredLanguage = resolveLanguageVariantPromptInstructionForText(
      `${selectedText}\n${instructionToSend}`,
      b1LanguagePreferences,
      currentState.customLanguageVariants
    );
    let promptAppendix = "";
    if (currentState.contextAwareTone) {
      try {
        const windowTitle = await invoke<string>("get_foreground_window_title");
        const profileB1 = resolveAppProfile(windowTitle, currentState.appProfiles, "B1");
        if (profileB1) {
          b1LanguagePreferences = mergeLanguageVariantPreferences(
            currentState.preferredLanguage,
            profileB1.preferredLanguage,
            currentState.customLanguageVariants
          );
          b1PreferredLanguage = resolveLanguageVariantPromptInstructionForText(
            `${selectedText}\n${instructionToSend}`,
            b1LanguagePreferences,
            currentState.customLanguageVariants
          );
          promptAppendix = profileB1.promptAppendix || "";
        }
      } catch {
        // ignore — profile resolution is best-effort
      }
    }
    await emit("neuropen://llm-session-context", {
      mode: "B1",
      selectedText,
      instruction,
      requestId,
      preferenceCategoryKey: category.key,
      preferenceCategoryLabel: category.label,
      quickActionCommandId: category.quickActionCommandId,
    });
    const qaWindow = getCurrentWindow();
    const [qaPos, qaSize, scaleFactor] = await Promise.all([
      qaWindow.outerPosition(),
      qaWindow.outerSize(),
      qaWindow.scaleFactor(),
    ]);
    await setWindowFocusable(false);
    await setQaInteracting(false);
    await qaWindow.hide();
    setExpanded(false);

    // Selection-based flows always use the preview workflow; the global
    // LLM output mode only applies to direct voice input and wake-word mode.
    await emitPreviewSession({
      sessionType: "text",
      sourceMode: "B1",
      selectedText,
      instruction,
      promptAppendix,
      preferredLanguage: b1PreferredLanguage,
      requestId,
      preferenceCategoryKey: category.key,
      preferenceCategoryLabel: category.label,
      quickActionCommandId: category.quickActionCommandId,
      attachments,
    });
    const previewX = pointer
      ? Math.round(qaPos.x + pointer.x * scaleFactor - 12)
      : qaPos.x;
    const previewY = pointer
      ? Math.round(qaPos.y + pointer.y * scaleFactor + 12)
      : qaPos.y + qaSize.height + 4;
    await showPreviewWindow({
      focusable: false,
      size: PREVIEW_DEFAULT_SIZE,
      position: {
        x: previewX,
        y: previewY,
      },
    });
    const learnedSummary =
      currentState.preferenceLearningEnabled
        ? await mainWindowService.preferenceGetSummary(category.key).catch(() => null)
        : null;
    const b1PromptOverride = composePromptOverride(
      currentState.modeBPrompt,
      promptAppendix,
      learnedSummary ?? "",
    );

    try {
      if (imageAttachments.length > 0) {
        await mainWindowService.callLlmWithImages({
          instruction: instructionToSend,
          images: imageAttachments.map((attachment) => ({
            imageBase64: attachment.base64Data,
            imageMimeType: attachment.mimeType,
          })),
          outputMode: llmOutputMode,
          provider: currentState.llmProvider,
          model: currentState.llmModel,
          preferredLanguage: b1PreferredLanguage,
          promptMode: "B",
          promptOverride: b1PromptOverride,
          streamOutput: currentState.modeBStreamOutput,
          requestId,
        });
      } else {
        await mainWindowService.callLlm({
          selectedText,
          instruction: instructionToSend,
          outputMode: llmOutputMode,
          provider: currentState.llmProvider,
          model: currentState.llmModel,
          preferredLanguage: b1PreferredLanguage,
          promptMode: "B",
          promptOverride: b1PromptOverride,
          streamOutput: currentState.modeBStreamOutput,
          requestId,
        });
      }
    } catch (err) {
      console.error("[QuickAction] call_llm failed:", err);
      useAppStore.getState().setLlmError(String(err));
    } finally {
      // Fallback in case llm://done event is missed.
      useAppStore.getState().setIsLlmLoading(false);
    }
  };

  const invokeCommand = async (
    command: QuickActionCommand,
    pointer?: { x: number; y: number }
  ) => {
    const retainedAttachments = (command.attachments ?? []).map(toPreviewAttachmentFromCommand);
    if (retainedAttachments.length > 0) {
      await showPreviewAndCallLlm(
        resolveRetainedDocumentInstruction(command.instruction),
        command,
        pointer,
        retainedAttachments,
      );
      return;
    }
    await showPreviewAndCallLlm(command.instruction, command, pointer);
  };

  const invokeCustom = async (pointer?: { x: number; y: number }) => {
    const instruction = customInput.trim();
    if (!instruction) return;
    await showPreviewAndCallLlm(instruction, undefined, pointer);
  };

  const handleStartDrag = async () => {
    dragLockUntil.current = Date.now() + 1500;
    try {
      await getCurrentWindow().startDragging();
    } finally {
      dragLockUntil.current = Date.now() + 180;
    }
  };

  if (!expanded) {
    return (
      <div
        key={animKey}
        className={`flex items-center justify-center w-[36px] h-[36px] cursor-pointer transition-all duration-200 ease-out animate-scaleUp ${iconVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"
          }`}
        onMouseEnter={expand}
        onClick={expand}
      >
        <img
          src="/brand-icon.svg"
          alt=""
          aria-hidden="true"
          className="h-[34px] w-[34px] rounded-[9px] shadow-[0_10px_24px_rgba(0,0,0,0.18)] select-none"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="flex h-screen flex-col gap-2 overflow-hidden rounded-2xl border border-zinc-200/60 bg-white p-2.5 text-sm shadow-[0_22px_50px_rgba(0,0,0,0.18)] animate-scaleUp backdrop-blur-xl dark:border-zinc-700 dark:bg-zinc-950/92 dark:text-zinc-100"
      onMouseEnter={() => {
        clearCollapseTimer();
        void setQaInteracting(true);
      }}
      onMouseLeave={() => {
        void setQaInteracting(true);
        scheduleCollapse();
      }}
    >
      <div
        className="cursor-move select-none px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button,input,textarea")) return;
          void handleStartDrag();
        }}
      >
        {t("quickAction.title")}
      </div>
      {visibleQuickActionCommands.length === 0 ? (
        <p className="px-2 py-1 text-xs text-slate-400 dark:text-zinc-500">{t("quickAction.empty")}</p>
      ) : (
        <div className="max-h-[170px] overflow-y-auto space-y-1">
          {visibleQuickActionCommands.map((command) => {
            const retainedAttachmentCount = command.attachments?.length ?? 0;
            const hasRetainedAttachments = retainedAttachmentCount > 0;
            return (
              <button
                key={command.id}
                className="flex w-full items-center gap-2 rounded-xl border border-zinc-200/60 bg-white/80 px-3 py-1.5 text-left transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/80 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                onMouseDown={() => pinSelectionAnchor()}
                onClick={(e) =>
                  invokeCommand(command, { x: e.clientX, y: e.clientY })
                }
              >
                {hasRetainedAttachments && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0 text-zinc-500 dark:text-zinc-300"
                  >
                    <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.48-8.48" />
                  </svg>
                )}
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {hasRetainedAttachments && (
                  <span className="shrink-0 rounded-full bg-zinc-200 px-1.5 text-[10px] leading-4 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
                    {retainedAttachmentCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-1 flex items-center gap-1.5 border-t border-slate-100 pt-2 dark:border-zinc-800">
        <input
          className="flex-1 bg-white/90 px-2.5 py-1.5 text-xs input-field dark:bg-zinc-900/90"
          placeholder={t("quickAction.customPlaceholder")}
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onMouseDown={() => {
            void setWindowFocusable(true, true);
          }}
          onFocus={() => {
            setIsInputFocused(true);
            void setQaInteracting(true);
          }}
          onBlur={() => {
            setIsInputFocused(false);
            void setWindowFocusable(false);
            if (!panelRef.current?.matches(":hover")) {
              scheduleCollapse(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") invokeCustom();
          }}
        />
        <button
          className="btn-primary px-2.5 py-1.5 text-xs"
          disabled={!customInput.trim()}
          onMouseDown={() => pinSelectionAnchor()}
          onClick={(e) => invokeCustom({ x: e.clientX, y: e.clientY })}
        >
          →
        </button>
      </div>
    </div>
  );
}
