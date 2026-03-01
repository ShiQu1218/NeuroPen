import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../store/useAppStore";

export default function PreviewWindow() {
  const [refinementInput, setRefinementInput] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);

  const llmOutput = useAppStore((s) => s.llmOutput);
  const isLlmLoading = useAppStore((s) => s.isLlmLoading);
  const llmError = useAppStore((s) => s.llmError);
  const lastSelectedText = useAppStore((s) => s.lastSelectedText);
  const setLlmOutput = useAppStore((s) => s.setLlmOutput);
  const setIsLlmLoading = useAppStore((s) => s.setIsLlmLoading);
  const setLlmError = useAppStore((s) => s.setLlmError);

  // Listen to LLM streaming events
  useEffect(() => {
    let cancelled = false;
    const unlisten: Array<() => void> = [];

    (async () => {
      const register = async <T,>(event: string, handler: (e: { payload: T }) => void) => {
        const u = await listen<T>(event, handler);
        if (cancelled) { u(); } else { unlisten.push(u); }
      };

      await register<{ text: string }>("llm://token", (event) => {
        useAppStore.getState().setLlmOutput(
          useAppStore.getState().llmOutput + event.payload.text
        );
      });
      await register("llm://done", () => {
        useAppStore.getState().setIsLlmLoading(false);
      });
      await register<{ message: string }>("llm://error", (event) => {
        useAppStore.getState().setLlmError(event.payload.message);
        useAppStore.getState().setIsLlmLoading(false);
      });
      await register<{ selectedText?: string; instruction?: string }>(
        "talkflow://preview-session",
        (event) => {
          useAppStore.getState().setLlmOutput("");
          useAppStore.getState().setIsLlmLoading(true);
          useAppStore.getState().setLlmError("");
          useAppStore.getState().setLastSelectedText(event.payload.selectedText ?? "");
          useAppStore.getState().setLastInstruction(event.payload.instruction ?? "");
        }
      );
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [llmOutput]);

  const handleCopy = async () => {
    await invoke("copy_to_clipboard", { text: llmOutput });
  };

  const handleReplace = async () => {
    // Restore focus to the original target window before injecting
    const restored = await invoke<boolean>("restore_focus");
    if (!restored) {
      setLlmError("找不到原始目標視窗，無法取代");
      return;
    }
    // Small delay to let the OS switch focus
    await new Promise((r) => setTimeout(r, 100));
    const focusOk = await invoke<boolean>("verify_focus");
    if (!focusOk) {
      setLlmError("焦點已變更，取消取代");
      await invoke("restore_clipboard");
      return;
    }
    await invoke("inject_text", { text: llmOutput, recordForUndo: true });
    await new Promise((r) => setTimeout(r, 150));
    await invoke("restore_clipboard");
    await getCurrentWindow().hide();
  };

  const handleClose = async () => {
    await invoke("restore_clipboard");
    await getCurrentWindow().hide();
    setLlmOutput("");
    setIsLlmLoading(false);
    setLlmError("");
  };

  const handleStartDrag = async () => {
    await getCurrentWindow().startDragging();
  };

  const handleRefinement = async () => {
    const input = refinementInput.trim();
    if (!input) return;
    const previousOutput = llmOutput;
    const contextBlocks: string[] = [];
    if (lastSelectedText.trim()) {
      contextBlocks.push(`Original selected text:\n${lastSelectedText}`);
    }
    if (previousOutput.trim()) {
      contextBlocks.push(`Previous output:\n${previousOutput}`);
    }
    const selectedContext = contextBlocks.join("\n\n");
    setLlmOutput("");
    setIsLlmLoading(true);
    setLlmError("");
    setRefinementInput("");
    await invoke("call_llm", {
      selectedText: selectedContext,
      instruction: input,
      outputMode: "PreviewStream",
    });
  };

  const hasOutput = llmOutput.length > 0;

  return (
    <div className="flex flex-col h-screen bg-white text-gray-900 select-text rounded-lg border border-gray-200 shadow-xl overflow-hidden">
      {/* Custom title bar (draggable) */}
      <div
        className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-200 cursor-move shrink-0"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          void handleStartDrag();
        }}
      >
        <span className="text-xs text-gray-400 select-none pointer-events-none">TalkFlow Preview</span>
        <button
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-100 hover:text-red-600 text-gray-400 transition-colors"
          onClick={handleClose}
          title="關閉"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Output area */}
      <div
        ref={outputRef}
        className="flex-1 overflow-auto p-4 font-mono text-sm whitespace-pre-wrap border-b border-gray-200"
      >
        {llmError ? (
          <span className="text-red-500">{llmError}</span>
        ) : isLlmLoading && !hasOutput ? (
          <span className="text-gray-400">處理中…</span>
        ) : hasOutput ? (
          llmOutput
        ) : (
          <span className="text-gray-400">輸出將在此顯示…</span>
        )}
      </div>

      {/* Refinement input */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 shrink-0">
        <input
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:border-blue-400"
          placeholder="輸入補充指令…"
          value={refinementInput}
          onChange={(e) => setRefinementInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRefinement();
          }}
          disabled={isLlmLoading}
        />
        <button
          className="text-blue-500 hover:text-blue-700 disabled:opacity-40"
          disabled={isLlmLoading || !refinementInput.trim()}
          onClick={handleRefinement}
        >
          →
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex justify-center gap-3 px-3 py-2 shrink-0">
        <button
          className="px-4 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-sm disabled:opacity-40"
          disabled={!hasOutput}
          onClick={handleCopy}
        >
          複製
        </button>
        <button
          className="px-4 py-1.5 rounded bg-blue-500 hover:bg-blue-600 text-white text-sm disabled:opacity-40"
          disabled={!hasOutput || isLlmLoading}
          onClick={handleReplace}
        >
          取代
        </button>
        <button
          className="px-4 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-sm"
          onClick={handleClose}
        >
          關閉
        </button>
      </div>
    </div>
  );
}
