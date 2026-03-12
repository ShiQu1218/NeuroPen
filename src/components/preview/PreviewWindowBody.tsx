import { Suspense, lazy, useRef, type Dispatch, type MouseEvent, type RefObject, type SetStateAction } from "react";
import type { useI18n } from "../../i18n";
import type { PreviewSession } from "../../hooks/usePreviewEventSync";
import type { QuickActionCommand } from "../../store/useAppStore";
import {
  formatModeAText,
  looksLikeGfmMarkdown,
  looksLikeMarkdown,
  looksLikeMathMarkdown,
  normalizePreviewMarkdown,
  normalizeStructuredText,
} from "../../utils/appText";
import type { PreviewAttachment } from "../../utils/previewAttachments";

// Plain text responses are common enough that the preview should not pay the markdown, GFM, and
// math bundle cost unless the output actually uses those syntaxes.
const PreviewMarkdownRenderer = lazy(() => import("./PreviewMarkdownRenderer"));
const PreviewGfmMarkdownRenderer = lazy(() => import("./PreviewGfmMarkdownRenderer"));
const PreviewMathMarkdownRenderer = lazy(() => import("./PreviewMathMarkdownRenderer"));
const PreviewMathGfmMarkdownRenderer = lazy(() => import("./PreviewMathGfmMarkdownRenderer"));

function getAttachmentFormatLabel(attachment: PreviewAttachment) {
  const extensionIndex = attachment.name.lastIndexOf(".");
  const extension =
    extensionIndex > 0 ? attachment.name.slice(extensionIndex + 1).trim().toUpperCase() : "";
  if (extension) {
    return extension;
  }
  if (attachment.kind === "image") {
    return attachment.mimeType.split("/").pop()?.toUpperCase() ?? "IMAGE";
  }
  return attachment.mimeType.split("/").pop()?.toUpperCase() ?? "FILE";
}

interface PreviewWindowBodyProps {
  attachments: PreviewAttachment[];
  animKey: number;
  handleAttachFile: () => Promise<void>;
  handleClose: () => Promise<void>;
  handleCopy: () => Promise<void>;
  handleRefinement: () => Promise<void>;
  handleRemoveAttachment: (index: number) => void;
  handleReplace: () => Promise<void>;
  handleStartDrag: () => Promise<void>;
  handleTtsToggle: () => Promise<void>;
  hasOutput: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  isFileDragActive: boolean;
  isDragInteractionLocked: () => boolean;
  isLlmLoading: boolean;
  isTtsPlaying: boolean;
  llmDurationMs: number;
  llmError: string;
  llmOutput: string;
  outputContentRef: RefObject<HTMLDivElement | null>;
  outputRef: RefObject<HTMLDivElement | null>;
  previewSession: PreviewSession | null;
  quickActionCommands: QuickActionCommand[];
  refinementInput: string;
  runPreviewInstruction: (instruction: string) => Promise<void>;
  setPreviewFocusable: (focusable: boolean, focus?: boolean) => Promise<void>;
  setRefinementInput: Dispatch<SetStateAction<string>>;
  suppressKeyboardCopy: (durationMs?: number) => void;
  sttDurationMs: number;
  swallowDragRelease: (event: MouseEvent<HTMLElement>) => void;
  t: ReturnType<typeof useI18n>["t"];
  toastMessage: string;
}

export default function PreviewWindowBody({
  attachments,
  animKey,
  handleAttachFile,
  handleClose,
  handleCopy,
  handleRefinement,
  handleRemoveAttachment,
  handleReplace,
  handleStartDrag,
  handleTtsToggle,
  hasOutput,
  inputRef,
  isFileDragActive,
  isDragInteractionLocked,
  isLlmLoading,
  isTtsPlaying,
  llmDurationMs,
  llmError,
  llmOutput,
  outputContentRef,
  outputRef,
  previewSession,
  quickActionCommands,
  refinementInput,
  runPreviewInstruction,
  setPreviewFocusable,
  setRefinementInput,
  suppressKeyboardCopy,
  sttDurationMs,
  swallowDragRelease,
  t,
  toastMessage,
}: PreviewWindowBodyProps) {
  const copyGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const isModeAPreview = previewSession?.type === "text" && previewSession.sourceMode === "A";
  const isModeALlmPreview = isModeAPreview && !!previewSession?.instruction.trim();
  const isModeCPreview =
    (previewSession?.type === "text" && previewSession.sourceMode === "C") ||
    previewSession?.type === "screenshot";
  const hasImageAttachment = attachments.some((attachment) => attachment.kind === "image");
  const refinementPlaceholder =
    hasImageAttachment
      ? attachments.some((attachment) => attachment.kind === "image" && attachment.source === "screenshot")
        ? t("preview.askAboutScreenshot")
        : t("preview.askAboutImageAttachment")
      : attachments.length > 0
        ? t("preview.askAboutAttachment")
        : t("preview.refinementPlaceholder");
  const renderedOutput =
    isModeALlmPreview
      ? normalizeStructuredText(llmOutput)
      : isModeAPreview
      ? formatModeAText(llmOutput)
      : isModeCPreview
        ? normalizePreviewMarkdown(llmOutput)
        : llmOutput;
  const usesMathMarkdown = looksLikeMathMarkdown(renderedOutput);
  const usesGfmMarkdown = looksLikeGfmMarkdown(renderedOutput);
  const usesMarkdown = usesMathMarkdown || looksLikeMarkdown(renderedOutput);

  return (
    <div
      key={animKey}
      className="relative flex flex-col h-screen text-zinc-900 select-text glass-panel-lg overflow-hidden animate-scaleUp"
      onMouseUpCapture={swallowDragRelease}
      onClickCapture={swallowDragRelease}
      // Block keyboard copy briefly while pointer activity settles so window drags cannot surface a false copy toast.
      onPointerDownCapture={(event) => {
        const isCopyTarget = !!(event.target as HTMLElement).closest('[data-preview-action="copy"]');
        suppressKeyboardCopy(isCopyTarget ? 250 : 900);
      }}
      onPointerMoveCapture={(event) => {
        if (event.buttons !== 0) {
          suppressKeyboardCopy(900);
        }
      }}
      onPointerUpCapture={() => {
        suppressKeyboardCopy(500);
      }}
      onPointerCancelCapture={() => {
        suppressKeyboardCopy(900);
      }}
      onWheelCapture={() => {
        suppressKeyboardCopy(900);
      }}
      onMouseDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button,input,textarea,a")) {
          void setPreviewFocusable(true, true);
          return;
        }
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-white/75 border-b border-zinc-200 cursor-move shrink-0"
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          event.preventDefault();
          event.stopPropagation();
          void handleStartDrag();
        }}
      >
        <div className="pointer-events-none select-none">
          <span className="text-xs font-semibold text-zinc-700">{t("preview.title")}</span>
          <p className="text-[10px] text-zinc-400 leading-tight">
            {t("preview.subtitle")}
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
          {hasOutput && (
            <button
              className={`w-6 h-6 flex items-center justify-center rounded-lg transition-colors ${isTtsPlaying
                ? "bg-blue-100 text-blue-600"
                : "hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700"
                }`}
              onClick={() => {
                if (isDragInteractionLocked()) return;
                void handleTtsToggle();
              }}
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
            onClick={() => {
              if (isDragInteractionLocked()) return;
              void handleClose();
            }}
            title={`${t("preview.close")} (Esc)`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div
          ref={outputRef}
          className="flex-1 min-h-0 overflow-auto p-4 text-sm border-b border-zinc-200 bg-zinc-50/80 preview-markdown"
        >
          <div ref={outputContentRef}>
            {llmError ? (
              <span className="text-red-500">{llmError}</span>
            ) : isLlmLoading && !hasOutput ? (
              <span className="text-gray-400">{t("preview.loading")}</span>
            ) : hasOutput ? (
              usesMarkdown ? (
                <Suspense fallback={<div className="whitespace-pre-wrap">{renderedOutput}</div>}>
                  {usesMathMarkdown && usesGfmMarkdown ? (
                    <PreviewMathGfmMarkdownRenderer markdown={renderedOutput} />
                  ) : usesMathMarkdown ? (
                    <PreviewMathMarkdownRenderer markdown={renderedOutput} />
                  ) : usesGfmMarkdown ? (
                    <PreviewGfmMarkdownRenderer markdown={renderedOutput} />
                  ) : (
                    <PreviewMarkdownRenderer markdown={renderedOutput} />
                  )}
                </Suspense>
              ) : (
                <div className="whitespace-pre-wrap">{renderedOutput}</div>
              )
            ) : (
              <span className="text-gray-400">{t("preview.empty")}</span>
            )}
          </div>
        </div>

        {attachments.length > 0 && (
          <div className="px-3 py-2 border-b border-zinc-200 shrink-0 bg-blue-50/80 max-h-32 overflow-y-auto">
            <div className="flex flex-col gap-2">
              {attachments.map((attachment, index) => (
                <div
                  key={`${attachment.kind}-${attachment.name}-${index}`}
                  className="flex items-center gap-2 rounded-lg border border-blue-100 bg-white/90 px-2 py-1.5"
                >
                  <span className="shrink-0 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-blue-700">
                    {getAttachmentFormatLabel(attachment)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-700 truncate">{attachment.name}</div>
                    <div className="text-[11px] text-zinc-500 leading-tight">
                      {attachment.source === "screenshot"
                        ? t("preview.screenshotAttached")
                        : attachment.kind === "image"
                          ? t("preview.imageAttachmentAttached")
                          : t("preview.fileAttachmentAttached")}
                      {attachment.kind === "text" && attachment.truncated ? ` · ${t("preview.attachmentTruncated")}` : ""}
                    </div>
                  </div>
                  <button
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-200 text-zinc-400 hover:text-zinc-700 transition-colors"
                    onClick={() => handleRemoveAttachment(index)}
                    title={t("preview.removeAttachment")}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {quickActionCommands.length > 0 && (
          <div className="px-3 py-2 border-b border-zinc-200 shrink-0 bg-white/70 max-h-28 overflow-y-auto">
            <div className="text-[11px] font-medium text-zinc-500 mb-1.5">{t("preview.quickActions")}</div>
            <div className="flex flex-wrap gap-1.5">
              {quickActionCommands.map((command) => (
                <button
                  key={`preview-command-${command.id}`}
                  className="btn-secondary px-2.5 py-1 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={isLlmLoading}
                  onClick={() => {
                    if (isDragInteractionLocked()) return;
                    void runPreviewInstruction(command.instruction);
                  }}
                >
                  {command.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 shrink-0 bg-white/70">
        <button
          className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={isLlmLoading}
          onClick={() => {
            if (isDragInteractionLocked()) return;
            void handleAttachFile();
          }}
          title={t("preview.attachFile")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.48-8.48" />
          </svg>
        </button>
        <input
          ref={inputRef}
          className="flex-1 input-field px-2.5 py-1.5 text-sm"
          placeholder={refinementPlaceholder}
          value={refinementInput}
          onChange={(event) => setRefinementInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleRefinement();
          }}
          disabled={isLlmLoading}
        />
        <button
          className="btn-primary px-2.5 py-1.5 text-sm"
          disabled={isLlmLoading || !refinementInput.trim()}
          onClick={() => {
            if (isDragInteractionLocked()) return;
            void handleRefinement();
          }}
        >
          {"\u2192"}
        </button>
      </div>

      <div className="flex justify-center gap-2 px-3 py-2 shrink-0 bg-white/80">
        <button
          type="button"
          disabled={!hasOutput}
          data-preview-action="copy"
          className="btn-secondary px-3 py-1.5 text-xs"
          onPointerDown={(event) => {
            if (!hasOutput || isDragInteractionLocked()) return;
            // Treat copy as a short tap gesture so pointer-release after dragging does not count as an intentional copy.
            copyGestureRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            const gesture = copyGestureRef.current;
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            if (Math.abs(event.clientX - gesture.startX) > 6 || Math.abs(event.clientY - gesture.startY) > 6) {
              gesture.moved = true;
            }
          }}
          onPointerCancel={() => {
            copyGestureRef.current = null;
          }}
          onBlur={() => {
            copyGestureRef.current = null;
          }}
          onPointerLeave={() => {
            const gesture = copyGestureRef.current;
            if (gesture) {
              gesture.moved = true;
            }
          }}
          onPointerUp={async (event) => {
            const gesture = copyGestureRef.current;
            copyGestureRef.current = null;
            if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return;
            await handleCopy();
          }}
          onClick={(event) => {
            if (event.detail !== 0 || !hasOutput || isDragInteractionLocked()) return;
            void handleCopy();
          }}
          title="Ctrl+C"
        >
          {t("preview.copy")}
        </button>
        <button
          className="btn-primary px-3 py-1.5 text-xs"
          disabled={!hasOutput || isLlmLoading}
          onClick={() => {
            if (isDragInteractionLocked()) return;
            void handleReplace();
          }}
          title="Ctrl+Enter"
        >
          {t("preview.replace")}
        </button>
        <button
          className="btn-secondary px-3 py-1.5 text-xs"
          onClick={() => {
            if (isDragInteractionLocked()) return;
            void handleClose();
          }}
          title="Esc"
        >
          {t("preview.close")}
        </button>
      </div>

      {toastMessage && (
        <div className="pointer-events-none absolute bottom-14 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-2 bg-black/80 text-white px-4 py-2 rounded-full text-sm shadow-lg backdrop-blur-sm max-w-[400px] animate-scaleUp">
            <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {isFileDragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-blue-100/50 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-blue-400 bg-white/85 px-6 py-4 text-center shadow-lg">
            <div className="text-sm font-semibold text-blue-700">{t("preview.attachFile")}</div>
            <div className="mt-1 text-xs text-blue-600">Drop files here</div>
          </div>
        </div>
      )}
    </div>
  );
}
