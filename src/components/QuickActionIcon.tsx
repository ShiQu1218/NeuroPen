/**
 * Quick Action Icon
 *
 * Phase 4 implementation:
 * - Appears near the mouse cursor when text selection is detected (selection://detected event)
 * - Hover expands to show preset commands + custom input
 * - Clicking a preset triggers Mode B1 LLM call via `call_llm` Tauri command
 * - Silently absent when UI Automation is unavailable
 */

const PRESETS = [
  { id: "translate", label: "翻譯成英文" },
  { id: "summarize", label: "摘要" },
  { id: "grammar", label: "修正語法" },
  { id: "formalize", label: "正式化" },
] as const;

export default function QuickActionIcon() {
  return (
    <div className="flex flex-col gap-1 p-2 bg-white border border-gray-200 rounded-lg shadow-lg text-sm">
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          className="text-left px-3 py-1.5 rounded hover:bg-blue-50 hover:text-blue-700 transition-colors"
          disabled
          // TODO Phase 4: invoke("call_llm", { preset: preset.id, ... })
        >
          {preset.label}
        </button>
      ))}

      <div className="flex items-center gap-1 mt-1 border-t border-gray-100 pt-1">
        <input
          className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs outline-none"
          placeholder="自訂指令…"
          disabled
        />
        <button className="text-blue-500 disabled:opacity-40 text-xs" disabled>
          →
        </button>
      </div>
    </div>
  );
}
