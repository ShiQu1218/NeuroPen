import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { useAppStore } from "../store/useAppStore";

const PRESETS = [
  { id: "translate", label: "翻譯成英文" },
  { id: "summarize", label: "摘要" },
  { id: "grammar", label: "修正語法" },
  { id: "formalize", label: "正式化" },
] as const;

const PRESET_INSTRUCTIONS: Record<string, string> = {
  translate: "Translate the selected text to English.",
  summarize: "Summarize the selected text concisely.",
  grammar: "Fix grammar and spelling errors in the selected text.",
  formalize: "Rewrite the selected text in a formal tone.",
};

const ICON_SIZE = { width: 40, height: 40 };
const EXPANDED_SIZE = { width: 220, height: 240 };

export default function QuickActionIcon() {
  const outputMode = useAppStore((s) => s.outputMode);
  const [runtimeOutputMode, setRuntimeOutputMode] = useState(outputMode);
  const [expanded, setExpanded] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [isInputFocused, setIsInputFocused] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableSelectionRef = useRef("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const setQaInteracting = useCallback(async (active: boolean) => {
    await emit("talkflow://qa-interacting", { active });
  }, []);

  useEffect(() => {
    setRuntimeOutputMode(outputMode);
  }, [outputMode]);

  useEffect(() => {
    let unlistenSelection: (() => void) | null = null;
    let unlistenSettings: (() => void) | null = null;
    void (async () => {
      unlistenSelection = await listen<{ text: string }>(
        "talkflow://stable-selection",
        (event) => {
          stableSelectionRef.current = event.payload.text ?? "";
        }
      );
      unlistenSettings = await listen<{ outputMode?: "DirectInject" | "PreviewStream" }>(
        "talkflow://settings-saved",
        (event) => {
          if (event.payload.outputMode) {
            setRuntimeOutputMode(event.payload.outputMode);
          }
        }
      );
    })();
    return () => {
      if (collapseTimer.current) {
        clearTimeout(collapseTimer.current);
      }
      unlistenSelection?.();
      unlistenSettings?.();
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
      // Resize window to fit the expanded panel
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
    // Delay collapse to avoid flicker when moving between icon and panel
    collapseTimer.current = setTimeout(() => {
      setExpanded(false);
      setCustomInput("");
      void setQaInteracting(false);
      getCurrentWindow()
        .setSize(new LogicalSize(ICON_SIZE.width, ICON_SIZE.height))
        .catch(() => {});
    }, 200);
  }, [isInputFocused, setQaInteracting]);

  const showPreviewAndCallLlm = async (instruction: string) => {
    // Fetch selectedText directly from Rust (cross-window store won't work)
    let selectedText = stableSelectionRef.current.trim();
    try {
      if (!selectedText) {
        const sel = await invoke<{ has_selection: boolean; text: string | null }>("get_selection");
        if (sel.has_selection && sel.text) {
          selectedText = sel.text;
        } else {
          // Fallback: read via clipboard (Ctrl+C)
          const clipText = await invoke<string>("read_selection_clipboard");
          selectedText = clipText;
        }
      }
    } catch (err) {
      console.error("[QuickAction] Failed to get selection:", err);
    }

    if (!selectedText) {
      await invoke("restore_clipboard");
      await setQaInteracting(false);
      console.warn("[QuickAction] No selected text found, aborting");
      return;
    }

    // Fallback Ctrl+C may have changed clipboard; restore immediately.
    await invoke("restore_clipboard");
    await setQaInteracting(false);

    // Hide quick-action icon
    await getCurrentWindow().hide();

    // Reset icon state for next time
    setExpanded(false);
    setCustomInput("");

    // Get current window position so we can position preview below
    const qaPos = await getCurrentWindow().outerPosition();
    const qaSize = await getCurrentWindow().outerSize();

    if (runtimeOutputMode === "PreviewStream") {
      // Show preview window positioned below the quick action icon
      await emit("talkflow://preview-session", {
        selectedText,
        instruction,
      });
      const previewWin = await WebviewWindow.getByLabel("preview");
      if (previewWin) {
        const previewX = qaPos.x;
        const previewY = qaPos.y + qaSize.height + 4;
        await previewWin.setPosition(
          new PhysicalPosition(previewX, previewY)
        );
        await previewWin.show();
        await previewWin.setFocus();
      }
    }

    // Call LLM
    await invoke("call_llm", {
      selectedText,
      instruction,
      outputMode: runtimeOutputMode,
    });
    if (runtimeOutputMode === "DirectInject") {
      await invoke("restore_clipboard");
    }
  };

  const invokePreset = async (presetId: string) => {
    const instruction = PRESET_INSTRUCTIONS[presetId];
    await showPreviewAndCallLlm(instruction);
  };

  const invokeCustom = async () => {
    const instruction = customInput.trim();
    if (!instruction) return;
    await showPreviewAndCallLlm(instruction);
  };

  if (!expanded) {
    // Phase 1: Small icon button
    return (
      <div
        className="flex items-center justify-center w-[36px] h-[36px] bg-white rounded-full shadow-lg cursor-pointer hover:bg-blue-50 transition-colors"
        onMouseEnter={expand}
        onClick={expand}
      >
        <span className="text-base leading-none select-none">✦</span>
      </div>
    );
  }

  // Phase 2: Expanded options panel
  return (
    <div
      ref={panelRef}
      className="flex flex-col gap-1 p-2 bg-white rounded-lg shadow-lg text-sm"
      onMouseEnter={expand}
      onMouseLeave={() => collapse()}
    >
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          className="text-left px-3 py-1.5 rounded hover:bg-blue-50 hover:text-blue-700 transition-colors"
          onClick={() => invokePreset(preset.id)}
        >
          {preset.label}
        </button>
      ))}

      <div className="flex items-center gap-1 mt-1 border-t border-gray-100 pt-1">
        <input
          className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs outline-none"
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
          className="text-blue-500 hover:text-blue-700 text-xs disabled:opacity-40"
          disabled={!customInput.trim()}
          onClick={invokeCustom}
        >
          →
        </button>
      </div>
    </div>
  );
}
