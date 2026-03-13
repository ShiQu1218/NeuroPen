import { mainWindowService } from "../../services/mainWindowService";
import { useAppStore } from "../../store/useAppStore";
import {
  buildOtherPreferenceCategory,
  generatePreferenceRequestId,
} from "../../utils/preferenceLearning";
import {
  applyPunctuationMode,
  formatModeAText,
  isLikelyUnexpectedEnglishTranslation,
  normalizeStructuredText,
  stripWrappingQuotes,
} from "../../utils/appText";
import type { ErrorSetter, SafeRegister, StatusSetter, TranslateFn } from "./listenerTypes";
import {
  buildPromptOverride,
  createLlmRequestStateReset,
  getPreferenceSummaryIfEnabled,
  isLikelyAuthError,
  openPreviewTextSession,
  resolveEffectiveProfile,
  restoreClipboardAfterFailure,
  saveHistoryIfAllowed,
  setReadyStatus,
  setRouteFailureStatus,
} from "./sttFinalRouterHelpers";
import { resolveLanguageVariantPromptInstructionForLanguage } from "../../utils/languageVariants";

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
    // This is the main mode handoff: raw final STT arrives here and then branches
    // into direct injection, selected-text editing, or assistant-preview flows.
    const transcript = event.payload.text;
    if (import.meta.env.DEV) console.log("[App] stt://final:", transcript);
    if (!transcript.trim()) {
      setStatusMsg(t("status.noValidSpeech"));
      setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 1500);
      return;
    }

    const store = useAppStore.getState();
    store.setTranscript(transcript);
    const resetLlmRequestState = createLlmRequestStateReset(store);

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

      if (mode === "A") {
        const modeACategory = buildOtherPreferenceCategory(t("history.preferenceOther"));
        const modeARequestId = generatePreferenceRequestId();
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
        const effectiveA = resolveEffectiveProfile(store, windowTitle, "A");
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

        const modeAPromptOverride = buildPromptOverride(
          store.modeAPrompt,
          effectiveA.promptAppendix,
          await getPreferenceSummaryIfEnabled(store, modeACategory.key),
        );

        if (canStreamModeAPreview && llmReady) {
          // Stream directly into preview only when Mode A is doing exactly one LLM
          // pass. Chaining refine + translate would make the visible partial output misleading.
          const instruction = shouldTranslate ? translateInstruction : refineInstruction;
          const preferredLanguage = shouldTranslate
            ? resolveLanguageVariantPromptInstructionForLanguage(
              store.translationTarget,
              effectiveA.languagePreferences,
              store.customLanguageVariants
            )
            : effectiveA.lang;
          resetLlmRequestState(finalText, instruction);
          store.setCurrentRequestContext({
            requestId: modeARequestId,
            preferenceCategoryKey: modeACategory.key,
            preferenceCategoryLabel: modeACategory.label,
          });
          store.setCurrentFeedbackRating(null);
          await openPreviewTextSession("A", finalText, instruction, undefined, {
            promptAppendix: effectiveA.promptAppendix,
            preferredLanguage,
            requestId: modeARequestId,
            preferenceCategoryKey: modeACategory.key,
            preferenceCategoryLabel: modeACategory.label,
          });
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
              requestId: modeARequestId,
            });
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            store.setLlmError(reason);
            setRouteFailureStatus(setStatusMsg, t, reason);
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
              preferredLanguage: resolveLanguageVariantPromptInstructionForLanguage(
                store.translationTarget,
                effectiveA.languagePreferences,
                store.customLanguageVariants
              ),
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

        // A profile can opt a specific app back into direct paste even when the
        // global Mode A behavior is preview-first.
        const shouldDirectPasteModeA = effectiveA.directPaste === true;
        if (effectiveOutputModeA === "PreviewStream" && !shouldDirectPasteModeA) {
          store.setLastSelectedText(finalText);
          store.setLastInstruction("");
          store.setCurrentRequestContext({
            requestId: modeARequestId,
            preferenceCategoryKey: modeACategory.key,
            preferenceCategoryLabel: modeACategory.label,
          });
          store.setCurrentFeedbackRating(null);
          await openPreviewTextSession("A", finalText, "", finalText, {
            promptAppendix: effectiveA.promptAppendix,
            preferredLanguage: effectiveA.lang,
            requestId: modeARequestId,
            preferenceCategoryKey: modeACategory.key,
            preferenceCategoryLabel: modeACategory.label,
          });

          saveHistoryIfAllowed(store, {
            mode: "A",
            inputText: result.transcript,
            instruction: "",
            output: finalText,
            provider: usedLlmForModeA ? store.llmProvider : "",
            model: usedLlmForModeA ? store.llmModel : "",
            requestId: modeARequestId,
            preferenceCategoryKey: modeACategory.key,
            preferenceCategoryLabel: modeACategory.label,
          });

          if (postInjectWarning) {
            setStatusMsg(postInjectWarning);
            setReadyStatus(setStatusMsg, t, 3500);
          } else {
            setReadyStatus(setStatusMsg, t);
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

        saveHistoryIfAllowed(store, {
          mode: "A",
          inputText: result.transcript,
          instruction: "",
          output: finalText,
          provider: usedLlmForModeA ? store.llmProvider : "",
          model: usedLlmForModeA ? store.llmModel : "",
          requestId: modeARequestId,
          preferenceCategoryKey: modeACategory.key,
          preferenceCategoryLabel: modeACategory.label,
        });

        const injectSuccessStatus = usedLlmForModeA
          ? t("status.llmProcessedInjected")
          : t("status.textInjected");
        setStatusMsg(postInjectWarning || injectSuccessStatus);
        setReadyStatus(setStatusMsg, t, postInjectWarning ? 3500 : 2000);
      } else if (mode === "B2") {
        if (store.incognito) {
          setStatusMsg(t("status.incognitoNoLlm"));
          return;
        }
        // Mode B2 always preserves the original selected text separately and sends
        // the spoken instruction as the transformation request.
        const effectiveB2 = resolveEffectiveProfile(store, windowTitle, "B2");
        const modeB2Category = buildOtherPreferenceCategory(t("history.preferenceOther"));
        const modeB2RequestId = generatePreferenceRequestId();
        const modeBPromptOverride = buildPromptOverride(
          store.modeBPrompt,
          effectiveB2.promptAppendix,
          await getPreferenceSummaryIfEnabled(store, modeB2Category.key),
        );

        resetLlmRequestState(store.selectedText, result.transcript);
        store.setCurrentRequestContext({
          requestId: modeB2RequestId,
          preferenceCategoryKey: modeB2Category.key,
          preferenceCategoryLabel: modeB2Category.label,
        });
        store.setCurrentFeedbackRating(null);
        await openPreviewTextSession("B2", store.selectedText, result.transcript, undefined, {
          promptAppendix: effectiveB2.promptAppendix,
          preferredLanguage: effectiveB2.lang,
          requestId: modeB2RequestId,
          preferenceCategoryKey: modeB2Category.key,
          preferenceCategoryLabel: modeB2Category.label,
        });

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
            requestId: modeB2RequestId,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          store.setLlmError(reason);
          await restoreClipboardAfterFailure("Mode B2 failure");
          setRouteFailureStatus(setStatusMsg, t, reason);
        } finally {
          store.setIsLlmLoading(false);
        }
      } else if (mode === "C") {
        if (store.incognito) {
          setStatusMsg(t("status.incognitoNoLlm"));
          return;
        }
        // Mode C treats the transcript as a standalone assistant query with no
        // source text, so output mode comes entirely from the effective profile.
        const effectiveC = resolveEffectiveProfile(store, windowTitle, "C");
        const modeCCategory = buildOtherPreferenceCategory(t("history.preferenceOther"));
        const modeCRequestId = generatePreferenceRequestId();
        const modeCPromptOverride = buildPromptOverride(
          store.modeCPrompt,
          effectiveC.promptAppendix,
          await getPreferenceSummaryIfEnabled(store, modeCCategory.key),
        );
        const effectiveOutputModeC = effectiveC.outputMode;

        resetLlmRequestState("", result.transcript);
        store.setCurrentRequestContext({
          requestId: modeCRequestId,
          preferenceCategoryKey: modeCCategory.key,
          preferenceCategoryLabel: modeCCategory.label,
        });
        store.setCurrentFeedbackRating(null);
        if (effectiveOutputModeC === "PreviewStream") {
          await openPreviewTextSession("C", "", result.transcript, undefined, {
            promptAppendix: effectiveC.promptAppendix,
            preferredLanguage: effectiveC.lang,
            requestId: modeCRequestId,
            preferenceCategoryKey: modeCCategory.key,
            preferenceCategoryLabel: modeCCategory.label,
          });
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
            requestId: modeCRequestId,
          });
          if (effectiveOutputModeC === "DirectInject") {
            await mainWindowService.restoreClipboard();
            setStatusMsg(t("status.textInjected"));
            setReadyStatus(setStatusMsg, t, 2000);
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          store.setLlmError(reason);
          await restoreClipboardAfterFailure("Mode C failure");
          setRouteFailureStatus(setStatusMsg, t, reason);
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
