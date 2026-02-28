/**
 * Output Preview Window
 *
 * Phase 4 implementation:
 * - Listen to `llm://token` events and stream tokens into the output area
 * - Copy button: write output to clipboard
 * - Replace button: call `inject_text` Tauri command
 * - Close button: hide this window
 * - Refinement input: re-send with additional instruction
 * - Alt+Space while focused: voice input to refinement field
 */
export default function PreviewWindow() {
  return (
    <div className="flex flex-col h-screen bg-white text-gray-900 select-text">
      {/* Output area */}
      <div className="flex-1 overflow-auto p-4 font-mono text-sm whitespace-pre-wrap border-b border-gray-200">
        {/* TODO Phase 4: render streaming llm://token output */}
        <span className="text-gray-400">輸出將在此顯示…</span>
      </div>

      {/* Refinement input */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200">
        <input
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:border-blue-400"
          placeholder="輸入補充指令…"
          disabled
          // TODO Phase 4: wire to LLM re-call
        />
        <button className="text-blue-500 hover:text-blue-700 disabled:opacity-40" disabled>
          →
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex justify-center gap-4 p-3">
        <button
          className="px-4 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-sm disabled:opacity-40"
          disabled
        >
          複製
        </button>
        <button
          className="px-4 py-1.5 rounded bg-blue-500 hover:bg-blue-600 text-white text-sm disabled:opacity-40"
          disabled
        >
          取代
        </button>
        <button
          className="px-4 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-sm"
          // TODO Phase 4: getCurrentWindow().hide()
        >
          關閉
        </button>
      </div>
    </div>
  );
}
