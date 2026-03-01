import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

export default function QuickActionIcon() {
  const [customInput, setCustomInput] = useState("");

  const selectedText = useAppStore((s) => s.selectedText);
  const outputMode = useAppStore((s) => s.outputMode);
  const setLlmOutput = useAppStore((s) => s.setLlmOutput);
  const setIsLlmLoading = useAppStore((s) => s.setIsLlmLoading);
  const setLlmError = useAppStore((s) => s.setLlmError);
  const setLastSelectedText = useAppStore((s) => s.setLastSelectedText);
  const setLastInstruction = useAppStore((s) => s.setLastInstruction);

  const invokePreset = async (presetId: string) => {
    const instruction = PRESET_INSTRUCTIONS[presetId];
    setLlmOutput("");
    setIsLlmLoading(true);
    setLlmError("");
    setLastSelectedText(selectedText);
    setLastInstruction(instruction);
    await getCurrentWindow().hide();
    await invoke("call_llm", {
      selectedText,
      instruction,
      outputMode,
    });
  };

  const invokeCustom = async () => {
    const instruction = customInput.trim();
    if (!instruction) return;
    setLlmOutput("");
    setIsLlmLoading(true);
    setLlmError("");
    setLastSelectedText(selectedText);
    setLastInstruction(instruction);
    setCustomInput("");
    await getCurrentWindow().hide();
    await invoke("call_llm", {
      selectedText,
      instruction,
      outputMode,
    });
  };

  return (
    <div className="flex flex-col gap-1 p-2 bg-white border border-gray-200 rounded-lg shadow-lg text-sm">
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
