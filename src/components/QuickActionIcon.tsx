import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { useI18n } from "../i18n";
import { useAppStore, type AppLanguage, type PreferredLanguage, type QuickActionCommand } from "../store/useAppStore";
import { clampToMonitorBounds } from "../utils/windowBounds";

const ICON_SIZE = { width: 40, height: 40 };
const EXPANDED_SIZE = { width: 220, height: 260 };
const PREVIEW_INITIAL_SIZE = { width: 340, height: 240 };

export default function QuickActionIcon() {
  const quickActionCommands = useAppStore((s) => s.quickActionCommands);
  const setQuickActionCommands = useAppStore((s) => s.setQuickActionCommands);
  const setOutputMode = useAppStore((s) => s.setOutputMode);
  const setLlmProvider = useAppStore((s) => s.setLlmProvider);
  const setLlmModel = useAppStore((s) => s.setLlmModel);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setPreferredLanguage = useAppStore((s) => s.setPreferredLanguage);
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
    await emit("talkflow://qa-interacting", { active });
  }, []);

  useEffect(() => {
    let unlistenSelection: (() => void) | null = null;
    let unlistenQaShow: (() => void) | null = null;
    let unlistenSettings: (() => void) | null = null;
    void (async () => {
      unlistenSelection = await listen<{ text: string }>(
        "talkflow://stable-selection",
        (event) => {
          stableSelectionRef.current = event.payload.text ?? "";
        }
      );
      unlistenQaShow = await listen("talkflow://qa-show", () => {
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
        llmProvider?: "openAi" | "gemini" | "claude" | "grok" | "ollama" | "qwen" | "doubao" | "deepseek";
        llmModel?: string;
        language?: AppLanguage;
        preferredLanguage?: PreferredLanguage;
        quickActionCommands?: Array<{ id: string; label: string; instruction: string }>;
      }>(
        "talkflow://settings-saved",
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
          if (event.payload.language) {
            setLanguage(event.payload.language);
          }
          if (event.payload.preferredLanguage) {
            setPreferredLanguage(event.payload.preferredLanguage);
          }
          if (event.payload.quickActionCommands) {
            setQuickActionCommands(event.payload.quickActionCommands);
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
  }, [setLanguage, setLlmModel, setLlmProvider, setOutputMode, setPreferredLanguage, setQaInteracting, setQuickActionCommands, setWindowFocusable]);

  useEffect(() => {
    void setWindowFocusable(false);
  }, [setWindowFocusable]);

  const expand = useCallback(() => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    if (!expanded) {
      setExpanded(true);
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
    void setQaInteracting(true);
  }, [expanded, setQaInteracting]);

  const collapse = useCallback((force = false) => {
    if ((isInputFocused || Date.now() < dragLockUntil.current) && !force) return;
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    collapseTimer.current = setTimeout(() => {
      setExpanded(false);
      setCustomInput("");
      void setWindowFocusable(false);
      void setQaInteracting(false);
      getCurrentWindow()
        .setSize(new LogicalSize(ICON_SIZE.width, ICON_SIZE.height))
        .catch(() => { });
    }, 80);
  }, [isInputFocused, setQaInteracting, setWindowFocusable]);

  const showPreviewAndCallLlm = async (
    instruction: string,
    pointer?: { x: number; y: number }
  ) => {
    const currentState = useAppStore.getState();
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

    if (!selectedText) {
      await invoke("restore_clipboard");
      await setQaInteracting(false);
      return;
    }

    await invoke("restore_clipboard");
    await emit("talkflow://qa-suppress-current-selection", { cooldownMs: 1600 });
    await setWindowFocusable(false);
    await setQaInteracting(false);
    await getCurrentWindow().hide();
    setExpanded(false);

    const qaPos = await getCurrentWindow().outerPosition();
    const qaSize = await getCurrentWindow().outerSize();
    const scaleFactor = await getCurrentWindow().scaleFactor();

    if (currentState.outputMode === "PreviewStream") {
      // Emit session event BEFORE showing the window so the animation
      // key changes while the window is still hidden.
      await emit("talkflow://preview-session", {
        selectedText,
        instruction,
      });

      const previewWin = await WebviewWindow.getByLabel("preview");
      if (previewWin) {
        await previewWin.setFocusable(false).catch(() => { });
        await previewWin.setSize(
          new LogicalSize(PREVIEW_INITIAL_SIZE.width, PREVIEW_INITIAL_SIZE.height)
        );
        const previewX = pointer
          ? Math.round(qaPos.x + pointer.x * scaleFactor - 12)
          : qaPos.x;
        const previewY = pointer
          ? Math.round(qaPos.y + pointer.y * scaleFactor + 12)
          : qaPos.y + qaSize.height + 4;
        const previewSize = await previewWin.outerSize();
        const clampedPreviewPos = await clampToMonitorBounds(
          previewX,
          previewY,
          previewSize.width || PREVIEW_INITIAL_SIZE.width,
          previewSize.height || PREVIEW_INITIAL_SIZE.height
        );
        await previewWin.setPosition(new PhysicalPosition(clampedPreviewPos.x, clampedPreviewPos.y));
        await previewWin.show();
      }
    }

    try {
      await invoke("call_llm", {
        selectedText,
        instruction,
        outputMode: currentState.outputMode,
        provider: currentState.llmProvider,
        model: currentState.llmModel,
        preferredLanguage: currentState.preferredLanguage,
      });
      if (currentState.outputMode === "DirectInject") {
        await invoke("restore_clipboard");
      }
    } catch (err) {
      console.error("[QuickAction] call_llm failed:", err);
    }
  };

  const invokeCommand = async (
    command: QuickActionCommand,
    pointer?: { x: number; y: number }
  ) => {
    await showPreviewAndCallLlm(command.instruction, pointer);
  };

  const invokeCustom = async (pointer?: { x: number; y: number }) => {
    const instruction = customInput.trim();
    if (!instruction) return;
    await showPreviewAndCallLlm(instruction, pointer);
  };

  const handleStartDrag = async () => {
    dragLockUntil.current = Date.now() + 1500;
    try {
      await getCurrentWindow().startDragging();
    } finally {
      dragLockUntil.current = Date.now() + 180;
      if (!panelRef.current?.matches(":hover")) {
        setTimeout(() => {
          if (!panelRef.current?.matches(":hover")) {
            collapse();
          }
        }, 120);
      }
    }
  };

  if (!expanded) {
    return (
      <div
        key={animKey}
        className={`flex items-center justify-center w-[36px] h-[36px] bg-white/85 backdrop-blur-md border border-white/80 rounded-full shadow-[0_10px_28px_rgba(0,0,0,0.18)] cursor-pointer transition-all duration-200 ease-out animate-scaleUp ${iconVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"
          }`}
        onMouseEnter={expand}
        onClick={expand}
      >
        <span className="text-lg leading-none select-none text-zinc-700">✦</span>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="flex flex-col gap-2 p-2.5 bg-white backdrop-blur-xl rounded-2xl border border-zinc-200/60 shadow-[0_22px_50px_rgba(0,0,0,0.18)] text-sm animate-scaleUp overflow-hidden h-screen"
      onMouseEnter={expand}
      onMouseLeave={() => collapse()}
    >
      <div
        className="px-1 py-0.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wide cursor-move select-none"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button,input,textarea")) return;
          void handleStartDrag();
        }}
      >
        {t("quickAction.title")}
      </div>
      {quickActionCommands.length === 0 ? (
        <p className="px-2 py-1 text-xs text-slate-400">{t("quickAction.empty")}</p>
      ) : (
        <div className="max-h-[170px] overflow-y-auto space-y-1">
          {quickActionCommands.map((command) => (
            <button
              key={command.id}
              className="w-full text-left px-3 py-1.5 rounded-xl bg-white/80 hover:bg-zinc-100 hover:text-zinc-900 border border-zinc-200/60 transition-colors"
              onClick={(e) =>
                invokeCommand(command, { x: e.clientX, y: e.clientY })
              }
            >
              {command.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 mt-1 border-t border-slate-100 pt-2">
        <input
          className="flex-1 input-field px-2.5 py-1.5 text-xs bg-white/90"
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
              collapse(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") invokeCustom();
          }}
        />
        <button
          className="btn-primary px-2.5 py-1.5 text-xs"
          disabled={!customInput.trim()}
          onClick={(e) => invokeCustom({ x: e.clientX, y: e.clientY })}
        >
          →
        </button>
      </div>
    </div>
  );
}
