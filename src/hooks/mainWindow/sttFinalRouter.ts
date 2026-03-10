import { mainWindowService } from "../../services/mainWindowService";
import { useAppStore } from "../../store/useAppStore";
import type { AppProfile, PreferredLanguage, OutputMode } from "../../store/useAppStore";
import {
  applyPunctuationMode,
  formatModeAText,
  isLikelyUnexpectedEnglishTranslation,
  normalizeStructuredText,
  resolveAppProfile,
  stripWrappingQuotes,
} from "../../utils/appText";
import {
  emitPreviewSession,
  emitPreviewStaticOutput,
  showPreviewWindow,
} from "../../utils/previewWindow";
import type { ErrorSetter, SafeRegister, StatusSetter, TranslateFn } from "./listenerTypes";

const isLikelyAuthError = (err: unknown) =>
  /(401|unauthorized|api\s*key|authentication|invalid key)/i.test(String(err));

interface RegisterSttFinalRouterParams {
  safeRegister: SafeRegister;
  t: TranslateFn;
  setStatusMsg: StatusSetter;
  setSttError: ErrorSetter;
}

export async function registerSttFinalRouter({
  safeRegister,
  t,
  setStatusMsg,
  setSttError,
}: RegisterSttFinalRouterParams) {
  await safeRegister<{ text: string }>("stt://final", async (event) => {
    const transcript = event.payload.text;
    if (import.meta.env.DEV) console.log("[App] stt://final:", transcript);
    if (!transcript.trim()) {
      setStatusMsg(t("status.noValidSpeech"));
      setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 1500);
      return;
    }

    const store = useAppStore.getState();
    store.setTranscript(transcript);
    const resetLlmRequestState = (selectedText: string, instruction: string) => {
      store.setLlmOutput("");
      store.setIsLlmLoading(true);
      store.setLlmError("");
      store.setLastSelectedText(selectedText);
      store.setLastInstruction(instruction);
    };
    const restoreClipboardAfterFailure = async (context: string) => {
      await mainWindowService.restoreClipboard().catch((restoreErr) => {
        console.warn(`[App] restore_clipboard failed after ${context}:`, restoreErr);
      });
    };

    try {
      const result = await mainWindowService.routeTranscript(
        transcript,
        store.selectedText || null,
        store.wakeWord,
        store.incognito,
      );

      if (import.meta.env.DEV) console.log("[App] route_transcript result:", result);
      const mode = result.mode as "A" | "B2" | "C";
      store.setCurrentMode(mode);

      // Resolve window title and app profile for all modes
      const windowTitle = store.contextAwareTone
        ? await mainWindowService.getForegroundWindowTitle()
        : "";

      const resolveEffective = (profile: AppProfile | null) => ({
        lang: ((profile?.preferredLanguage || store.preferredLanguage) as PreferredLanguage),
        outputMode: ((profile?.outputMode || store.outputMode) as OutputMode),
        promptAppendix: profile?.promptAppendix || "",
        toneHint: profile?.toneHint || (store.contextAwareTone ? "Keep neutral and clear style." : "Keep original style."),
        directPaste: profile?.directPaste ?? null,
      });

      if (mode === "A") {
        let finalText = applyPunctuationMode(result.transcript, store.punctuationMode);
        let usedLlmForModeA = false;
        let postInjectWarning = "";
        const shouldRefine = store.sttOutputStrategy === "llmRefine" && !store.incognito;
        const shouldTranslate =
          store.sttOutputStrategy === "llmRefine" &&
          store.translationTarget &&
          store.translationTarget !== "off" &&
          !store.incognito;
        const llmNeedsApiKey = store.llmProvider !== "ollama";
        let llmReady = true;
        if (llmNeedsApiKey && (shouldRefine || shouldTranslate)) {
          llmReady = await mainWindowService.hasLlmApiKey().catch(() => false);
        }
        const profileA = store.contextAwareTone
          ? resolveAppProfile(windowTitle, store.appProfiles, "A")
          : null;
        const effectiveA = resolveEffective(profileA);
        const toneHint = effectiveA.toneHint;
        const effectiveOutputModeA = effectiveA.outputMode;
        const vocabHint = store.vocabularyTerms.length
          ? `Prefer these domain terms exactly when relevant: ${store.vocabularyTerms.join(", ")}.`
          : "";
        const aggressiveModeAFormattingHint =
          "Format more actively than balanced mode. If the content naturally contains tasks, agenda items, action points, options, or grouped ideas, rewrite it into concise bullet lists. If the topic shifts, insert short headings. If the content contains time planning, sequence, or schedule-like information, rewrite it into clear concise written form instead of colloquial speech. Keep the meaning accurate and do not invent details.";
        const balancedModeAFormattingHint =
          "Keep formatting conservative. Prefer short paragraphs over bullets unless the original content is already clearly list-like.";
        const modeAFormattingHint =
          store.punctuationMode === "aggressive"
            ? aggressiveModeAFormattingHint
            : balancedModeAFormattingHint;
        const refineInstruction =
          `Rewrite this speech-to-text transcript into a clean final version using the Mode A formatting guidance from the system prompt. Preserve meaning, fix obvious transcription issues, keep the same language and script, and output only the final text. ${modeAFormattingHint} ${toneHint} ${vocabHint}`;
        const translateInstruction =
          `Translate this speech-to-text transcript to ${store.translationTarget}. Preserve the intended structure from the system prompt and output only the final text. ${modeAFormattingHint}`;
        const canStreamModeAPreview =
          effectiveOutputModeA === "PreviewStream" &&
          store.modeAStreamOutput &&
          ((shouldRefine && !shouldTranslate) || (!shouldRefine && shouldTranslate));

        const modeAPromptOverride = effectiveA.promptAppendix
          ? `${store.modeAPrompt}\n\n${effectiveA.promptAppendix}`
          : store.modeAPrompt;

        if (canStreamModeAPreview && llmReady) {
          const instruction = shouldTranslate ? translateInstruction : refineInstruction;
          const preferredLanguage = shouldTranslate
            ? store.translationTarget
            : effectiveA.lang;
          resetLlmRequestState(finalText, instruction);
          await emitPreviewSession({
            sessionType: "text",
            sourceMode: "A",
            selectedText: finalText,
            instruction,
          });
          await showPreviewWindow({ focusable: true, focus: true });
          setStatusMsg(shouldTranslate ? t("status.translating") : t("status.llmRefining"));
          try {
            await mainWindowService.callLlm({
              selectedText: finalText,
              instruction,
              outputMode: "PreviewStream",
              provider: store.llmProvider,
              model: store.llmModel,
              preferredLanguage,
              promptMode: "A",
              promptOverride: modeAPromptOverride,
              streamOutput: true,
            });
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            store.setLlmError(reason);
            setStatusMsg(t("status.routeFailed", { reason }));
            setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 2500);
            return;
          } finally {
            store.setIsLlmLoading(false);
          }
          return;
        }
        if (shouldRefine && llmReady) {
          try {
            usedLlmForModeA = true;
            setStatusMsg(t("status.llmRefining"));
            const refined = await mainWindowService.callLlmText({
              selectedText: finalText,
              instruction: refineInstruction,
              provider: store.llmProvider,
              model: store.llmModel,
              preferredLanguage: effectiveA.lang,
              promptMode: "A",
              promptOverride: modeAPromptOverride,
            });
            if (refined?.trim()) {
              const candidate = stripWrappingQuotes(refined);
              if (!isLikelyUnexpectedEnglishTranslation(finalText, candidate)) {
                finalText = candidate;
              }
            }
          } catch (err) {
            console.warn("[App] call_llm_text failed, fallback to STT output:", err);
            if (isLikelyAuthError(err)) {
              setSttError(t("error.llmApiKeyRequired"));
              postInjectWarning = t("status.llmApiMissingSkipRefine");
            } else {
              const reason = err instanceof Error ? err.message : String(err);
              setSttError(t("error.llmRefineFailedOriginal", { reason }));
              postInjectWarning = t("status.llmRefineFailedUsingOriginal");
            }
          }
        } else if (shouldRefine && !llmReady) {
          setSttError(t("error.llmApiKeyRequired"));
          postInjectWarning = t("status.llmApiMissingSkipRefine");
        }
        if (shouldTranslate && llmReady) {
          try {
            usedLlmForModeA = true;
            setStatusMsg(t("status.translating"));
            const translated = await mainWindowService.callLlmText({
              selectedText: finalText,
              instruction: translateInstruction,
              provider: store.llmProvider,
              model: store.llmModel,
              preferredLanguage: store.translationTarget,
              promptMode: "A",
              promptOverride: modeAPromptOverride,
            });
            if (translated?.trim()) {
              finalText = translated.trim();
            }
          } catch (err) {
            console.warn("[App] Translation failed, using original:", err);
            setSttError(t("error.translationFailedOriginal"));
            setStatusMsg(t("status.translationFailedUsingOriginal"));
          }
        } else if (shouldTranslate && !llmReady) {
          setSttError(t("error.translationNeedsLlmApiKey"));
          postInjectWarning = t("status.llmApiMissingOriginalOutput");
        }

        finalText = usedLlmForModeA
          ? normalizeStructuredText(finalText)
          : formatModeAText(finalText);

        // directPaste from profile: if true, force DirectInject even if global is PreviewStream
        const shouldDirectPasteModeA = effectiveA.directPaste === true;
        if (effectiveOutputModeA === "PreviewStream" && !shouldDirectPasteModeA) {
          store.setLastSelectedText(finalText);
          store.setLastInstruction("");
          await emitPreviewSession({
            sessionType: "text",
            sourceMode: "A",
            selectedText: finalText,
            instruction: "",
          });
          await showPreviewWindow({ focusable: true, focus: true });
          await emitPreviewStaticOutput(finalText);

          if (store.historyEnabled && !store.incognito) {
            void mainWindowService.historySave({
              mode: "A",
              inputText: result.transcript,
              instruction: "",
              output: finalText,
              provider: usedLlmForModeA ? store.llmProvider : "",
              model: usedLlmForModeA ? store.llmModel : "",
            });
          }

          if (postInjectWarning) {
            setStatusMsg(postInjectWarning);
            setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 3500);
          } else {
            setStatusMsg(t("status.readyHoldHotkey"));
          }
          return;
        }

        setStatusMsg(t("status.injectingText"));
        const ok = await mainWindowService.verifyFocus();
        if (!ok) {
          setStatusMsg(t("status.focusChangedCancelInject"));
          await mainWindowService.restoreClipboard();
          return;
        }
        try {
          await mainWindowService.injectText(finalText, true);
        } catch (err) {
          await restoreClipboardAfterFailure("Mode A inject failure");
          throw err;
        }
        await new Promise((r) => setTimeout(r, 150));
        await mainWindowService.restoreClipboard();

        if (store.historyEnabled && !store.incognito) {
          void mainWindowService.historySave({
            mode: "A",
            inputText: result.transcript,
            instruction: "",
            output: finalText,
            provider: usedLlmForModeA ? store.llmProvider : "",
            model: usedLlmForModeA ? store.llmModel : "",
          });
        }

        const injectSuccessStatus = usedLlmForModeA
          ? t("status.llmProcessedInjected")
          : t("status.textInjected");
        setStatusMsg(postInjectWarning || injectSuccessStatus);
        setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), postInjectWarning ? 3500 : 2000);
      } else if (mode === "B2") {
        if (store.incognito) {
          setStatusMsg(t("status.incognitoNoLlm"));
          return;
        }
        const profileB2 = store.contextAwareTone
          ? resolveAppProfile(windowTitle, store.appProfiles, "B2")
          : null;
        const effectiveB2 = resolveEffective(profileB2);
        const modeBPromptOverride = effectiveB2.promptAppendix
          ? `${store.modeBPrompt}\n\n${effectiveB2.promptAppendix}`
          : store.modeBPrompt;

        resetLlmRequestState(store.selectedText, result.transcript);
        await emitPreviewSession({
          sessionType: "text",
          sourceMode: "B2",
          selectedText: store.selectedText,
          instruction: result.transcript,
        });
        await showPreviewWindow({ focusable: true, focus: true });

        setStatusMsg(t("status.llmProcessing"));
        try {
          await mainWindowService.callLlm({
            selectedText: store.selectedText,
            instruction: result.transcript,
            outputMode: "PreviewStream",
            provider: store.llmProvider,
            model: store.llmModel,
            preferredLanguage: effectiveB2.lang,
            promptMode: "B",
            promptOverride: modeBPromptOverride,
            streamOutput: store.modeBStreamOutput,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          store.setLlmError(reason);
          await restoreClipboardAfterFailure("Mode B2 failure");
          setStatusMsg(t("status.routeFailed", { reason }));
          setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 2500);
        } finally {
          store.setIsLlmLoading(false);
        }
      } else if (mode === "C") {
        if (store.incognito) {
          setStatusMsg(t("status.incognitoNoLlm"));
          return;
        }
        const profileC = store.contextAwareTone
          ? resolveAppProfile(windowTitle, store.appProfiles, "C")
          : null;
        const effectiveC = resolveEffective(profileC);
        const modeCPromptOverride = effectiveC.promptAppendix
          ? `${store.modeCPrompt}\n\n${effectiveC.promptAppendix}`
          : store.modeCPrompt;
        const effectiveOutputModeC = effectiveC.outputMode;

        resetLlmRequestState("", result.transcript);
        if (effectiveOutputModeC === "PreviewStream") {
          await emitPreviewSession({
            sessionType: "text",
            sourceMode: "C",
            selectedText: "",
            instruction: result.transcript,
          });
          await showPreviewWindow({ focusable: true, focus: true });
        }

        setStatusMsg(t("status.llmProcessing"));
        try {
          await mainWindowService.callLlm({
            selectedText: "",
            instruction: result.transcript,
            outputMode: effectiveOutputModeC,
            provider: store.llmProvider,
            model: store.llmModel,
            preferredLanguage: effectiveC.lang,
            promptMode: "C",
            promptOverride: modeCPromptOverride,
            streamOutput: true,
          });
          if (effectiveOutputModeC === "DirectInject") {
            await mainWindowService.restoreClipboard();
            setStatusMsg(t("status.textInjected"));
            setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 2000);
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          store.setLlmError(reason);
          await restoreClipboardAfterFailure("Mode C failure");
          setStatusMsg(t("status.routeFailed", { reason }));
          setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 2500);
        } finally {
          store.setIsLlmLoading(false);
        }
      }
    } catch (err) {
      console.error("[App] route_transcript error:", err);
      setStatusMsg(t("status.routeFailed", { reason: String(err) }));
    }
  });
}
