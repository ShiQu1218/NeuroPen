import { mainWindowService } from "../../services/mainWindowService";
import type {
  AppLanguage,
  AppProfile,
  CustomLanguageVariant,
  LlmProvider,
  PreferredLanguage,
  QuickActionCommand,
  SttLanguage,
  TranslationTarget,
} from "../../store/useAppStore";
import { useAppStore } from "../../store/useAppStore";
import { normalizeSttEngine, normalizeSttLanguage } from "../../utils/appText";
import { hideWindowByLabel, preventCloseDestroy } from "../../utils/windowLifecycle";
import type { SelectionListenerState, StatusSetter, TranslateFn } from "./listenerTypes";

const MAIN_WINDOW_AUX_LABELS = [
  "settings",
  "preview",
  "quick-action",
  "recording-indicator",
  "screenshot-overlay",
] as const;

export interface SettingsSavedPayload {
  wakeWord?: string;
  hotkey?: string;
  dialogHotkey?: string;
  sttEnabled?: boolean;
  selectionEnabled?: boolean;
  screenshotEnabled?: boolean;
  sttEngine?: "openAi" | "localWhisper" | "senseVoice" | "moonshine";
  sttModelPath?: string;
  sttLanguage?: SttLanguage;
  outputMode?: "DirectInject" | "PreviewStream";
  sttOutputStrategy?: "raw" | "llmRefine";
  punctuationMode?: "off" | "balanced" | "aggressive";
  contextAwareTone?: boolean;
  vocabularyTerms?: string[];
  llmProvider?: LlmProvider;
  llmModel?: string;
  llmModelOptions?: string[];
  language?: AppLanguage;
  preferredLanguage?: PreferredLanguage;
  customLanguageVariants?: CustomLanguageVariant[];
  modeAPrompt?: string;
  modeBPrompt?: string;
  modeCPrompt?: string;
  modeAStreamOutput?: boolean;
  modeBStreamOutput?: boolean;
  ttsVoice?: string;
  ttsRate?: string;
  ttsPitch?: string;
  microphoneSource?: string;
  launchOnStartup?: boolean;
  quickActionCommands?: QuickActionCommand[];
  historyEnabled?: boolean;
  preferenceLearningEnabled?: boolean;
  appProfiles?: AppProfile[];
  translationTarget?: TranslationTarget;
  screenshotHotkey?: string;
}

export interface ModeStartPayload {
  has_selection: boolean;
  selected_text: string | null;
  initial_mode: string;
  hwnd: number;
}

export function createSelectionListenerState(): SelectionListenerState {
  return {
    qaInteracting: false,
    lastSelectionFingerprint: "",
    suppressedSelectionFingerprint: "",
    selectionWatchSuppressedUntil: 0,
    qaHideTimer: null,
    qaResyncTimer: null,
    lastSelectionSnapshot: null,
  };
}

export function cleanupSelectionListenerState(selectionState: SelectionListenerState) {
  if (selectionState.qaHideTimer) {
    clearTimeout(selectionState.qaHideTimer);
  }
  if (selectionState.qaResyncTimer) {
    clearTimeout(selectionState.qaResyncTimer);
  }
}

async function waitForStoreHydration() {
  if (useAppStore.persist.hasHydrated()) {
    return;
  }
  await new Promise<void>((resolve) => {
    useAppStore.persist.onFinishHydration(() => resolve());
  });
}

export async function initializeMainWindowRuntime() {
  for (const label of MAIN_WINDOW_AUX_LABELS) {
    preventCloseDestroy(label);
  }

  await waitForStoreHydration();

  const store = useAppStore.getState();
  const backendHotkeys = await mainWindowService.getRegisteredHotkeys().catch((err) => {
    console.warn("[App] get_registered_hotkeys failed:", err);
    return null;
  });

  const initialTriggerHotkey =
    backendHotkeys?.triggerPersisted ? backendHotkeys.triggerHotkey : store.hotkey;
  const initialScreenshotHotkey =
    backendHotkeys?.screenshotPersisted ? backendHotkeys.screenshotHotkey : store.screenshotHotkey;
  const initialDialogHotkey =
    backendHotkeys?.dialogPersisted ? backendHotkeys.dialogHotkey : store.dialogHotkey;

  if (initialTriggerHotkey !== store.hotkey) {
    store.setHotkey(initialTriggerHotkey);
  }
  if (initialScreenshotHotkey !== store.screenshotHotkey) {
    store.setScreenshotHotkey(initialScreenshotHotkey);
  }
  if (initialDialogHotkey !== store.dialogHotkey) {
    store.setDialogHotkey(initialDialogHotkey);
  }
  if (!backendHotkeys || backendHotkeys.triggerHotkey !== initialTriggerHotkey) {
    await mainWindowService.changeHotkey(initialTriggerHotkey).catch((err) => {
      console.warn("[App] change_hotkey init failed, keeping stored value:", err);
    });
  }
  if (!backendHotkeys || backendHotkeys.screenshotHotkey !== initialScreenshotHotkey) {
    await mainWindowService.changeScreenshotHotkey(initialScreenshotHotkey).catch((err) => {
      console.warn("[App] change_screenshot_hotkey init failed:", err);
    });
  }
  if (!backendHotkeys || backendHotkeys.dialogHotkey !== initialDialogHotkey) {
    await mainWindowService.changeDialogHotkey(initialDialogHotkey).catch((err) => {
      console.warn("[App] change_dialog_hotkey init failed:", err);
    });
  }

  await mainWindowService.setRuntimeSttConfig(
    normalizeSttEngine(String(store.sttEngine)),
    store.sttModelPath,
    normalizeSttLanguage(store.sttLanguage),
  ).catch((err) => {
    console.warn("[App] set_runtime_stt_config init failed:", err);
  });

  await mainWindowService.setAudioDevice(store.microphoneSource ?? "").catch((err) => {
    console.warn("[App] set_audio_device init failed:", err);
  });
}

export function applySettingsSavedPayload(
  payload: SettingsSavedPayload,
  t: TranslateFn,
  setStatusMsg: StatusSetter,
) {
  const store = useAppStore.getState();

  if (payload.wakeWord) {
    store.setWakeWord(payload.wakeWord);
  }
  if (typeof payload.hotkey === "string") {
    store.setHotkey(payload.hotkey);
  }
  if (typeof payload.dialogHotkey === "string") {
    store.setDialogHotkey(payload.dialogHotkey);
  }
  if (typeof payload.sttEnabled === "boolean") {
    store.setSttEnabled(payload.sttEnabled);
  }
  if (typeof payload.selectionEnabled === "boolean") {
    store.setSelectionEnabled(payload.selectionEnabled);
    if (!payload.selectionEnabled) {
      void hideWindowByLabel("quick-action");
    }
  }
  if (typeof payload.screenshotEnabled === "boolean") {
    store.setScreenshotEnabled(payload.screenshotEnabled);
    if (!payload.screenshotEnabled) {
      void hideWindowByLabel("screenshot-overlay");
    }
  }
  if (payload.sttEngine) {
    store.setSttEngine(normalizeSttEngine(payload.sttEngine));
  }
  if (payload.sttLanguage) {
    store.setSttLanguage(normalizeSttLanguage(payload.sttLanguage));
  }
  if (typeof payload.sttModelPath === "string") {
    store.setSttModelPath(payload.sttModelPath);
  }
  if (payload.sttEngine || payload.sttLanguage || typeof payload.sttModelPath === "string") {
    void mainWindowService.setRuntimeSttConfig(
      normalizeSttEngine(payload.sttEngine ?? "openAi"),
      typeof payload.sttModelPath === "string" ? payload.sttModelPath : "",
      normalizeSttLanguage(payload.sttLanguage),
    ).catch((err) => {
      console.warn("[App] set_runtime_stt_config sync failed:", err);
    });
  }
  if (payload.outputMode) {
    store.setOutputMode(payload.outputMode);
  }
  if (payload.sttOutputStrategy) {
    store.setSttOutputStrategy(payload.sttOutputStrategy);
  }
  if (payload.punctuationMode) {
    store.setPunctuationMode(payload.punctuationMode);
  }
  if (typeof payload.contextAwareTone === "boolean") {
    store.setContextAwareTone(payload.contextAwareTone);
  }
  if (payload.vocabularyTerms) {
    store.setVocabularyTerms(payload.vocabularyTerms);
  }
  if (payload.llmProvider) {
    store.setLlmProvider(payload.llmProvider);
  }
  if (payload.llmModel) {
    store.setLlmModel(payload.llmModel);
  }
  if (payload.llmModelOptions) {
    store.setLlmModelOptions(payload.llmModelOptions);
  }
  if (payload.customLanguageVariants) {
    store.setCustomLanguageVariants(payload.customLanguageVariants);
  }
  if (payload.language) {
    store.setLanguage(payload.language);
  }
  if (payload.preferredLanguage) {
    store.setPreferredLanguage(payload.preferredLanguage);
  }
  if (typeof payload.modeAPrompt === "string") {
    store.setModeAPrompt(payload.modeAPrompt);
  }
  if (typeof payload.modeBPrompt === "string") {
    store.setModeBPrompt(payload.modeBPrompt);
  }
  if (typeof payload.modeCPrompt === "string") {
    store.setModeCPrompt(payload.modeCPrompt);
  }
  if (typeof payload.modeAStreamOutput === "boolean") {
    store.setModeAStreamOutput(payload.modeAStreamOutput);
  }
  if (typeof payload.modeBStreamOutput === "boolean") {
    store.setModeBStreamOutput(payload.modeBStreamOutput);
  }
  // Keep the main-window store aligned with settings-saved so preview TTS picks
  // up newly applied voice/rate/pitch values immediately.
  if (typeof payload.ttsVoice === "string") {
    store.setTtsVoice(payload.ttsVoice);
  }
  if (typeof payload.ttsRate === "string") {
    store.setTtsRate(payload.ttsRate);
  }
  if (typeof payload.ttsPitch === "string") {
    store.setTtsPitch(payload.ttsPitch);
  }
  if (typeof payload.microphoneSource === "string") {
    store.setMicrophoneSource(payload.microphoneSource);
  }
  if (typeof payload.launchOnStartup === "boolean") {
    store.setLaunchOnStartup(payload.launchOnStartup);
  }
  if (payload.quickActionCommands) {
    store.setQuickActionCommands(payload.quickActionCommands);
  }
  if (typeof payload.historyEnabled === "boolean") {
    store.setHistoryEnabled(payload.historyEnabled);
  }
  if (typeof payload.preferenceLearningEnabled === "boolean") {
    store.setPreferenceLearningEnabled(payload.preferenceLearningEnabled);
  }
  if (payload.appProfiles) {
    store.setAppProfiles(payload.appProfiles);
  }
  if (payload.translationTarget) {
    store.setTranslationTarget(payload.translationTarget);
  }
  if (typeof payload.screenshotHotkey === "string") {
    store.setScreenshotHotkey(payload.screenshotHotkey);
  }

  setStatusMsg(t("status.settingsUpdated"));
  setTimeout(() => setStatusMsg(t("status.readyHoldHotkey")), 2000);
}
