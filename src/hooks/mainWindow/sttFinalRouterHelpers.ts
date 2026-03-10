import { mainWindowService } from "../../services/mainWindowService";
import { useAppStore } from "../../store/useAppStore";
import type { AppProfileMode, OutputMode, PreferredLanguage } from "../../store/useAppStore";
import { resolveAppProfile } from "../../utils/appText";
import {
  emitPreviewSession,
  emitPreviewStaticOutput,
  showPreviewWindow,
  type PreviewSourceMode,
} from "../../utils/previewWindow";
import type { StatusSetter, TranslateFn } from "./listenerTypes";

type AppStoreSnapshot = ReturnType<typeof useAppStore.getState>;

export interface EffectiveProfile {
  lang: PreferredLanguage;
  outputMode: OutputMode;
  promptAppendix: string;
  toneHint: string;
  directPaste: boolean | null;
}

interface HistorySaveParams {
  mode: PreviewSourceMode;
  inputText: string;
  instruction: string;
  output: string;
  provider?: string;
  model?: string;
}

export const isLikelyAuthError = (err: unknown) =>
  /(401|unauthorized|api\s*key|authentication|invalid key)/i.test(String(err));

export const createLlmRequestStateReset = (store: AppStoreSnapshot) => (selectedText: string, instruction: string) => {
  store.setLlmOutput("");
  store.setIsLlmLoading(true);
  store.setLlmError("");
  store.setLastSelectedText(selectedText);
  store.setLastInstruction(instruction);
};

export const restoreClipboardAfterFailure = async (context: string) => {
  await mainWindowService.restoreClipboard().catch((restoreErr) => {
    console.warn(`[App] restore_clipboard failed after ${context}:`, restoreErr);
  });
};

export const resolveEffectiveProfile = (
  store: AppStoreSnapshot,
  windowTitle: string,
  mode: AppProfileMode,
): EffectiveProfile => {
  const profile = store.contextAwareTone
    ? resolveAppProfile(windowTitle, store.appProfiles, mode)
    : null;
  return {
    lang: (profile?.preferredLanguage || store.preferredLanguage) as PreferredLanguage,
    outputMode: (profile?.outputMode || store.outputMode) as OutputMode,
    promptAppendix: profile?.promptAppendix || "",
    toneHint: profile?.toneHint || (store.contextAwareTone ? "Keep neutral and clear style." : "Keep original style."),
    directPaste: profile?.directPaste ?? null,
  };
};

export const buildPromptOverride = (basePrompt: string, promptAppendix: string) =>
  promptAppendix ? `${basePrompt}\n\n${promptAppendix}` : basePrompt;

export const openPreviewTextSession = async (
  sourceMode: PreviewSourceMode,
  selectedText: string,
  instruction: string,
  staticOutput?: string,
) => {
  await emitPreviewSession({
    sessionType: "text",
    sourceMode,
    selectedText,
    instruction,
  });
  await showPreviewWindow({ focusable: true, focus: true });
  if (typeof staticOutput === "string") {
    await emitPreviewStaticOutput(staticOutput);
  }
};

export const saveHistoryIfAllowed = (store: AppStoreSnapshot, payload: HistorySaveParams) => {
  if (!store.historyEnabled || store.incognito) {
    return;
  }
  void mainWindowService.historySave({
    mode: payload.mode,
    inputText: payload.inputText,
    instruction: payload.instruction,
    output: payload.output,
    provider: payload.provider ?? "",
    model: payload.model ?? "",
  });
};

export const setReadyStatus = (
  setStatusMsg: StatusSetter,
  t: TranslateFn,
  delayMs = 0,
) => {
  if (delayMs > 0) {
    setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), delayMs);
    return;
  }
  setStatusMsg(t("status.readyHoldHotkey"));
};

export const setRouteFailureStatus = (
  setStatusMsg: StatusSetter,
  t: TranslateFn,
  reason: string,
) => {
  setStatusMsg(t("status.routeFailed", { reason }));
  setReadyStatus(setStatusMsg, t, 2500);
};
