import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../i18n";
import { useAppStore, type AppLanguage, type PreferredLanguage } from "../store/useAppStore";
import { clampToMonitorBounds } from "../utils/windowBounds";

const PREVIEW_WIDTH = 400;
const PREVIEW_MIN_HEIGHT = 260;
const PREVIEW_MAX_HEIGHT = 500;
const PREVIEW_CHROME_HEIGHT = 180;

export default function PreviewWindow() {
  const [refinementInput, setRefinementInput] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const llmOutput = useAppStore((s) => s.llmOutput);
  const isLlmLoading = useAppStore((s) => s.isLlmLoading);
  const llmError = useAppStore((s) => s.llmError);
  const lastSelectedText = useAppStore((s) => s.lastSelectedText);
  const llmProvider = useAppStore((s) => s.llmProvider);
  const llmModel = useAppStore((s) => s.llmModel);
  const preferredLanguage = useAppStore((s) => s.preferredLanguage);
  const isTtsPlaying = useAppStore((s) => s.isTtsPlaying);
  const sttDurationMs = useAppStore((s) => s.sttDurationMs);
  const llmDurationMs = useAppStore((s) => s.llmDurationMs);
  const setLlmOutput = useAppStore((s) => s.setLlmOutput);
  const setIsLlmLoading = useAppStore((s) => s.setIsLlmLoading);
  const setLlmError = useAppStore((s) => s.setLlmError);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setPreferredLanguage = useAppStore((s) => s.setPreferredLanguage);
  const setIsTtsPlaying = useAppStore((s) => s.setIsTtsPlaying);

  const keepPreviewInBounds = async (width: number, height: number) => {
    try {
      const win = getCurrentWindow();
      const pos = await win.outerPosition();
      const clamped = await clampToMonitorBounds(pos.x, pos.y, width, height);
      await win.setPosition(new PhysicalPosition(clamped.x, clamped.y));
    } catch (err) {
      console.warn("[Preview] keepPreviewInBounds failed:", err);
    }
  };

  // Listen to LLM streaming events + TTS events
  useEffect(() => {
    let cancelled = false;
    const unlisten: Array<() => void> = [];
    let llmStartTime = 0;

    (async () => {
      const register = async <T,>(event: string, handler: (e: { payload: T }) => void) => {
        const u = await listen<T>(event, handler);
        if (cancelled) { u(); } else { unlisten.push(u); }
      };

      await register<{ text: string }>("llm://token", (event) => {
        const state = useAppStore.getState();
        if (state.llmOutput === "" && llmStartTime > 0) {
          // First token — record TTFT
          const ttft = Date.now() - llmStartTime;
          useAppStore.getState().setLlmDurationMs(ttft);
        }
        state.setLlmOutput(state.llmOutput + event.payload.text);
      });
      await register("llm://done", () => {
        const state = useAppStore.getState();
        if (llmStartTime > 0) {
          state.setLlmDurationMs(Date.now() - llmStartTime);
        }
        state.setIsLlmLoading(false);

        // Auto TTS if enabled
        if (state.ttsEnabled && state.llmOutput.trim()) {
          void invoke("tts_speak", {
            text: state.llmOutput,
            voice: state.ttsVoice || null,
            rate: state.ttsRate || null,
            pitch: state.ttsPitch || null,
          });
        }
      });
      await register<{ message: string }>("llm://error", (event) => {
        useAppStore.getState().setLlmError(event.payload.message);
        useAppStore.getState().setIsLlmLoading(false);
      });
      await register<{ selectedText?: string; instruction?: string }>(
        "talkflow://preview-session",
        (event) => {
          llmStartTime = Date.now();
          // Clear conversation history for new session
          void invoke("clear_conversation");
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
          useAppStore.getState().setLlmDurationMs(0);
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

      // TTS events
      await register("tts://start", () => {
        useAppStore.getState().setIsTtsPlaying(true);
      });
      await register("tts://done", () => {
        useAppStore.getState().setIsTtsPlaying(false);
      });
      await register("tts://error", () => {
        useAppStore.getState().setIsTtsPlaying(false);
      });
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, [setLanguage, setPreferredLanguage, setIsTtsPlaying]);

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
    await invoke("tts_stop");
    await invoke("clear_conversation");
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
    // Backend CONVERSATION_HISTORY tracks multi-turn context automatically
    setLlmOutput("");
    setIsLlmLoading(true);
    setLlmError("");
    setRefinementInput("");
    await invoke("call_llm", {
      selectedText: lastSelectedText,
      instruction: input,
      outputMode: "PreviewStream",
      provider: llmProvider,
      model: llmModel,
      preferredLanguage,
    });
  };

  const handleTtsToggle = async () => {
    if (isTtsPlaying) {
      await invoke("tts_stop");
    } else if (llmOutput.trim()) {
      const state = useAppStore.getState();
      await invoke("tts_speak", {
        text: llmOutput,
        voice: state.ttsVoice || null,
        rate: state.ttsRate || null,
        pitch: state.ttsPitch || null,
      });
    }
  };

  // Feature 6: Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Escape → close
      if (e.key === "Escape") {
        e.preventDefault();
        void handleClose();
        return;
      }
      // Ctrl+C → copy (when no text selected in window)
      if (e.ctrlKey && e.key === "c" && !window.getSelection()?.toString()) {
        e.preventDefault();
        void handleCopy();
        return;
      }
      // Ctrl+Enter → replace
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        void handleReplace();
        return;
      }
      // Tab → focus refinement input
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      // Ctrl+T → TTS
      if (e.ctrlKey && e.key === "t") {
        e.preventDefault();
        void handleTtsToggle();
        return;
      }
    },
    [llmOutput, isTtsPlaying]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

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
          <p className="text-[10px] text-zinc-400 leading-tight">
            {t("preview.subtitle")}
            {/* Performance metrics (Feature 13) */}
            {(sttDurationMs > 0 || llmDurationMs > 0) && (
              <span className="ml-2 text-zinc-300">
                {sttDurationMs > 0 && `STT: ${sttDurationMs}ms`}
                {sttDurationMs > 0 && llmDurationMs > 0 && " | "}
                {llmDurationMs > 0 && `LLM: ${llmDurationMs}ms`}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {/* TTS button */}
          {hasOutput && (
            <button
              className={`w-6 h-6 flex items-center justify-center rounded-lg transition-colors ${
                isTtsPlaying
                  ? "bg-blue-100 text-blue-600"
                  : "hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700"
              }`}
              onClick={handleTtsToggle}
              title={isTtsPlaying ? t("preview.ttsStop") : t("preview.ttsPlay")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isTtsPlaying ? (
                  <>
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </>
                ) : (
                  <>
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </>
                )}
              </svg>
            </button>
          )}
          <button
            className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors"
            onClick={handleClose}
            title={`${t("preview.close")} (Esc)`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Output area — Markdown rendered (Feature 5) */}
      <div
        ref={outputRef}
        className="flex-1 overflow-auto p-4 text-sm border-b border-zinc-200 bg-zinc-50/80 preview-markdown"
      >
        {llmError ? (
          <span className="text-red-500">{llmError}</span>
        ) : isLlmLoading && !hasOutput ? (
          <span className="text-gray-400">{t("preview.loading")}</span>
        ) : hasOutput ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{llmOutput}</ReactMarkdown>
        ) : (
          <span className="text-gray-400">{t("preview.empty")}</span>
        )}
      </div>

      {/* Refinement input */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 shrink-0 bg-white/70">
        <input
          ref={inputRef}
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
          {"\u2192"}
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex justify-center gap-2 px-3 py-2 shrink-0 bg-white/80">
        <button
          className="btn-secondary px-3 py-1.5 text-xs"
          disabled={!hasOutput}
          onClick={handleCopy}
          title="Ctrl+C"
        >
          {t("preview.copy")}
        </button>
        <button
          className="btn-primary px-3 py-1.5 text-xs"
          disabled={!hasOutput || isLlmLoading}
          onClick={handleReplace}
          title="Ctrl+Enter"
        >
          {t("preview.replace")}
        </button>
        <button
          className="btn-secondary px-3 py-1.5 text-xs"
          onClick={handleClose}
          title="Esc"
        >
          {t("preview.close")}
        </button>
      </div>
    </div>
  );
}
