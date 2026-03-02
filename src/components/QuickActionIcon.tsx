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
  const outputMode = useAppStore((s) => s.outputMode);
  const llmProvider = useAppStore((s) => s.llmProvider);
  const llmModel = useAppStore((s) => s.llmModel);
  const preferredLanguage = useAppStore((s) => s.preferredLanguage);
  const quickActionCommands = useAppStore((s) => s.quickActionCommands);
  const setQuickActionCommands = useAppStore((s) => s.setQuickActionCommands);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setPreferredLanguage = useAppStore((s) => s.setPreferredLanguage);
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [iconVisible, setIconVisible] = useState(true);
  const [customInput, setCustomInput] = useState("");
  const [isInputFocused, setIsInputFocused] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeRaf = useRef<number | null>(null);
  const dragLockUntil = useRef(0);
  const stableSelectionRef = useRef("");
  const panelRef = useRef<HTMLDivElement | null>(null);
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
        fadeRaf.current = requestAnimationFrame(() => {
          setIconVisible(true);
          fadeRaf.current = null;
        });
      });
      unlistenSettings = await listen<{
        language?: AppLanguage;
        preferredLanguage?: PreferredLanguage;
        quickActionCommands?: Array<{ id: string; label: string; instruction: string }>;
      }>(
        "talkflow://settings-saved",
        (event) => {
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
      void setQaInteracting(false);
    };
  }, [setLanguage, setPreferredLanguage, setQaInteracting, setQuickActionCommands]);

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
      void setQaInteracting(false);
      getCurrentWindow()
        .setSize(new LogicalSize(ICON_SIZE.width, ICON_SIZE.height))
        .catch(() => {});
    }, 200);
  }, [isInputFocused, setQaInteracting]);

  const showPreviewAndCallLlm = async (
    instruction: string,
    pointer?: { x: number; y: number }
  ) => {
    let selectedText = stableSelectionRef.current.trim();
    try {
      if (!selectedText) {
        const sel = await invoke<{ has_selection: boolean; text: string | null }>("get_selection");
        if (sel.has_selection && sel.text) {
          selectedText = sel.text;
        } else {
          selectedText = await invoke<string>("read_selection_clipboard");
        }
      }
    } catch (err) {
      console.error("[QuickAction] Failed to get selection:", err);
    }

    if (!selectedText) {
      await invoke("restore_clipboard");
      await setQaInteracting(false);
      return;
    }

    await invoke("restore_clipboard");
    await setQaInteracting(false);
    await getCurrentWindow().hide();
    setExpanded(false);

    const qaPos = await getCurrentWindow().outerPosition();
    const qaSize = await getCurrentWindow().outerSize();
    const scaleFactor = await getCurrentWindow().scaleFactor();

    if (outputMode === "PreviewStream") {
      const previewWin = await WebviewWindow.getByLabel("preview");
      if (previewWin) {
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
        await previewWin.setFocus();
      }
      await emit("talkflow://preview-session", {
        selectedText,
        instruction,
      });
    }

    await invoke("call_llm", {
      selectedText,
      instruction,
      outputMode,
      provider: llmProvider,
      model: llmModel,
      preferredLanguage,
    });
    if (outputMode === "DirectInject") {
      await invoke("restore_clipboard");
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
        }, 220);
      }
    }
  };

  if (!expanded) {
    return (
      <div
        className={`flex items-center justify-center w-[36px] h-[36px] bg-white/85 backdrop-blur-md border border-white/80 rounded-full shadow-[0_10px_28px_rgba(0,0,0,0.18)] cursor-pointer transition-all duration-200 ease-out ${
          iconVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"
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
      className="flex flex-col gap-2 p-2.5 bg-white backdrop-blur-xl rounded-2xl border border-zinc-200/60 shadow-[0_22px_50px_rgba(0,0,0,0.18)] text-sm"
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
          onFocus={() => {
            setIsInputFocused(true);
            void setQaInteracting(true);
          }}
          onBlur={() => {
            setIsInputFocused(false);
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
