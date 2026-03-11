/**
 * Settings UI
 *
 * Phase 4 implementation:
 * - Hotkey configuration (default: Alt+`)
 * - Wake word setting (default: 助理)
 * - STT engine selector (OpenAI Whisper API / Local Whisper)
 * - Local STT model manager (install / delete / select active model)
 * - LLM output mode: DirectInject | PreviewStream
 * - OpenAI API key input — sent to Rust backend, never stored in localStorage
 * - Incognito mode toggle
 *
 * State is persisted via the Zustand store (localStorage), except API key
 * which is stored only in Rust process memory via the set_api_key command.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n, type TranslationKey } from "../i18n";
import { settingsService } from "../services/settingsService";
import {
  normalizeLlmModelOptions,
  useAppStore,
  type AppLanguage,
  type AppProfile,
  type PreferredLanguage,
  type TranslationTarget,
  type QuickActionCommand,
  type SttOutputStrategy,
  type SttLanguage,
  type PunctuationMode,
} from "../store/useAppStore";
import SettingsAppProfileSection from "./settings/SettingsAppProfileSection";
import SettingsFooter from "./settings/SettingsFooter";
import SettingsGeneralSection from "./settings/SettingsGeneralSection";
import SettingsHistorySection from "./settings/SettingsHistorySection";
import SettingsLlmSection from "./settings/SettingsLlmSection";
import SettingsQuickActionSection from "./settings/SettingsQuickActionSection";
import SettingsShortcutsSection from "./settings/SettingsShortcutsSection";
import SettingsSidebar from "./settings/SettingsSidebar";
import SettingsSttSection from "./settings/SettingsSttSection";
import SettingsTtsSection from "./settings/SettingsTtsSection";
import {
  NAV_ITEMS,
  OPENAI_STT_MODEL,
  STATUS_RESET_MS,
  type LocalSttModel,
  type LocalTtsModel,
  type ModelDownloadProgressEvent,
  type SettingsSection,
} from "./settings/settingsShared";

export default function Settings() {
  const {
    wakeWord, setWakeWord,
    sttModelPath, setSttModelPath,
    outputMode, setOutputMode,
    sttOutputStrategy, setSttOutputStrategy,
    punctuationMode, setPunctuationMode,
    contextAwareTone, setContextAwareTone,
    vocabularyTerms, setVocabularyTerms,
    llmProvider, setLlmProvider,
    llmModel, setLlmModel,
    llmModelOptions, setLlmModelOptions,
    sttEnabled, setSttEnabled,
    selectionEnabled, setSelectionEnabled,
    screenshotEnabled, setScreenshotEnabled,
    hotkey, setHotkey,
    screenshotHotkey, setScreenshotHotkey,
    dialogHotkey, setDialogHotkey,
    sttEngine, setSttEngine,
    sttLanguage, setSttLanguage,
    preferredLanguage, setPreferredLanguage,
    microphoneSource, setMicrophoneSource,
    launchOnStartup, setLaunchOnStartup,
    quickActionCommands, setQuickActionCommands,
    language, setLanguage,
    localSttAvailable, setLocalSttAvailable,
    apiKeySet, setApiKeySet,
    ttsVoice, setTtsVoice,
    ttsRate, setTtsRate,
    ttsPitch, setTtsPitch,
    modeAPrompt, setModeAPrompt,
    modeBPrompt, setModeBPrompt,
    modeCPrompt, setModeCPrompt,
    modeAStreamOutput, setModeAStreamOutput,
    modeBStreamOutput, setModeBStreamOutput,
    translationTarget, setTranslationTarget,
    historyEnabled, setHistoryEnabled,
    appProfiles, setAppProfiles,
  } = useAppStore();
  const { t } = useI18n();
  const sectionLabelKey: Record<SettingsSection, TranslationKey> = {
    general: "settings.section.general",
    shortcuts: "settings.section.shortcuts",
    stt: "settings.section.stt",
    llm: "settings.section.llm",
    quickAction: "settings.section.quickAction",
    tts: "settings.section.tts",
    appProfile: "settings.section.appProfile",
    history: "settings.section.history",
  };
  const sttModelNameKey: Partial<Record<string, TranslationKey>> = {
    "whisper-small": "settings.stt.model.whisper-small.name",
    "whisper-medium": "settings.stt.model.whisper-medium.name",
    "whisper-large": "settings.stt.model.whisper-large.name",
    "whisper-turbo": "settings.stt.model.whisper-turbo.name",
    "sensevoice-small": "settings.stt.model.sensevoice-small.name",
    "moonshine-base": "settings.stt.model.moonshine-base.name",
    "moonshine-tiny": "settings.stt.model.moonshine-tiny.name",
  };
  const sttModelDescriptionKey: Partial<Record<string, TranslationKey>> = {
    "whisper-small": "settings.stt.model.whisper-small.description",
    "whisper-medium": "settings.stt.model.whisper-medium.description",
    "whisper-large": "settings.stt.model.whisper-large.description",
    "whisper-turbo": "settings.stt.model.whisper-turbo.description",
    "sensevoice-small": "settings.stt.model.sensevoice-small.description",
    "moonshine-base": "settings.stt.model.moonshine-base.description",
    "moonshine-tiny": "settings.stt.model.moonshine-tiny.description",
  };
  const getLocalizedModelName = (model: LocalSttModel) =>
    sttModelNameKey[model.id] ? t(sttModelNameKey[model.id]!) : model.name;
  const getLocalizedModelDescription = (model: LocalSttModel) =>
    sttModelDescriptionKey[model.id] ? t(sttModelDescriptionKey[model.id]!) : model.description;
  const engineFromModelEngine = (eng: string): "openAi" | "localWhisper" | "senseVoice" | "moonshine" => {
    switch (eng) {
      case "sensevoice": return "senseVoice";
      case "moonshine": return "moonshine";
      default: return "localWhisper";
    }
  };
  const resolveEngineAndPathByModel = (modelChoice: string): { engine: "openAi" | "localWhisper" | "senseVoice" | "moonshine"; modelPath: string } => {
    if (modelChoice === OPENAI_STT_MODEL) {
      return { engine: "openAi", modelPath: "" };
    }
    const matchedLocalModel = localModels.find((model) => model.id === modelChoice && model.installed);
    if (matchedLocalModel) {
      return { engine: engineFromModelEngine(matchedLocalModel.engine), modelPath: matchedLocalModel.modelPath };
    }
    const fallbackLocal = localModels.find((model) => model.installed && model.modelPath === sttModelPath)
      ?? localModels.find((model) => model.installed && model.active);
    if (fallbackLocal) {
      return { engine: engineFromModelEngine(fallbackLocal.engine), modelPath: fallbackLocal.modelPath };
    }
    return { engine: "openAi", modelPath: "" };
  };

  // Local input state
  const [sttApiKeyInput, setSttApiKeyInput] = useState("");
  const [sttApiKeySet, setSttApiKeySet] = useState(false);
  const [sttApiKeySaveStatus, setSttApiKeySaveStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaveStatus, setApiKeySaveStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [hotkeyStatus, setHotkeyStatus] = useState<"" | "error">("");
  const [hotkeyErrorMessage, setHotkeyErrorMessage] = useState("");
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<"" | "saved" | "error">("");
  const [draftWakeWord, setDraftWakeWord] = useState(wakeWord);
  const [draftSttEnabled, setDraftSttEnabled] = useState(sttEnabled);
  const [draftSelectionEnabled, setDraftSelectionEnabled] = useState(selectionEnabled);
  const [draftScreenshotEnabled, setDraftScreenshotEnabled] = useState(screenshotEnabled);
  const [draftHotkey, setDraftHotkey] = useState(hotkey);
  const [draftScreenshotHotkey, setDraftScreenshotHotkey] = useState(screenshotHotkey);
  const [draftDialogHotkey, setDraftDialogHotkey] = useState(dialogHotkey);
  const [draftSttEngine, setDraftSttEngine] = useState(sttEngine);
  const [draftSttLanguage, setDraftSttLanguage] = useState<SttLanguage>(sttLanguage);
  const [draftSttModelChoice, setDraftSttModelChoice] = useState<string>(
    sttEngine === "openAi" ? OPENAI_STT_MODEL : sttEngine
  );
  const [draftOutputMode, setDraftOutputMode] = useState(outputMode);
  const [draftSttOutputStrategy, setDraftSttOutputStrategy] = useState<SttOutputStrategy>(sttOutputStrategy);
  const [draftPunctuationMode, setDraftPunctuationMode] = useState<PunctuationMode>(punctuationMode);
  const [draftContextAwareTone, setDraftContextAwareTone] = useState(contextAwareTone);
  const [draftVocabularyTerms, setDraftVocabularyTerms] = useState(vocabularyTerms.join("\n"));
  const [draftLlmProvider, setDraftLlmProvider] = useState(llmProvider);
  const [draftLlmModel, setDraftLlmModel] = useState(llmModel);
  const [draftLlmModelOptions, setDraftLlmModelOptions] = useState<string[]>(llmModelOptions);
  const [draftTtsVoice, setDraftTtsVoice] = useState(ttsVoice);
  const [draftTtsRate, setDraftTtsRate] = useState(ttsRate);
  const [draftTtsPitch, setDraftTtsPitch] = useState(ttsPitch);
  const [draftModeAPrompt, setDraftModeAPrompt] = useState(modeAPrompt);
  const [draftModeBPrompt, setDraftModeBPrompt] = useState(modeBPrompt);
  const [draftModeCPrompt, setDraftModeCPrompt] = useState(modeCPrompt);
  const [draftModeAStreamOutput, setDraftModeAStreamOutput] = useState(modeAStreamOutput);
  const [draftModeBStreamOutput, setDraftModeBStreamOutput] = useState(modeBStreamOutput);
  const [draftPreferredLanguage, setDraftPreferredLanguage] = useState<PreferredLanguage>(preferredLanguage);
  const [draftMicrophoneSource, setDraftMicrophoneSource] = useState(microphoneSource);
  const [draftLaunchOnStartup, setDraftLaunchOnStartup] = useState(launchOnStartup);
  const [draftQuickActionCommands, setDraftQuickActionCommands] = useState<QuickActionCommand[]>(quickActionCommands);
  const [draftLanguage, setDraftLanguage] = useState<AppLanguage>(language);
  const [draftHistoryEnabled, setDraftHistoryEnabled] = useState(historyEnabled);
  const [draftAppProfiles, setDraftAppProfiles] = useState<AppProfile[]>(appProfiles);
  const [draftTranslationTarget, setDraftTranslationTarget] = useState<TranslationTarget>(translationTarget);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [audioDevicesLoading, setAudioDevicesLoading] = useState(false);
  const [localModels, setLocalModels] = useState<LocalSttModel[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = useState(false);
  const [localModelBusyId, setLocalModelBusyId] = useState("");
  const [localModelBusyAction, setLocalModelBusyAction] = useState<"" | "install" | "delete">("");
  const [localModelDownloadProgress, setLocalModelDownloadProgress] = useState<Record<string, ModelDownloadProgressEvent>>({});
  const [failedDownloadModelId, setFailedDownloadModelId] = useState("");
  const [localModelStatus, setLocalModelStatus] = useState<{ type: "" | "success" | "error"; message: string }>({
    type: "",
    message: "",
  });
  const [localTtsModels, setLocalTtsModels] = useState<LocalTtsModel[]>([]);
  const [localTtsModelsLoading, setLocalTtsModelsLoading] = useState(false);
  const [ttsModelBusyId, setTtsModelBusyId] = useState("");
  const [ttsModelBusyAction, setTtsModelBusyAction] = useState<"" | "install" | "delete" | "select">("");
  const [ttsModelDownloadProgress, setTtsModelDownloadProgress] = useState<Record<string, ModelDownloadProgressEvent>>({});
  const [failedTtsDownloadModelId, setFailedTtsDownloadModelId] = useState("");
  const [ttsModelStatus, setTtsModelStatus] = useState<{ type: "" | "success" | "error"; message: string }>({
    type: "",
    message: "",
  });
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [storeHydrated, setStoreHydrated] = useState(useAppStore.persist.hasHydrated());

  // Prevent the settings window from being destroyed on close — hide it instead.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      event.preventDefault();
      await win.hide();
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  // Query backend once on mount
  useEffect(() => {
    if (useAppStore.persist.hasHydrated()) {
      setStoreHydrated(true);
      return;
    }
    const unsubscribe = useAppStore.persist.onFinishHydration(() => {
      setStoreHydrated(true);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    settingsService.getSttCapabilities()
      .then((caps) => {
        setLocalSttAvailable(caps.localAvailable);
      })
      .catch(() => {
        setLocalSttAvailable(false);
      });

    settingsService.hasApiKey()
      .then((has) => setApiKeySet(has))
      .catch(() => setApiKeySet(false));

    settingsService.hasSttApiKey()
      .then((has) => setSttApiKeySet(has))
      .catch(() => setSttApiKeySet(false));

    setAudioDevicesLoading(true);
    settingsService.listAudioDevices()
      .then((devices) => setAudioDevices(devices))
      .catch(() => setAudioDevices([]))
      .finally(() => setAudioDevicesLoading(false));

    settingsService.getLaunchOnStartup()
      .then((enabled) => {
        setDraftLaunchOnStartup(enabled);
      })
      .catch(() => {});

    void (async () => {
      if (!useAppStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          const unsubscribe = useAppStore.persist.onFinishHydration(() => {
            unsubscribe?.();
            resolve();
          });
        });
      }
      const registeredHotkeys = await settingsService.getRegisteredHotkeys().catch((err) => {
        console.warn("[Settings] get_registered_hotkeys failed:", err);
        return null;
      });
      if (!registeredHotkeys) return;
      const currentState = useAppStore.getState();
      const effectiveTriggerHotkey = registeredHotkeys.triggerPersisted
        ? registeredHotkeys.triggerHotkey
        : currentState.hotkey;
      const effectiveScreenshotHotkey = registeredHotkeys.screenshotPersisted
        ? registeredHotkeys.screenshotHotkey
        : currentState.screenshotHotkey;
      const effectiveDialogHotkey = registeredHotkeys.dialogPersisted
        ? registeredHotkeys.dialogHotkey
        : currentState.dialogHotkey;
      setHotkey(effectiveTriggerHotkey);
      setScreenshotHotkey(effectiveScreenshotHotkey);
      setDialogHotkey(effectiveDialogHotkey);
      setDraftHotkey(effectiveTriggerHotkey);
      setDraftScreenshotHotkey(effectiveScreenshotHotkey);
      setDraftDialogHotkey(effectiveDialogHotkey);
    })();
  }, []);

  // Sync all drafts from store (2a: merged 7 useEffects into 1)
  useEffect(() => {
    if (!storeHydrated) return;
    const matchedLocalModel = localModels.find((model) => model.modelPath === sttModelPath)
      ?? localModels.find((model) => model.active);
    const nextSttModelChoice =
      sttEngine === "openAi"
        ? OPENAI_STT_MODEL
        : matchedLocalModel?.id ?? OPENAI_STT_MODEL;
    setDraftWakeWord(wakeWord);
    setDraftSttEnabled(sttEnabled);
    setDraftSelectionEnabled(selectionEnabled);
    setDraftScreenshotEnabled(screenshotEnabled);
    setDraftHotkey(hotkey);
    setDraftScreenshotHotkey(screenshotHotkey);
    setDraftDialogHotkey(dialogHotkey);
    setDraftSttEngine(sttEngine);
    setDraftSttLanguage(sttLanguage);
    setDraftSttModelChoice(nextSttModelChoice);
    setDraftOutputMode(outputMode);
    setDraftSttOutputStrategy(sttOutputStrategy);
    setDraftPunctuationMode(punctuationMode);
    setDraftContextAwareTone(contextAwareTone);
    setDraftVocabularyTerms(vocabularyTerms.join("\n"));
    setDraftLlmProvider(llmProvider);
    setDraftLlmModel(llmModel);
    setDraftLlmModelOptions(normalizeLlmModelOptions(llmModelOptions, llmModel));
    setDraftTtsVoice(ttsVoice);
    setDraftTtsRate(ttsRate);
    setDraftTtsPitch(ttsPitch);
    setDraftModeAPrompt(modeAPrompt);
    setDraftModeBPrompt(modeBPrompt);
    setDraftModeCPrompt(modeCPrompt);
    setDraftModeAStreamOutput(modeAStreamOutput);
    setDraftModeBStreamOutput(modeBStreamOutput);
    setDraftPreferredLanguage(preferredLanguage);
    setDraftMicrophoneSource(microphoneSource);
    setDraftLaunchOnStartup(launchOnStartup);
    setDraftQuickActionCommands(quickActionCommands);
    setDraftLanguage(language);
    setDraftHistoryEnabled(historyEnabled);
    setDraftAppProfiles(appProfiles);
    setDraftTranslationTarget(translationTarget);
  }, [
    wakeWord,
    sttEnabled,
    selectionEnabled,
    screenshotEnabled,
    hotkey,
    screenshotHotkey,
    dialogHotkey,
    sttEngine,
    sttLanguage,
    outputMode,
    sttOutputStrategy,
    punctuationMode,
    contextAwareTone,
    vocabularyTerms,
    llmProvider,
    llmModel,
    llmModelOptions,
    ttsVoice,
    ttsRate,
    ttsPitch,
    modeAPrompt,
    modeBPrompt,
    modeCPrompt,
    modeAStreamOutput,
    modeBStreamOutput,
    preferredLanguage,
    microphoneSource,
    launchOnStartup,
    quickActionCommands,
    language,
    historyEnabled,
    appProfiles,
    translationTarget,
    localModels,
    sttModelPath,
    storeHydrated,
  ]);

  const loadLocalModels = useCallback(async () => {
    setLocalModelsLoading(true);
    try {
      const models = await settingsService.listLocalSttModels();
      setLocalModels(models);
    } catch (err) {
      console.error("[Settings] list_local_stt_models failed:", err);
      setLocalModelStatus({ type: "error", message: t("settings.error.loadModels") });
    } finally {
      setLocalModelsLoading(false);
    }
  }, [t]);

  const loadLocalTtsModels = useCallback(async () => {
    setLocalTtsModelsLoading(true);
    try {
      const models = await settingsService.listLocalTtsModels();
      setLocalTtsModels(models);
    } catch (err) {
      console.error("[Settings] list_local_tts_models failed:", err);
      setTtsModelStatus({ type: "error", message: t("settings.error.loadTtsModels") });
    } finally {
      setLocalTtsModelsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadLocalModels();
  }, [loadLocalModels]);

  useEffect(() => {
    void loadLocalTtsModels();
  }, [loadLocalTtsModels]);

  useEffect(() => {
    let disposed = false;
    let unlistenProgress: (() => void) | undefined;
    void listen<ModelDownloadProgressEvent>("stt://model-download-progress", (event) => {
      if (disposed) return;
      const payload = event.payload;
      setLocalModelDownloadProgress((prev) => ({ ...prev, [payload.modelId]: payload }));
      if (payload.status === "done") {
        setFailedDownloadModelId("");
      } else if (payload.status === "cancelled" || payload.status === "error") {
        setFailedDownloadModelId(payload.modelId);
      }
    }).then((unlistenFn) => {
      if (disposed) {
        unlistenFn();
      } else {
        unlistenProgress = unlistenFn;
      }
    });
    return () => {
      disposed = true;
      unlistenProgress?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenProgress: (() => void) | undefined;
    void listen<ModelDownloadProgressEvent>("tts://model-download-progress", (event) => {
      if (disposed) return;
      const payload = event.payload;
      setTtsModelDownloadProgress((prev) => ({ ...prev, [payload.modelId]: payload }));
      if (payload.status === "done") {
        setFailedTtsDownloadModelId("");
      } else if (payload.status === "cancelled" || payload.status === "error") {
        setFailedTtsDownloadModelId(payload.modelId);
      }
    }).then((unlistenFn) => {
      if (disposed) {
        unlistenFn();
      } else {
        unlistenProgress = unlistenFn;
      }
    });
    return () => {
      disposed = true;
      unlistenProgress?.();
    };
  }, []);

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return "0 MB";
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const normalizeHotkey = (value: string) =>
    value
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/CONTROL/g, "CTRL");

  const handleSaveApiKey = () => {
    setApiKeySaveStatus("saving");
    settingsService.setApiKey(apiKeyInput)
      .then(() => {
        setApiKeySet(apiKeyInput.length > 0);
        setApiKeyInput("");
        setApiKeySaveStatus("saved");
        setTimeout(() => setApiKeySaveStatus(""), STATUS_RESET_MS);
      })
      .catch(() => {
        setApiKeySaveStatus("error");
        setTimeout(() => setApiKeySaveStatus(""), STATUS_RESET_MS);
      });
  };

  const handleSaveSttApiKey = () => {
    setSttApiKeySaveStatus("saving");
    settingsService.setSttApiKey(sttApiKeyInput)
      .then(() => {
        setSttApiKeySet(sttApiKeyInput.length > 0);
        setSttApiKeyInput("");
        setSttApiKeySaveStatus("saved");
        setTimeout(() => setSttApiKeySaveStatus(""), STATUS_RESET_MS);
      })
      .catch(() => {
        setSttApiKeySaveStatus("error");
        setTimeout(() => setSttApiKeySaveStatus(""), STATUS_RESET_MS);
      });
  };

  // 2d: shared helper for model busy operations
  const withModelBusy = async (
    modelId: string,
    action: "install" | "delete",
    fn: () => Promise<void>,
    successMsg: string,
    errorMsg: string,
  ) => {
    setLocalModelBusyId(modelId);
    setLocalModelBusyAction(action);
    setLocalModelStatus({ type: "", message: "" });
    try {
      await fn();
      await loadLocalModels();
      setLocalModelStatus({ type: "success", message: successMsg });
      return true;
    } catch (err) {
      console.error(`[Settings] ${action}_local_stt_model failed:`, err);
      setLocalModelStatus({ type: "error", message: errorMsg });
      return false;
    } finally {
      setLocalModelBusyId("");
      setLocalModelBusyAction("");
    }
  };

  const withTtsModelBusy = async (
    modelId: string,
    action: "install" | "delete" | "select",
    fn: () => Promise<void>,
    successMsg: string,
    errorMsg: string,
  ) => {
    setTtsModelBusyId(modelId);
    setTtsModelBusyAction(action);
    setTtsModelStatus({ type: "", message: "" });
    try {
      await fn();
      await loadLocalTtsModels();
      setTtsModelStatus({ type: "success", message: successMsg });
      return true;
    } catch (err) {
      console.error(`[Settings] ${action}_local_tts_model failed:`, err);
      setTtsModelStatus({ type: "error", message: errorMsg });
      return false;
    } finally {
      setTtsModelBusyId("");
      setTtsModelBusyAction("");
    }
  };

  const handleSaveSettings = async () => {
    const normalizedHotkey = normalizeHotkey(draftHotkey);
    const normalizedScreenshotHotkey = normalizeHotkey(draftScreenshotHotkey);
    const normalizedDialogHotkey = normalizeHotkey(draftDialogHotkey);
    const nextHotkey = draftHotkey.trim();
    const nextScreenshotHotkey = draftScreenshotHotkey.trim();
    const nextDialogHotkey = draftDialogHotkey.trim();
    const normalizedUndoHotkey = normalizeHotkey("Alt+Z");
    if (normalizedHotkey && normalizedHotkey === normalizedScreenshotHotkey) {
      setHotkeyStatus("error");
      setHotkeyErrorMessage(t("settings.hotkey.conflictTriggerScreenshot"));
      setSettingsSaveStatus("error");
      setTimeout(() => {
        setHotkeyStatus("");
        setSettingsSaveStatus("");
      }, STATUS_RESET_MS);
      return;
    }
    if (normalizedHotkey && normalizedHotkey === normalizedDialogHotkey) {
      setHotkeyStatus("error");
      setHotkeyErrorMessage(t("settings.hotkey.conflictTriggerDialog"));
      setSettingsSaveStatus("error");
      setTimeout(() => {
        setHotkeyStatus("");
        setSettingsSaveStatus("");
      }, STATUS_RESET_MS);
      return;
    }
    if (normalizedScreenshotHotkey && normalizedScreenshotHotkey === normalizedDialogHotkey) {
      setHotkeyStatus("error");
      setHotkeyErrorMessage(t("settings.hotkey.conflictScreenshotDialog"));
      setSettingsSaveStatus("error");
      setTimeout(() => {
        setHotkeyStatus("");
        setSettingsSaveStatus("");
      }, STATUS_RESET_MS);
      return;
    }
    if (
      normalizedHotkey === normalizedUndoHotkey ||
      normalizedScreenshotHotkey === normalizedUndoHotkey ||
      normalizedDialogHotkey === normalizedUndoHotkey
    ) {
      setHotkeyStatus("error");
      setHotkeyErrorMessage(t("settings.hotkey.conflictUndo"));
      setSettingsSaveStatus("error");
      setTimeout(() => {
        setHotkeyStatus("");
        setSettingsSaveStatus("");
      }, STATUS_RESET_MS);
      return;
    }

    const nextWakeWord = draftWakeWord.trim();
    const nextModel = draftLlmModel.trim();
    const nextLlmModelOptions = normalizeLlmModelOptions(draftLlmModelOptions, nextModel);
    const isExternalModelChoice = draftSttModelChoice === OPENAI_STT_MODEL;
    if (!isExternalModelChoice && !localModels.some((model) => model.id === draftSttModelChoice && model.installed)) {
      setSettingsSaveStatus("error");
      setLocalModelStatus({ type: "error", message: t("settings.stt.localModelRequired") });
      setTimeout(() => setSettingsSaveStatus(""), STATUS_RESET_MS);
      return;
    }
    const { engine: nextSttEngine, modelPath: nextSttModelPath } = resolveEngineAndPathByModel(draftSttModelChoice);
    const nextSttLanguage = draftSttLanguage;
    const nextTranslationTarget =
      draftSttOutputStrategy === "llmRefine"
        ? draftTranslationTarget
        : "off";
    const nextVocabularyTerms = draftVocabularyTerms
      .split(/\r?\n|,/)
      .map((term) => term.trim())
      .filter(Boolean);
    const nextQuickActionCommands = draftQuickActionCommands
      .map((command) => ({
        ...command,
        label: command.label.trim(),
        instruction: command.instruction.trim(),
      }))
      .filter((command) => command.label && command.instruction);
    if (!nextWakeWord || !nextModel || nextQuickActionCommands.length === 0) {
      setSettingsSaveStatus("error");
      setTimeout(() => setSettingsSaveStatus(""), STATUS_RESET_MS);
      return;
    }

    try {
      setHotkeyErrorMessage("");
      if (nextHotkey !== hotkey) {
        await settingsService.changeHotkey(nextHotkey);
      }
      if (nextScreenshotHotkey !== screenshotHotkey) {
        await settingsService.changeScreenshotHotkey(nextScreenshotHotkey);
      }
      if (nextDialogHotkey !== dialogHotkey) {
        await settingsService.changeDialogHotkey(nextDialogHotkey);
      }
      if (draftLaunchOnStartup !== launchOnStartup) {
        await settingsService.setLaunchOnStartup(draftLaunchOnStartup);
      }
      if (draftMicrophoneSource !== microphoneSource) {
        await settingsService.setAudioDevice(draftMicrophoneSource);
      }

      setWakeWord(nextWakeWord);
      setSttEnabled(draftSttEnabled);
      setSelectionEnabled(draftSelectionEnabled);
      setScreenshotEnabled(draftScreenshotEnabled);
      setHotkey(nextHotkey);
      setScreenshotHotkey(nextScreenshotHotkey);
      setDialogHotkey(nextDialogHotkey);
      setSttEngine(nextSttEngine);
      setSttLanguage(nextSttLanguage);
      setSttModelPath(nextSttModelPath);
      setOutputMode(draftOutputMode);
      setSttOutputStrategy(draftSttOutputStrategy);
      setPunctuationMode(draftPunctuationMode);
      setContextAwareTone(draftContextAwareTone);
      setVocabularyTerms(nextVocabularyTerms);
      setLlmProvider(draftLlmProvider);
      setLlmModel(nextModel);
      setLlmModelOptions(nextLlmModelOptions);
      setTtsVoice(draftTtsVoice);
      setTtsRate(draftTtsRate);
      setTtsPitch(draftTtsPitch);
      setModeAPrompt(draftModeAPrompt.trim());
      setModeBPrompt(draftModeBPrompt.trim());
      setModeCPrompt(draftModeCPrompt.trim());
      setModeAStreamOutput(draftModeAStreamOutput);
      setModeBStreamOutput(draftModeBStreamOutput);
      setPreferredLanguage(draftPreferredLanguage);
      setMicrophoneSource(draftMicrophoneSource);
      setLaunchOnStartup(draftLaunchOnStartup);
      setQuickActionCommands(nextQuickActionCommands);
      setLanguage(draftLanguage);
      setHistoryEnabled(draftHistoryEnabled);
      setAppProfiles(draftAppProfiles);
      setTranslationTarget(nextTranslationTarget);
      await settingsService.setRuntimeSttConfig({
        engine: nextSttEngine,
        modelPath: nextSttModelPath,
        sttLanguage: nextSttLanguage,
      });
      await emit("neuropen://settings-saved", {
        wakeWord: nextWakeWord,
        sttEnabled: draftSttEnabled,
        selectionEnabled: draftSelectionEnabled,
        screenshotEnabled: draftScreenshotEnabled,
        hotkey: nextHotkey,
        screenshotHotkey: nextScreenshotHotkey,
        dialogHotkey: nextDialogHotkey,
        sttEngine: nextSttEngine,
        sttLanguage: nextSttLanguage,
        sttModelPath: nextSttModelPath,
        outputMode: draftOutputMode,
        sttOutputStrategy: draftSttOutputStrategy,
        punctuationMode: draftPunctuationMode,
        contextAwareTone: draftContextAwareTone,
        vocabularyTerms: nextVocabularyTerms,
        llmProvider: draftLlmProvider,
        llmModel: nextModel,
        llmModelOptions: nextLlmModelOptions,
        preferredLanguage: draftPreferredLanguage,
        modeAPrompt: draftModeAPrompt.trim(),
        modeBPrompt: draftModeBPrompt.trim(),
        modeCPrompt: draftModeCPrompt.trim(),
        modeAStreamOutput: draftModeAStreamOutput,
        modeBStreamOutput: draftModeBStreamOutput,
        microphoneSource: draftMicrophoneSource,
        launchOnStartup: draftLaunchOnStartup,
        language: draftLanguage,
        ttsVoice: draftTtsVoice,
        ttsRate: draftTtsRate,
        ttsPitch: draftTtsPitch,
        quickActionCommands: nextQuickActionCommands,
        historyEnabled: draftHistoryEnabled,
        appProfiles: draftAppProfiles,
        translationTarget: nextTranslationTarget,
      });

      setHotkeyStatus("");
      setHotkeyErrorMessage("");
      setSettingsSaveStatus("saved");
      setTimeout(() => setSettingsSaveStatus(""), STATUS_RESET_MS);
    } catch (err) {
      console.error("[Settings] save settings failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      setHotkeyStatus("error");
      setHotkeyErrorMessage(message);
      setSettingsSaveStatus("error");
      setTimeout(() => setSettingsSaveStatus(""), STATUS_RESET_MS);
    }
  };

  const handleCancelSettings = () => {
    const matchedLocalModel = localModels.find((model) => model.modelPath === sttModelPath)
      ?? localModels.find((model) => model.active);
    const nextSttModelChoice =
      sttEngine === "openAi"
        ? OPENAI_STT_MODEL
        : matchedLocalModel?.id ?? OPENAI_STT_MODEL;
    setDraftWakeWord(wakeWord);
    setDraftSttEnabled(sttEnabled);
    setDraftSelectionEnabled(selectionEnabled);
    setDraftScreenshotEnabled(screenshotEnabled);
    setDraftHotkey(hotkey);
    setDraftScreenshotHotkey(screenshotHotkey);
    setDraftDialogHotkey(dialogHotkey);
    setDraftSttEngine(sttEngine);
    setDraftSttLanguage(sttLanguage);
    setDraftSttModelChoice(nextSttModelChoice);
    setDraftOutputMode(outputMode);
    setDraftSttOutputStrategy(sttOutputStrategy);
    setDraftPunctuationMode(punctuationMode);
    setDraftContextAwareTone(contextAwareTone);
    setDraftVocabularyTerms(vocabularyTerms.join("\n"));
    setDraftLlmProvider(llmProvider);
    setDraftLlmModel(llmModel);
    setDraftLlmModelOptions(normalizeLlmModelOptions(llmModelOptions, llmModel));
    setDraftTtsVoice(ttsVoice);
    setDraftTtsRate(ttsRate);
    setDraftTtsPitch(ttsPitch);
    setDraftModeAPrompt(modeAPrompt);
    setDraftModeBPrompt(modeBPrompt);
    setDraftModeCPrompt(modeCPrompt);
    setDraftModeAStreamOutput(modeAStreamOutput);
    setDraftModeBStreamOutput(modeBStreamOutput);
    setDraftPreferredLanguage(preferredLanguage);
    setDraftMicrophoneSource(microphoneSource);
    setDraftLaunchOnStartup(launchOnStartup);
    setDraftQuickActionCommands(quickActionCommands);
    setDraftLanguage(language);
    setDraftHistoryEnabled(historyEnabled);
    setDraftAppProfiles(appProfiles);
    setDraftTranslationTarget(translationTarget);
    setHotkeyStatus("");
    setHotkeyErrorMessage("");
    setSettingsSaveStatus("");
  };

  const handleAddQuickActionCommand = () => {
    setDraftQuickActionCommands((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        label: t("settings.quickAction.newCommand"),
        instruction: "",
      },
    ]);
  };

  const handleUpdateQuickActionCommand = (
    commandId: string,
    field: "label" | "instruction",
    value: string
  ) => {
    setDraftQuickActionCommands((prev) =>
      prev.map((command) =>
        command.id === commandId
          ? { ...command, [field]: value }
          : command
      )
    );
  };

  const handleDeleteQuickActionCommand = (commandId: string) => {
    setDraftQuickActionCommands((prev) =>
      prev.filter((command) => command.id !== commandId)
    );
  };

  const handleMoveQuickActionCommand = (commandId: string, direction: "up" | "down") => {
    setDraftQuickActionCommands((prev) => {
      const fromIndex = prev.findIndex((command) => command.id === commandId);
      if (fromIndex < 0) {
        return prev;
      }
      const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleAddLlmModelOption = () => {
    const candidate = draftLlmModel.trim();
    if (!candidate) return;
    setDraftLlmModelOptions((prev) => normalizeLlmModelOptions(prev, candidate));
    setDraftLlmModel(candidate);
  };

  const handleDeleteLlmModelOption = (modelToDelete: string) => {
    setDraftLlmModelOptions((prev) => {
      const next = prev.filter((model) => model !== modelToDelete);
      if (!next.length) {
        return prev;
      }
      if (draftLlmModel === modelToDelete) {
        setDraftLlmModel(next[0]);
      }
      return next;
    });
  };

  const handleImportVocabularyFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = text
        .split(/\r?\n|,/)
        .map((term) => term.trim())
        .filter(Boolean);
      const merged = Array.from(
        new Set(
          [...draftVocabularyTerms.split(/\r?\n|,/).map((term) => term.trim()).filter(Boolean), ...imported]
        )
      );
      setDraftVocabularyTerms(merged.join("\n"));
      setLocalModelStatus({ type: "success", message: t("settings.stt.vocabularyImported") });
    } catch (err) {
      console.error("[Settings] import vocabulary failed:", err);
      setLocalModelStatus({ type: "error", message: t("settings.stt.vocabularyImportFailed") });
    }
  };

  const handleInstallLocalModel = async (modelId: string) => {
    setFailedDownloadModelId("");
    setLocalModelDownloadProgress((prev) => ({
      ...prev,
      [modelId]: {
        modelId,
        status: "start",
        downloadedBytes: 0,
        totalBytes: prev[modelId]?.totalBytes ?? 0,
        progressPct: 0,
      },
    }));
    const success = await withModelBusy(
      modelId,
      "install",
      () => settingsService.installLocalSttModel(modelId),
      t("settings.status.modelInstalled"),
      t("settings.status.modelInstallFailed"),
    );
    if (!success) {
      setFailedDownloadModelId(modelId);
    }
  };

  const handleCancelLocalModelDownload = async () => {
    await settingsService.cancelLocalSttDownload();
  };

  const handleInstallLocalTtsModel = async (modelId: string) => {
    setFailedTtsDownloadModelId("");
    setTtsModelDownloadProgress((prev) => ({
      ...prev,
      [modelId]: {
        modelId,
        status: "start",
        downloadedBytes: 0,
        totalBytes: prev[modelId]?.totalBytes ?? 0,
        progressPct: 0,
      },
    }));
    const success = await withTtsModelBusy(
      modelId,
      "install",
      () => settingsService.installLocalTtsModel(modelId),
      t("settings.status.ttsModelInstalled"),
      t("settings.status.ttsModelInstallFailed"),
    );
    if (!success) {
      setFailedTtsDownloadModelId(modelId);
    }
  };

  const handleCancelLocalTtsModelDownload = async () => {
    await settingsService.cancelLocalTtsDownload();
  };

  const handleSelectLocalTtsModel = (modelId: string) =>
    withTtsModelBusy(
      modelId,
      "select",
      async () => {
        const modelPath = await settingsService.selectLocalTtsModel(modelId);
        setDraftTtsVoice(modelPath);
        setTtsVoice(modelPath);
        await emit("neuropen://settings-saved", {
          ttsVoice: modelPath,
          ttsRate: draftTtsRate,
          ttsPitch: draftTtsPitch,
        });
      },
      t("settings.status.ttsModelSelected"),
      t("settings.status.ttsModelSelectFailed"),
    );

  const handleDeleteLocalTtsModel = (modelId: string) =>
    withTtsModelBusy(
      modelId,
      "delete",
      async () => {
        const deleting = localTtsModels.find((model) => model.id === modelId);
        await settingsService.deleteLocalTtsModel(modelId);
        if (deleting && deleting.modelPath === draftTtsVoice) {
          setDraftTtsVoice("");
        }
        if (deleting && deleting.modelPath === ttsVoice) {
          setTtsVoice("");
          await emit("neuropen://settings-saved", {
            ttsVoice: "",
            ttsRate: draftTtsRate,
            ttsPitch: draftTtsPitch,
          });
        }
      },
      t("settings.status.ttsModelDeleted"),
      t("settings.status.ttsModelDeleteFailed"),
    );

  const handleDeleteLocalModel = (modelId: string) =>
    withModelBusy(
      modelId,
      "delete",
      async () => {
        const deleting = localModels.find((model) => model.id === modelId);
        await settingsService.deleteLocalSttModel(modelId);
        if (deleting && (deleting.modelPath === sttModelPath || draftSttModelChoice === modelId)) {
          setDraftSttModelChoice(OPENAI_STT_MODEL);
          setDraftSttEngine("openAi");
          setSttModelPath("");
          await settingsService.setRuntimeSttConfig({
            engine: "openAi",
            modelPath: "",
            sttLanguage: draftSttLanguage,
          });
          await emit("neuropen://settings-saved", {
            wakeWord: draftWakeWord.trim() || wakeWord,
            sttEnabled: draftSttEnabled,
            selectionEnabled: draftSelectionEnabled,
            screenshotEnabled: draftScreenshotEnabled,
            hotkey: draftHotkey,
            screenshotHotkey: draftScreenshotHotkey,
            dialogHotkey: draftDialogHotkey,
            sttEngine: "openAi",
            sttLanguage: draftSttLanguage,
            sttModelPath: "",
            outputMode: draftOutputMode,
            sttOutputStrategy: draftSttOutputStrategy,
            punctuationMode: draftPunctuationMode,
            contextAwareTone: draftContextAwareTone,
            vocabularyTerms: draftVocabularyTerms
              .split(/\r?\n|,/)
              .map((term) => term.trim())
              .filter(Boolean),
            llmProvider: draftLlmProvider,
            llmModel: draftLlmModel.trim() || llmModel,
            llmModelOptions: draftLlmModelOptions,
            preferredLanguage: draftPreferredLanguage,
            microphoneSource: draftMicrophoneSource,
            launchOnStartup: draftLaunchOnStartup,
            language: draftLanguage,
            ttsVoice: draftTtsVoice,
            ttsRate: draftTtsRate,
            ttsPitch: draftTtsPitch,
            historyEnabled: draftHistoryEnabled,
            appProfiles: draftAppProfiles,
            translationTarget: draftSttOutputStrategy === "llmRefine" ? draftTranslationTarget : "off",
          });
        }
      },
      t("settings.status.modelDeleted"),
      t("settings.status.modelDeleteFailed"),
    );

  const currentSttModelChoice = useMemo(() => {
    const matchedLocalModel = localModels.find((model) => model.modelPath === sttModelPath)
      ?? localModels.find((model) => model.active);
    return sttEngine === "openAi"
      ? OPENAI_STT_MODEL
      : matchedLocalModel?.id ?? OPENAI_STT_MODEL;
  }, [localModels, sttEngine, sttModelPath]);

  // 2e: useMemo for hasSettingsChanges
  const hasSettingsChanges = useMemo(
    () =>
      draftWakeWord !== wakeWord ||
      draftSttEnabled !== sttEnabled ||
      draftSelectionEnabled !== selectionEnabled ||
      draftScreenshotEnabled !== screenshotEnabled ||
      draftHotkey !== hotkey ||
      draftScreenshotHotkey !== screenshotHotkey ||
      draftDialogHotkey !== dialogHotkey ||
      draftSttEngine !== sttEngine ||
      draftSttLanguage !== sttLanguage ||
      draftSttModelChoice !== currentSttModelChoice ||
      draftOutputMode !== outputMode ||
      draftSttOutputStrategy !== sttOutputStrategy ||
      draftPunctuationMode !== punctuationMode ||
      draftContextAwareTone !== contextAwareTone ||
      draftVocabularyTerms !== vocabularyTerms.join("\n") ||
      draftLlmProvider !== llmProvider ||
      draftLlmModel !== llmModel ||
      JSON.stringify(draftLlmModelOptions) !== JSON.stringify(llmModelOptions) ||
      draftTtsVoice !== ttsVoice ||
      draftTtsRate !== ttsRate ||
      draftTtsPitch !== ttsPitch ||
      draftModeAPrompt !== modeAPrompt ||
      draftModeBPrompt !== modeBPrompt ||
      draftModeCPrompt !== modeCPrompt ||
      draftModeAStreamOutput !== modeAStreamOutput ||
      draftModeBStreamOutput !== modeBStreamOutput ||
      draftPreferredLanguage !== preferredLanguage ||
      draftMicrophoneSource !== microphoneSource ||
      draftLaunchOnStartup !== launchOnStartup ||
      draftLanguage !== language ||
      draftHistoryEnabled !== historyEnabled ||
      draftTranslationTarget !== translationTarget ||
      JSON.stringify(draftQuickActionCommands) !== JSON.stringify(quickActionCommands) ||
      JSON.stringify(draftAppProfiles) !== JSON.stringify(appProfiles),
    [
      draftWakeWord,
      wakeWord,
      draftSttEnabled,
      sttEnabled,
      draftSelectionEnabled,
      selectionEnabled,
      draftScreenshotEnabled,
      screenshotEnabled,
      draftHotkey,
      hotkey,
      draftScreenshotHotkey,
      screenshotHotkey,
      draftDialogHotkey,
      dialogHotkey,
      draftSttEngine,
      sttEngine,
      draftSttLanguage,
      sttLanguage,
      draftSttModelChoice,
      currentSttModelChoice,
      draftOutputMode,
      outputMode,
      draftSttOutputStrategy,
      sttOutputStrategy,
      draftPunctuationMode,
      punctuationMode,
      draftContextAwareTone,
      contextAwareTone,
      draftVocabularyTerms,
      vocabularyTerms,
      draftLlmProvider,
      llmProvider,
      draftLlmModel,
      llmModel,
      draftLlmModelOptions,
      llmModelOptions,
      draftTtsVoice,
      ttsVoice,
      draftTtsRate,
      ttsRate,
      draftTtsPitch,
      ttsPitch,
      draftModeAPrompt,
      modeAPrompt,
      draftModeBPrompt,
      modeBPrompt,
      draftModeCPrompt,
      modeCPrompt,
      draftModeAStreamOutput,
      modeAStreamOutput,
      draftModeBStreamOutput,
      modeBStreamOutput,
      draftPreferredLanguage,
      preferredLanguage,
      draftMicrophoneSource,
      microphoneSource,
      draftLaunchOnStartup,
      launchOnStartup,
      draftLanguage,
      language,
      draftHistoryEnabled,
      historyEnabled,
      draftTranslationTarget,
      translationTarget,
      draftQuickActionCommands,
      quickActionCommands,
      draftAppProfiles,
      appProfiles,
    ],
  );

  return (
    <div className="h-screen bg-[#f5f5f7] p-6 text-sm text-zinc-800 flex flex-col overflow-hidden">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{t("settings.title")}</h1>
        <p className="text-xs text-slate-500 mt-1">{t("settings.subtitle")}</p>
      </div>

      <div className="mt-4 grid flex-1 min-h-0 gap-4 grid-cols-[230px_minmax(0,1fr)]">
        <SettingsSidebar
          activeSection={activeSection}
          navItems={NAV_ITEMS}
          onSelectSection={setActiveSection}
          sectionLabelKey={sectionLabelKey}
          t={t}
        />

        <div className="glass-panel-md p-4 min-h-0 flex flex-col">
          <div className="space-y-5 min-h-0 overflow-y-auto pr-1">
            {activeSection === "general" && (
              <SettingsGeneralSection
                draftLanguage={draftLanguage}
                draftLaunchOnStartup={draftLaunchOnStartup}
                draftSttEnabled={draftSttEnabled}
                draftSelectionEnabled={draftSelectionEnabled}
                draftScreenshotEnabled={draftScreenshotEnabled}
                onLanguageChange={setDraftLanguage}
                onLaunchOnStartupChange={setDraftLaunchOnStartup}
                onSttEnabledChange={setDraftSttEnabled}
                onSelectionEnabledChange={setDraftSelectionEnabled}
                onScreenshotEnabledChange={setDraftScreenshotEnabled}
                t={t}
              />
            )}

            {activeSection === "shortcuts" && (
              <SettingsShortcutsSection
                draftHotkey={draftHotkey}
                draftScreenshotHotkey={draftScreenshotHotkey}
                draftDialogHotkey={draftDialogHotkey}
                hotkeyStatus={hotkeyStatus}
                hotkeyErrorMessage={hotkeyErrorMessage}
                onHotkeyChange={setDraftHotkey}
                onScreenshotHotkeyChange={setDraftScreenshotHotkey}
                onDialogHotkeyChange={setDraftDialogHotkey}
                onClearHotkeyError={() => {
                  setHotkeyStatus("");
                  setHotkeyErrorMessage("");
                }}
                t={t}
              />
            )}

            {activeSection === "stt" && (
              <SettingsSttSection
                draftWakeWord={draftWakeWord}
                draftSttEnabled={draftSttEnabled}
                draftSttModelChoice={draftSttModelChoice}
                draftSttLanguage={draftSttLanguage}
                draftMicrophoneSource={draftMicrophoneSource}
                draftTranslationTarget={draftTranslationTarget}
                draftSttOutputStrategy={draftSttOutputStrategy}
                draftPunctuationMode={draftPunctuationMode}
                draftVocabularyTerms={draftVocabularyTerms}
                audioDevices={audioDevices}
                audioDevicesLoading={audioDevicesLoading}
                localSttAvailable={localSttAvailable}
                localModels={localModels}
                localModelsLoading={localModelsLoading}
                localModelBusyId={localModelBusyId}
                localModelBusyAction={localModelBusyAction}
                localModelDownloadProgress={localModelDownloadProgress}
                failedDownloadModelId={failedDownloadModelId}
                localModelStatus={localModelStatus}
                sttApiKeyInput={sttApiKeyInput}
                sttApiKeySet={sttApiKeySet}
                sttApiKeySaveStatus={sttApiKeySaveStatus}
                formatBytes={formatBytes}
                getLocalizedModelName={getLocalizedModelName}
                getLocalizedModelDescription={getLocalizedModelDescription}
                onWakeWordChange={setDraftWakeWord}
                onSttModelChoiceChange={(nextChoice) => {
                  setDraftSttModelChoice(nextChoice);
                  const { engine } = resolveEngineAndPathByModel(nextChoice);
                  setDraftSttEngine(engine);
                }}
                onSttLanguageChange={setDraftSttLanguage}
                onMicrophoneSourceChange={setDraftMicrophoneSource}
                onSttApiKeyInputChange={setSttApiKeyInput}
                onSaveSttApiKey={handleSaveSttApiKey}
                onSttOutputStrategyChange={setDraftSttOutputStrategy}
                onTranslationTargetChange={setDraftTranslationTarget}
                onPunctuationModeChange={setDraftPunctuationMode}
                onVocabularyTermsChange={setDraftVocabularyTerms}
                onImportVocabularyFile={handleImportVocabularyFile}
                onInstallLocalModel={handleInstallLocalModel}
                onCancelLocalModelDownload={handleCancelLocalModelDownload}
                onDeleteLocalModel={handleDeleteLocalModel}
                t={t}
              />
            )}

            {activeSection === "llm" && (
              <SettingsLlmSection
                draftOutputMode={draftOutputMode}
                draftModeAStreamOutput={draftModeAStreamOutput}
                draftModeBStreamOutput={draftModeBStreamOutput}
                draftLlmProvider={draftLlmProvider}
                draftLlmModel={draftLlmModel}
                draftLlmModelOptions={draftLlmModelOptions}
                draftPreferredLanguage={draftPreferredLanguage}
                draftModeAPrompt={draftModeAPrompt}
                draftModeBPrompt={draftModeBPrompt}
                draftModeCPrompt={draftModeCPrompt}
                apiKeySet={apiKeySet}
                apiKeyInput={apiKeyInput}
                apiKeySaveStatus={apiKeySaveStatus}
                onOutputModeChange={setDraftOutputMode}
                onModeAStreamOutputChange={setDraftModeAStreamOutput}
                onModeBStreamOutputChange={setDraftModeBStreamOutput}
                onLlmProviderChange={setDraftLlmProvider}
                onLlmModelChange={setDraftLlmModel}
                onAddLlmModelOption={handleAddLlmModelOption}
                onDeleteLlmModelOption={handleDeleteLlmModelOption}
                onPreferredLanguageChange={setDraftPreferredLanguage}
                onModeAPromptChange={setDraftModeAPrompt}
                onModeBPromptChange={setDraftModeBPrompt}
                onModeCPromptChange={setDraftModeCPrompt}
                onApiKeyInputChange={setApiKeyInput}
                onSaveApiKey={handleSaveApiKey}
                t={t}
              />
            )}

            {activeSection === "quickAction" && (
              <SettingsQuickActionSection
                commands={draftQuickActionCommands}
                onAdd={handleAddQuickActionCommand}
                onDelete={handleDeleteQuickActionCommand}
                onMove={handleMoveQuickActionCommand}
                onUpdate={handleUpdateQuickActionCommand}
                t={t}
              />
            )}

            {activeSection === "tts" && (
              <SettingsTtsSection
                draftTtsPitch={draftTtsPitch}
                draftTtsRate={draftTtsRate}
                draftTtsVoice={draftTtsVoice}
                failedTtsDownloadModelId={failedTtsDownloadModelId}
                formatBytes={formatBytes}
                localTtsModels={localTtsModels}
                localTtsModelsLoading={localTtsModelsLoading}
                onCancelDownload={handleCancelLocalTtsModelDownload}
                onDeleteModel={handleDeleteLocalTtsModel}
                onInstallModel={handleInstallLocalTtsModel}
                onPitchChange={setDraftTtsPitch}
                onRateChange={setDraftTtsRate}
                onSelectModel={handleSelectLocalTtsModel}
                onVoiceChange={setDraftTtsVoice}
                t={t}
                ttsModelBusyAction={ttsModelBusyAction}
                ttsModelBusyId={ttsModelBusyId}
                ttsModelDownloadProgress={ttsModelDownloadProgress}
                ttsModelStatus={ttsModelStatus}
              />
            )}

            {activeSection === "appProfile" && (
              <SettingsAppProfileSection
                profiles={draftAppProfiles}
                onChange={setDraftAppProfiles}
                contextAwareTone={draftContextAwareTone}
                onContextAwareToneChange={setDraftContextAwareTone}
                t={t}
              />
            )}

            {activeSection === "history" && (
              <SettingsHistorySection
                draftHistoryEnabled={draftHistoryEnabled}
                onToggle={() => setDraftHistoryEnabled(!draftHistoryEnabled)}
                t={t}
              />
            )}
          </div>
        </div>
      </div>

      <SettingsFooter
        hasSettingsChanges={hasSettingsChanges}
        onCancel={handleCancelSettings}
        onSave={handleSaveSettings}
        settingsSaveStatus={settingsSaveStatus}
        t={t}
      />
    </div>
  );
}
