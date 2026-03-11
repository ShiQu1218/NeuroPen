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
import SettingsSidebar from "./settings/SettingsSidebar";
import SettingsTtsSection from "./settings/SettingsTtsSection";
import {
  NAV_ITEMS,
  OPENAI_STT_MODEL,
  RATING_INDICES,
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
    stt: "settings.section.stt",
    quickAction: "settings.section.quickAction",
    llm: "settings.section.llm",
    tts: "settings.section.tts",
    history: "settings.section.history",
    appProfile: "settings.section.appProfile",
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

      <div className="mt-4 grid grid-cols-[210px_minmax(0,1fr)] gap-4 flex-1 min-h-0">
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
              draftHotkey={draftHotkey}
              draftScreenshotHotkey={draftScreenshotHotkey}
              draftDialogHotkey={draftDialogHotkey}
              draftWakeWord={draftWakeWord}
              hotkeyStatus={hotkeyStatus}
              hotkeyErrorMessage={hotkeyErrorMessage}
              onLanguageChange={setDraftLanguage}
              onLaunchOnStartupChange={setDraftLaunchOnStartup}
              onSttEnabledChange={setDraftSttEnabled}
              onSelectionEnabledChange={setDraftSelectionEnabled}
              onScreenshotEnabledChange={setDraftScreenshotEnabled}
              onHotkeyChange={setDraftHotkey}
              onScreenshotHotkeyChange={setDraftScreenshotHotkey}
              onDialogHotkeyChange={setDraftDialogHotkey}
              onWakeWordChange={setDraftWakeWord}
              onClearHotkeyError={() => {
                setHotkeyStatus("");
                setHotkeyErrorMessage("");
              }}
              t={t}
            />
          )}

          {activeSection === "stt" && (
            <>
              {!draftSttEnabled && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {t("settings.stt.disabledHint")}
                </div>
              )}
              {/* STT model selector */}
              <div className="space-y-1">
                <label className="font-medium">{t("settings.stt.modelLabel")}</label>
                <select
                  className="w-full input-field px-2 py-1"
                  value={draftSttModelChoice}
                  onChange={(e) => {
                    const nextChoice = e.target.value;
                    setDraftSttModelChoice(nextChoice);
                    const { engine } = resolveEngineAndPathByModel(nextChoice);
                    setDraftSttEngine(engine);
                  }}
                >
                  <option value={OPENAI_STT_MODEL}>OpenAI Whisper API{t("settings.stt.modelCloud")}</option>
                  {localModels
                    .filter((model) => model.installed)
                    .map((model) => (
                      <option key={model.id} value={model.id}>
                        {getLocalizedModelName(model)}{t("settings.stt.modelLocal")}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-gray-500">{t("settings.stt.modelHint")}</p>
              </div>

              <div className="space-y-1">
                <label className="font-medium">{t("settings.stt.language.label")}</label>
                <select
                  className="w-full input-field px-2 py-1"
                  value={draftSttLanguage}
                  onChange={(e) => setDraftSttLanguage(e.target.value as SttLanguage)}
                >
                  <option value="auto">{t("settings.stt.language.auto")}</option>
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                  <option value="de">Deutsch</option>
                  <option value="fr">Français</option>
                  <option value="es">Español</option>
                  <option value="ru">Русский</option>
                  <option value="ar">العربية</option>
                </select>
                <p className="text-xs text-gray-500">{t("settings.stt.language.hint")}</p>
              </div>

              <div className="space-y-1">
                <label className="font-medium">{t("settings.stt.microphoneSource")}</label>
                <select
                  className="w-full input-field px-2 py-1"
                  value={draftMicrophoneSource}
                  onChange={(e) => setDraftMicrophoneSource(e.target.value)}
                  disabled={audioDevicesLoading}
                >
                  <option value="">{t("settings.stt.defaultMicrophone")}</option>
                  {audioDevices.map((device) => (
                    <option key={device} value={device}>
                      {device}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">{t("settings.stt.microphoneHint")}</p>
              </div>

              {draftSttModelChoice === OPENAI_STT_MODEL && (
                <div className="space-y-1">
                  <label className="font-medium">{t("settings.stt.sttApiKeyLabel")}</label>
                  {sttApiKeySet && (
                    <p className="text-xs text-green-600">{t("settings.stt.sttApiKeySet")}</p>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="password"
                      className="flex-1 input-field px-2 py-1 font-mono text-xs"
                      value={sttApiKeyInput}
                      onChange={(e) => setSttApiKeyInput(e.target.value)}
                      placeholder={sttApiKeySet ? "••••••••" : t("settings.stt.sttApiKeyPlaceholder")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && sttApiKeyInput) handleSaveSttApiKey();
                      }}
                    />
                    <button
                      onClick={handleSaveSttApiKey}
                      disabled={!sttApiKeyInput || sttApiKeySaveStatus === "saving"}
                      className="px-3 py-1 rounded text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {sttApiKeySaveStatus === "saving" ? t("settings.llm.saving") : t("settings.llm.save")}
                    </button>
                  </div>
                  {sttApiKeySaveStatus === "saved" && (
                    <p className="text-xs text-green-600">{t("settings.stt.sttApiKeySaved")}</p>
                  )}
                  {sttApiKeySaveStatus === "error" && (
                    <p className="text-xs text-red-600">{t("settings.stt.sttApiKeySaveFailed")}</p>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <label className="font-medium">{t("settings.stt.outputStrategy")}</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="sttOutputStrategy"
                      value="raw"
                      checked={draftSttOutputStrategy === "raw"}
                      onChange={() => {
                        setDraftSttOutputStrategy("raw");
                        setDraftTranslationTarget("off");
                      }}
                    />
                    {t("settings.stt.outputRaw")}
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="sttOutputStrategy"
                      value="llmRefine"
                      checked={draftSttOutputStrategy === "llmRefine"}
                      onChange={() => setDraftSttOutputStrategy("llmRefine")}
                    />
                    {t("settings.stt.outputLlmRefine")}
                  </label>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-medium">{t("settings.translation.label")}</label>
                <select
                  className="w-full input-field px-2 py-1"
                  value={draftTranslationTarget}
                  onChange={(e) => setDraftTranslationTarget(e.target.value as TranslationTarget)}
                  disabled={draftSttOutputStrategy !== "llmRefine"}
                >
                  <option value="off">{t("settings.translation.off")}</option>
                  <option value="en-US">English</option>
                  <option value="zh-TW">{t("settings.language.zh-TW")}</option>
                  <option value="zh-CN">{t("settings.language.zh-CN")}</option>
                  <option value="ja-JP">{t("settings.language.ja-JP")}</option>
                  <option value="ko-KR">{t("settings.language.ko-KR")}</option>
                  <option value="es-ES">{t("settings.language.es-ES")}</option>
                  <option value="de-DE">{t("settings.language.de-DE")}</option>
                  <option value="fr-FR">{t("settings.language.fr-FR")}</option>
                  <option value="ru-RU">{t("settings.language.ru-RU")}</option>
                  <option value="ar-SA">{t("settings.language.ar-SA")}</option>
                </select>
                <p className="text-xs text-gray-500">{t("settings.translation.hint")}</p>
                {draftSttOutputStrategy !== "llmRefine" && (
                  <p className="text-xs text-amber-700">{t("settings.stt.translationRequiresRefine")}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-medium">{t("settings.stt.punctuation")}</label>
                <select
                  className="w-full input-field px-2 py-1"
                  value={draftPunctuationMode}
                  onChange={(e) => setDraftPunctuationMode(e.target.value as PunctuationMode)}
                >
                  <option value="off">{t("settings.stt.punctuationOff")}</option>
                  <option value="balanced">{t("settings.stt.punctuationBalanced")}</option>
                  <option value="aggressive">{t("settings.stt.punctuationAggressive")}</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-medium">{t("settings.stt.vocabulary")}</label>
                <textarea
                  className="w-full min-h-[96px] input-field px-2 py-1 text-xs font-mono"
                  value={draftVocabularyTerms}
                  onChange={(e) => setDraftVocabularyTerms(e.target.value)}
                  placeholder={t("settings.stt.vocabularyPlaceholder")}
                />
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept=".txt,.csv"
                    onChange={(e) => void handleImportVocabularyFile(e.target.files?.[0] ?? null)}
                    className="text-xs"
                  />
                  <span className="text-xs text-gray-500">{t("settings.stt.vocabularyFileHint")}</span>
                </div>
              </div>

              {/* Local STT model manager */}
              <div className="space-y-1">
                <label className="font-medium">{t("settings.stt.modelDownloadTitle")}</label>
                <p className="text-xs text-gray-400">{t("settings.stt.modelDownloadHint")}</p>
                {!localSttAvailable && (
                  <p className="text-xs text-amber-700">{t("settings.stt.localNotEnabledHint")}</p>
                )}
                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {localModelsLoading && (
                    <div className="text-xs text-gray-500">{t("settings.stt.loadingModels")}</div>
                  )}
                  {!localModelsLoading && localModels.map((model) => {
                    const isBusy = localModelBusyId === model.id;
                    const downloadProgress = localModelDownloadProgress[model.id];
                    const isInstalling = isBusy && localModelBusyAction === "install";
                    const isDownloadActive =
                      downloadProgress?.status === "start" || downloadProgress?.status === "downloading";
                    const progressPct = Math.max(0, Math.min(100, Math.round(downloadProgress?.progressPct ?? 0)));
                    const downloadedBytes = downloadProgress?.downloadedBytes ?? 0;
                    const totalBytes = downloadProgress?.totalBytes ?? 0;
                    return (
                      <div key={model.id} className="rounded border border-gray-200 bg-gray-50 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-medium text-sm">{getLocalizedModelName(model)}</p>
                            <p className="text-xs text-gray-500">{getLocalizedModelDescription(model)}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            {model.active && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{t("settings.stt.inUse")}</span>
                            )}
                            {model.installed && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">{t("settings.stt.installed")}</span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-[11px] text-gray-600">
                            <span className="w-10">{t("settings.stt.speed")}</span>
                            <div className="flex gap-1">
                              {RATING_INDICES.map((idx) => (
                                <span
                                  key={`speed-${model.id}-${idx}`}
                                  className={`h-1.5 w-4 rounded ${idx < model.speed ? "bg-emerald-500" : "bg-gray-200"}`}
                                />
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-gray-600">
                            <span className="w-10">{t("settings.stt.accuracy")}</span>
                            <div className="flex gap-1">
                              {RATING_INDICES.map((idx) => (
                                <span
                                  key={`accuracy-${model.id}-${idx}`}
                                  className={`h-1.5 w-4 rounded ${idx < model.accuracy ? "bg-blue-500" : "bg-gray-200"}`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {!model.installed ? (
                            <>
                              <button
                                onClick={() => void handleInstallLocalModel(model.id)}
                                disabled={!!localModelBusyId}
                                className="px-2.5 py-1 rounded text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              >
                                {isDownloadActive || isInstalling
                                  ? `${t("settings.stt.installing")} ${progressPct}%`
                                  : failedDownloadModelId === model.id
                                    ? t("settings.stt.retry")
                                    : t("settings.stt.install")}
                              </button>
                              {(isDownloadActive || isInstalling) && (
                                <button
                                  onClick={() => void handleCancelLocalModelDownload()}
                                  className="px-2.5 py-1 rounded text-xs font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 transition-colors"
                                >
                                  {t("settings.cancel")}
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              onClick={() => handleDeleteLocalModel(model.id)}
                              disabled={!!localModelBusyId}
                              className="btn-danger px-2.5 py-1 rounded text-xs"
                            >
                              {isBusy && localModelBusyAction === "delete" ? t("settings.stt.deleting") : t("settings.stt.delete")}
                            </button>
                          )}
                        </div>
                        {downloadProgress && (
                          <div className="space-y-1">
                            <div className="h-1.5 w-full rounded bg-gray-200 overflow-hidden">
                              <div
                                className={`h-full transition-all ${
                                  downloadProgress.status === "error"
                                    ? "bg-red-500"
                                    : downloadProgress.status === "cancelled"
                                      ? "bg-amber-500"
                                      : "bg-blue-500"
                                }`}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                            <p className="text-[11px] text-gray-600">
                              {progressPct}% ({formatBytes(downloadedBytes)} / {formatBytes(totalBytes)})
                            </p>
                            <p className="text-[11px] text-gray-500">
                              {downloadProgress.status === "downloading" || downloadProgress.status === "start"
                                ? t("settings.stt.installing")
                                : downloadProgress.status === "done"
                                  ? t("settings.status.modelInstalled")
                                  : downloadProgress.status === "cancelled"
                                    ? t("settings.status.modelInstallCancelled")
                                    : t("settings.status.modelInstallFailed")}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {localModelStatus.type === "success" && (
                  <p className="text-xs text-green-600">{localModelStatus.message}</p>
                )}
                {localModelStatus.type === "error" && (
                  <p className="text-xs text-red-600">{localModelStatus.message}</p>
                )}
              </div>
            </>
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

          {activeSection === "history" && (
            <SettingsHistorySection
              draftHistoryEnabled={draftHistoryEnabled}
              onToggle={() => setDraftHistoryEnabled(!draftHistoryEnabled)}
              t={t}
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
