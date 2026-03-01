import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";

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
  const [expanded, setExpanded] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, [expanded]);

  const collapse = useCallback(() => {
    // Delay collapse to avoid flicker when moving between icon and panel
    collapseTimer.current = setTimeout(() => {
      setExpanded(false);
      setCustomInput("");
      getCurrentWindow()
        .setSize(new LogicalSize(ICON_SIZE.width, ICON_SIZE.height))
        .catch(() => {});
    }, 200);
  }, []);

  const showPreviewAndCallLlm = async (instruction: string) => {
    // Fetch selectedText directly from Rust (cross-window store won't work)
    let selectedText = "";
    try {
      const sel = await invoke<{ has_selection: boolean; text: string | null }>("get_selection");
      if (sel.has_selection && sel.text) {
        selectedText = sel.text;
      } else {
        // Fallback: read via clipboard (Ctrl+C)
        const clipText = await invoke<string>("read_selection_clipboard");
        selectedText = clipText;
      }
    } catch (err) {
      console.error("[QuickAction] Failed to get selection:", err);
    }

    if (!selectedText) {
      console.warn("[QuickAction] No selected text found, aborting");
      return;
    }

    // Hide quick-action icon
    await getCurrentWindow().hide();

    // Reset icon state for next time
    setExpanded(false);
    setCustomInput("");

    // Get current window position so we can position preview below
    const qaPos = await getCurrentWindow().outerPosition();
    const qaSize = await getCurrentWindow().outerSize();

    // Show preview window positioned below the quick action icon
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

    // Call LLM
    await invoke("call_llm", {
      selectedText,
      instruction,
      outputMode: "PreviewStream",
    });
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
        className="flex items-center justify-center w-[36px] h-[36px] bg-white border border-gray-200 rounded-full shadow-lg cursor-pointer hover:bg-blue-50 transition-colors"
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
      className="flex flex-col gap-1 p-2 bg-white border border-gray-200 rounded-lg shadow-lg text-sm"
      onMouseLeave={collapse}
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
