import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { useI18n } from "../i18n";
import { useAppStore, type AppLanguage, type PreferredLanguage } from "../store/useAppStore";

const PREVIEW_WIDTH = 340;
const PREVIEW_MIN_HEIGHT = 240;
const PREVIEW_MAX_HEIGHT = 420;
const PREVIEW_CHROME_HEIGHT = 180;

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export default function PreviewWindow() {
  const [refinementInput, setRefinementInput] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const llmOutput = useAppStore((s) => s.llmOutput);
  const isLlmLoading = useAppStore((s) => s.isLlmLoading);
  const llmError = useAppStore((s) => s.llmError);
  const lastSelectedText = useAppStore((s) => s.lastSelectedText);
  const llmProvider = useAppStore((s) => s.llmProvider);
  const llmModel = useAppStore((s) => s.llmModel);
  const preferredLanguage = useAppStore((s) => s.preferredLanguage);
  const setLlmOutput = useAppStore((s) => s.setLlmOutput);
  const setIsLlmLoading = useAppStore((s) => s.setIsLlmLoading);
  const setLlmError = useAppStore((s) => s.setLlmError);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setPreferredLanguage = useAppStore((s) => s.setPreferredLanguage);
  const keepPreviewInBounds = async (width: number, height: number) => {
    try {
      const win = getCurrentWindow();
      const pos = await win.outerPosition();
      const monitors = await availableMonitors();
      if (monitors.length === 0) return;
      const targetMonitor = monitors.find(
        (monitor) =>
          pos.x >= monitor.position.x &&
          pos.x <= monitor.position.x + monitor.size.width &&
          pos.y >= monitor.position.y &&
          pos.y <= monitor.position.y + monitor.size.height
      ) ?? monitors[0];
      const minX = targetMonitor.position.x;
      const minY = targetMonitor.position.y;
      const maxX = targetMonitor.position.x + targetMonitor.size.width - width;
      const maxY = targetMonitor.position.y + targetMonitor.size.height - height;
      const clampedX = Math.round(clampNumber(pos.x, minX, Math.max(minX, maxX)));
      const clampedY = Math.round(clampNumber(pos.y, minY, Math.max(minY, maxY)));
      await win.setPosition(new PhysicalPosition(clampedX, clampedY));
    } catch (err) {
      console.warn("[Preview] keepPreviewInBounds failed:", err);
    }
  };

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
          void (async () => {
            try {
              await getCurrentWindow().setSize(
                new LogicalSize(PREVIEW_WIDTH, PREVIEW_MIN_HEIGHT)
              );
              await keepPreviewInBounds(PREVIEW_WIDTH, PREVIEW_MIN_HEIGHT);
            } catch (err) {
              console.warn("[Preview] preview-session resize failed:", err);
            }
          })();
          useAppStore.getState().setLlmOutput("");
          useAppStore.getState().setIsLlmLoading(true);
          useAppStore.getState().setLlmError("");
          useAppStore.getState().setLastSelectedText(event.payload.selectedText ?? "");
          useAppStore.getState().setLastInstruction(event.payload.instruction ?? "");
        }
      );
      await register<{ language?: AppLanguage; preferredLanguage?: PreferredLanguage }>(
        "talkflow://settings-saved",
        (event) => {
          if (event.payload.language) {
            setLanguage(event.payload.language);
          }
          if (event.payload.preferredLanguage) {
            setPreferredLanguage(event.payload.preferredLanguage);
          }
        }
      );
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, [setLanguage, setPreferredLanguage]);

  // Keep preview compact and grow vertically as wrapped output increases.
  useEffect(() => {
    if (outputRef.current) {
      if (!llmOutput.trim()) {
        void (async () => {
          try {
            await getCurrentWindow().setSize(
              new LogicalSize(PREVIEW_WIDTH, PREVIEW_MIN_HEIGHT)
            );
            await keepPreviewInBounds(PREVIEW_WIDTH, PREVIEW_MIN_HEIGHT);
          } catch (err) {
            console.warn("[Preview] reset size failed:", err);
          }
        })();
        return;
      }
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
      const outputHeight = Math.max(60, outputRef.current.scrollHeight);
      const nextHeight = Math.min(
        PREVIEW_MAX_HEIGHT,
        Math.max(PREVIEW_MIN_HEIGHT, outputHeight + PREVIEW_CHROME_HEIGHT)
      );
      void (async () => {
        try {
          await getCurrentWindow().setSize(new LogicalSize(PREVIEW_WIDTH, nextHeight));
          await keepPreviewInBounds(PREVIEW_WIDTH, nextHeight);
        } catch (err) {
          console.warn("[Preview] grow size failed:", err);
        }
      })();
    }
  }, [llmOutput]);

  const handleCopy = async () => {
    await invoke("copy_to_clipboard", { text: llmOutput });
  };

  const handleReplace = async () => {
    const restored = await invoke<boolean>("restore_focus");
    if (!restored) {
      setLlmError(t("preview.replaceNoTarget"));
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
    const focusOk = await invoke<boolean>("verify_focus");
    if (!focusOk) {
      setLlmError(t("preview.replaceFocusChanged"));
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
    await getCurrentWindow().setSize(new LogicalSize(PREVIEW_WIDTH, PREVIEW_MIN_HEIGHT));
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
      provider: llmProvider,
      model: llmModel,
      preferredLanguage,
    });
  };

  const hasOutput = llmOutput.length > 0;

  return (
    <div className="flex flex-col h-screen text-zinc-900 select-text glass-panel-lg overflow-hidden">
      {/* Custom title bar (draggable) */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-white/75 border-b border-zinc-200 cursor-move shrink-0"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          void handleStartDrag();
        }}
      >
        <div className="pointer-events-none select-none">
          <span className="text-xs font-semibold text-zinc-700">{t("preview.title")}</span>
          <p className="text-[10px] text-zinc-400 leading-tight">{t("preview.subtitle")}</p>
        </div>
        <button
          className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors"
          onClick={handleClose}
          title={t("preview.close")}
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
        className="flex-1 overflow-auto p-4 font-mono text-sm whitespace-pre-wrap border-b border-zinc-200 bg-zinc-50/80"
      >
        {llmError ? (
          <span className="text-red-500">{llmError}</span>
        ) : isLlmLoading && !hasOutput ? (
          <span className="text-gray-400">{t("preview.loading")}</span>
        ) : hasOutput ? (
          llmOutput
        ) : (
          <span className="text-gray-400">{t("preview.empty")}</span>
        )}
      </div>

      {/* Refinement input */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 shrink-0 bg-white/70">
        <input
          className="flex-1 input-field px-2.5 py-1.5 text-sm"
          placeholder={t("preview.refinementPlaceholder")}
          value={refinementInput}
          onChange={(e) => setRefinementInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRefinement();
          }}
          disabled={isLlmLoading}
        />
        <button
          className="btn-primary px-2.5 py-1.5 text-sm"
          disabled={isLlmLoading || !refinementInput.trim()}
          onClick={handleRefinement}
        >
          →
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex justify-center gap-3 px-3 py-2.5 shrink-0 bg-white/80">
        <button
          className="btn-secondary px-4 py-1.5 text-sm"
          disabled={!hasOutput}
          onClick={handleCopy}
        >
          {t("preview.copy")}
        </button>
        <button
          className="btn-primary px-4 py-1.5 text-sm"
          disabled={!hasOutput || isLlmLoading}
          onClick={handleReplace}
        >
          {t("preview.replace")}
        </button>
        <button
          className="btn-secondary px-4 py-1.5 text-sm"
          onClick={handleClose}
        >
          {t("preview.close")}
        </button>
      </div>
    </div>
  );
}
