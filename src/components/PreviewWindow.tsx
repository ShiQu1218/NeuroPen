import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../i18n";
import { useAppStore, type AppLanguage, type PreferredLanguage, type QuickActionCommand } from "../store/useAppStore";
import { clampToMonitorBounds } from "../utils/windowBounds";

const PREVIEW_WIDTH = 480;
const PREVIEW_MIN_HEIGHT = 340;
const PREVIEW_MAX_HEIGHT = 620;
const PREVIEW_CHROME_HEIGHT = 240;

export default function PreviewWindow() {
  const [refinementInput, setRefinementInput] = useState("");
  const [screenshotBase64, setScreenshotBase64] = useState("");
  const [animKey, setAnimKey] = useState(0);
  const [isScreenshotSession, setIsScreenshotSession] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const outputContentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fallbackUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const fallbackTtsActiveRef = useRef(false);
  const { t } = useI18n();

  const llmOutput = useAppStore((s) => s.llmOutput);
  const isLlmLoading = useAppStore((s) => s.isLlmLoading);
  const llmError = useAppStore((s) => s.llmError);
  const lastSelectedText = useAppStore((s) => s.lastSelectedText);
  const isTtsPlaying = useAppStore((s) => s.isTtsPlaying);
  const quickActionCommands = useAppStore((s) => s.quickActionCommands);
  const sttDurationMs = useAppStore((s) => s.sttDurationMs);
  const llmDurationMs = useAppStore((s) => s.llmDurationMs);
  const setLlmOutput = useAppStore((s) => s.setLlmOutput);
  const setIsLlmLoading = useAppStore((s) => s.setIsLlmLoading);
  const setLlmError = useAppStore((s) => s.setLlmError);
  const setLlmProvider = useAppStore((s) => s.setLlmProvider);
  const setLlmModel = useAppStore((s) => s.setLlmModel);
  const setLlmModelOptions = useAppStore((s) => s.setLlmModelOptions);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setPreferredLanguage = useAppStore((s) => s.setPreferredLanguage);
  const setTtsVoice = useAppStore((s) => s.setTtsVoice);
  const setTtsRate = useAppStore((s) => s.setTtsRate);
  const setTtsPitch = useAppStore((s) => s.setTtsPitch);
  const setIsTtsPlaying = useAppStore((s) => s.setIsTtsPlaying);
  const setQuickActionCommands = useAppStore((s) => s.setQuickActionCommands);

  const parseRate = (value?: string | null) => {
    if (!value) return 1;
    const m = value.match(/([+-]?\d+(?:\.\d+)?)%/);
    if (!m) return 1;
    return Math.min(10, Math.max(0.1, 1 + Number(m[1]) / 100));
  };

  const parsePitch = (value?: string | null) => {
    if (!value) return 1;
    const m = value.match(/([+-]?\d+(?:\.\d+)?)/);
    if (!m) return 1;
    return Math.min(2, Math.max(0, 1 + Number(m[1]) / 100));
  };

  const stopFallbackTts = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    fallbackUtteranceRef.current = null;
    fallbackTtsActiveRef.current = false;
    setIsTtsPlaying(false);
  }, [setIsTtsPlaying]);

  const speakWithFallback = useCallback(
    async (text: string, voice?: string | null, rate?: string | null, pitch?: string | null) => {
      try {
        fallbackTtsActiveRef.current = false;
        await invoke("tts_speak", {
          text,
          voice: voice || null,
          rate: rate || null,
          pitch: pitch || null,
        });
      } catch (err) {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) {
          setLlmError(`TTS 失敗：${String(err)}`);
          setIsTtsPlaying(false);
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        if (voice) {
          const targetVoice = window.speechSynthesis
            .getVoices()
            .find((v) => v.name === voice || v.voiceURI === voice);
          if (targetVoice) utterance.voice = targetVoice;
        }
        utterance.rate = parseRate(rate);
        utterance.pitch = parsePitch(pitch);
        utterance.onend = () => {
          fallbackTtsActiveRef.current = false;
          fallbackUtteranceRef.current = null;
          setIsTtsPlaying(false);
        };
        utterance.onerror = () => {
          fallbackTtsActiveRef.current = false;
          fallbackUtteranceRef.current = null;
          setIsTtsPlaying(false);
          setLlmError("TTS 播放失敗");
        };
        fallbackUtteranceRef.current = utterance;
        fallbackTtsActiveRef.current = true;
        setIsTtsPlaying(true);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }
    },
    [setIsTtsPlaying, setLlmError]
  );

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

  const setPreviewFocusable = useCallback(async (focusable: boolean, focus = false) => {
    const win = getCurrentWindow();
    await win.setFocusable(focusable).catch(() => { });
    if (focusable && focus) {
      await win.setFocus().catch(() => { });
    }
  }, []);

  const runPreviewInstruction = useCallback(
    async (instruction: string) => {
      const state = useAppStore.getState();
      const input = instruction.trim();
      if (!input) return;
      const screenshotToSend = screenshotBase64;
      if (screenshotToSend) {
        setScreenshotBase64("");
      }
      setLlmOutput("");
      setIsLlmLoading(true);
      setLlmError("");
      try {
        if (screenshotToSend) {
          await invoke("call_llm_with_image", {
            imageBase64: screenshotToSend,
            instruction: input,
            outputMode: "PreviewStream",
            provider: state.llmProvider,
            model: state.llmModel,
            preferredLanguage: state.preferredLanguage,
          });
        } else {
          await invoke("call_llm", {
            selectedText: isScreenshotSession ? "" : lastSelectedText,
            instruction: input,
            outputMode: "PreviewStream",
            provider: state.llmProvider,
            model: state.llmModel,
            preferredLanguage: state.preferredLanguage,
          });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        setIsLlmLoading(false);
        setLlmError(reason);
      }
    },
    [isScreenshotSession, lastSelectedText, screenshotBase64, setIsLlmLoading, setLlmError, setLlmOutput]
  );

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
          setAnimKey((k) => k + 1);
          useAppStore.getState().setLlmOutput("");
          useAppStore.getState().setIsLlmLoading(true);
          useAppStore.getState().setLlmError("");
          useAppStore.getState().setLastSelectedText(event.payload.selectedText ?? "");
          useAppStore.getState().setLastInstruction(event.payload.instruction ?? "");
          useAppStore.getState().setLlmDurationMs(0);
        }
      );
      await register<{
        llmProvider?: "openAi" | "gemini" | "claude" | "grok" | "ollama" | "qwen" | "doubao" | "deepseek";
        llmModel?: string;
        llmModelOptions?: string[];
        language?: AppLanguage;
        preferredLanguage?: PreferredLanguage;
        ttsVoice?: string;
        ttsRate?: string;
        ttsPitch?: string;
        quickActionCommands?: QuickActionCommand[];
      }>(
        "talkflow://settings-saved",
        (event) => {
          if (event.payload.llmProvider) {
            setLlmProvider(event.payload.llmProvider);
          }
          if (event.payload.llmModel) {
            setLlmModel(event.payload.llmModel);
          }
          if (event.payload.llmModelOptions) {
            setLlmModelOptions(event.payload.llmModelOptions);
          }
          if (event.payload.language) {
            setLanguage(event.payload.language);
          }
          if (event.payload.preferredLanguage) {
            setPreferredLanguage(event.payload.preferredLanguage);
          }
          if (typeof event.payload.ttsVoice === "string") {
            setTtsVoice(event.payload.ttsVoice);
          }
          if (typeof event.payload.ttsRate === "string") {
            setTtsRate(event.payload.ttsRate);
          }
          if (typeof event.payload.ttsPitch === "string") {
            setTtsPitch(event.payload.ttsPitch);
          }
          if (event.payload.quickActionCommands) {
            setQuickActionCommands(event.payload.quickActionCommands);
          }
        }
      );

      // TTS events
      await register("tts://start", () => {
        fallbackTtsActiveRef.current = false;
        useAppStore.getState().setIsTtsPlaying(true);
      });
      await register("tts://done", () => {
        fallbackTtsActiveRef.current = false;
        useAppStore.getState().setIsTtsPlaying(false);
      });
      await register("tts://error", () => {
        fallbackTtsActiveRef.current = false;
        useAppStore.getState().setIsTtsPlaying(false);
      });

      // Listen for screenshot attachment from main window
      await register<{ imageBase64: string }>(
        "talkflow://screenshot-attached",
        (event) => {
          setScreenshotBase64(event.payload.imageBase64 || "");
          setIsScreenshotSession(true);
          setAnimKey((k) => k + 1);
          useAppStore.getState().setLlmOutput("");
          useAppStore.getState().setIsLlmLoading(false);
          useAppStore.getState().setLlmError("");
        }
      );
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, [setIsTtsPlaying, setLanguage, setLlmModel, setLlmModelOptions, setLlmProvider, setPreferredLanguage, setQuickActionCommands, setTtsPitch, setTtsRate, setTtsVoice, speakWithFallback]);

  useEffect(() => {
    void setPreviewFocusable(false);
  }, [setPreviewFocusable]);

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
      const outputHeight = Math.max(
        60,
        outputContentRef.current?.scrollHeight ?? outputRef.current.scrollHeight,
      );
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
    stopFallbackTts();
    await invoke("tts_stop").catch(() => { });
    await invoke("clear_conversation");
    await invoke("restore_clipboard");
    await setPreviewFocusable(false);
    await getCurrentWindow().setSize(new LogicalSize(PREVIEW_WIDTH, PREVIEW_MIN_HEIGHT));
    await getCurrentWindow().hide();
    setLlmOutput("");
    setIsLlmLoading(false);
    setLlmError("");
    setScreenshotBase64("");
    setIsScreenshotSession(false);
  };

  const handleStartDrag = async () => {
    await getCurrentWindow().startDragging();
  };

  const handleRefinement = async () => {
    const input = refinementInput.trim();
    if (!input) return;
    setRefinementInput("");
    await runPreviewInstruction(input);
  };

  const handleTtsToggle = async () => {
    if (isTtsPlaying) {
      if (fallbackTtsActiveRef.current) {
        stopFallbackTts();
      } else {
        await invoke("tts_stop").catch(() => { });
      }
    } else if (llmOutput.trim()) {
      const state = useAppStore.getState();
      await speakWithFallback(
        llmOutput,
        state.ttsVoice || null,
        state.ttsRate || null,
        state.ttsPitch || null
      );
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
    <div
      key={animKey}
      className="flex flex-col h-screen text-zinc-900 select-text glass-panel-lg overflow-hidden animate-scaleUp"
      onMouseDownCapture={(e) => {
        if ((e.target as HTMLElement).closest("button,input,textarea")) {
          void setPreviewFocusable(true, true);
        }
      }}
    >
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
              className={`w-6 h-6 flex items-center justify-center rounded-lg transition-colors ${isTtsPlaying
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
        <div ref={outputContentRef}>
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
      </div>

      {/* Screenshot attachment preview */}
      {screenshotBase64 && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 shrink-0 bg-blue-50/80">
          <img
            src={`data:image/png;base64,${screenshotBase64}`}
            alt={t("preview.screenshotAttached")}
            className="h-12 w-auto rounded border border-zinc-300 object-contain"
          />
          <span className="text-xs text-zinc-500 flex-1">{t("preview.screenshotAttached")}</span>
          <button
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-200 text-zinc-400 hover:text-zinc-700 transition-colors"
            onClick={() => setScreenshotBase64("")}
            title={t("preview.removeScreenshot")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {quickActionCommands.length > 0 && (
        <div className="px-3 py-2 border-b border-zinc-200 shrink-0 bg-white/70">
          <div className="text-[11px] font-medium text-zinc-500 mb-1.5">{t("preview.quickActions")}</div>
          <div className="flex flex-wrap gap-1.5">
            {quickActionCommands.map((command) => (
              <button
                key={`preview-command-${command.id}`}
                className="btn-secondary px-2.5 py-1 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={isLlmLoading}
                onClick={() => void runPreviewInstruction(command.instruction)}
              >
                {command.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Refinement input */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 shrink-0 bg-white/70">
        <input
          ref={inputRef}
          className="flex-1 input-field px-2.5 py-1.5 text-sm"
          placeholder={screenshotBase64 ? t("preview.askAboutScreenshot") : t("preview.refinementPlaceholder")}
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
