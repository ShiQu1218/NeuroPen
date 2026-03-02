import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { useAppStore, type QuickActionCommand } from "../store/useAppStore";

const ICON_SIZE = { width: 40, height: 40 };
const EXPANDED_SIZE = { width: 220, height: 260 };

export default function QuickActionIcon() {
  const outputMode = useAppStore((s) => s.outputMode);
  const llmProvider = useAppStore((s) => s.llmProvider);
  const llmModel = useAppStore((s) => s.llmModel);
  const quickActionCommands = useAppStore((s) => s.quickActionCommands);
  const [expanded, setExpanded] = useState(false);
  const [iconVisible, setIconVisible] = useState(true);
  const [customInput, setCustomInput] = useState("");
  const [isInputFocused, setIsInputFocused] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeRaf = useRef<number | null>(null);
  const stableSelectionRef = useRef("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const setQaInteracting = useCallback(async (active: boolean) => {
    await emit("talkflow://qa-interacting", { active });
  }, []);

  useEffect(() => {
    let unlistenSelection: (() => void) | null = null;
    let unlistenQaShow: (() => void) | null = null;
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
      void setQaInteracting(false);
    };
  }, [setQaInteracting]);

  const expand = useCallback(() => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    if (!expanded) {
      setExpanded(true);
      getCurrentWindow()
        .setSize(new LogicalSize(EXPANDED_SIZE.width, EXPANDED_SIZE.height))
        .catch(() => {});
    }
    void setQaInteracting(true);
  }, [expanded, setQaInteracting]);

  const collapse = useCallback((force = false) => {
    if (isInputFocused && !force) return;
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
      await emit("talkflow://preview-session", {
        selectedText,
        instruction,
      });
      const previewWin = await WebviewWindow.getByLabel("preview");
      if (previewWin) {
        const previewX = pointer
          ? Math.round(qaPos.x + pointer.x * scaleFactor - 12)
          : qaPos.x;
        const previewY = pointer
          ? Math.round(qaPos.y + pointer.y * scaleFactor + 12)
          : qaPos.y + qaSize.height + 4;
        await previewWin.setPosition(new PhysicalPosition(previewX, previewY));
        await previewWin.show();
        await previewWin.setFocus();
      }
    }

    await invoke("call_llm", {
      selectedText,
      instruction,
      outputMode,
      provider: llmProvider,
      model: llmModel,
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
      <p className="px-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">快速操作</p>
      {quickActionCommands.length === 0 ? (
        <p className="px-2 py-1 text-xs text-slate-400">請到設定新增快捷指令</p>
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
          placeholder="自訂指令…"
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
