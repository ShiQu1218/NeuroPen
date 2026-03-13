import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { translate, type TranslationKey } from "../i18n";
import { settingsService } from "../services/settingsService";
import {
  normalizeLlmModelOptions,
  useAppStore,
  type AppProfile,
  type CustomLanguageVariant,
  type PreferredLanguage,
  type QuickActionCommand,
  type TranslationTarget,
} from "../store/useAppStore";
import SettingsHistorySection from "./settings/SettingsHistorySection";
import SettingsQuickActionSection from "./settings/SettingsQuickActionSection";
import SettingsShortcutsSection from "./settings/SettingsShortcutsSection";
import SettingsSidebar from "./settings/SettingsSidebar";
import SettingsSttSection from "./settings/SettingsSttSection";
import SettingsToggle from "./settings/SettingsToggle";
import SettingsTtsSection from "./settings/SettingsTtsSection";
import SettingsUpdater from "./settings/SettingsUpdater";
import SettingsAppProfileEditorOverlay from "./settings/SettingsAppProfileEditorOverlay";
import SettingsLanguageVariantOverlay, {
  type SettingsLanguageVariantOverlayApplyPayload,
} from "./settings/SettingsLanguageVariantOverlay";
import SettingsInfoHint from "./settings/SettingsInfoHint";
import {
  NAV_ITEMS,
  OPENAI_STT_MODEL,
  STATUS_RESET_MS,
  type LocalSttModel,
  type LocalTtsModel,
  type ModelDownloadProgressEvent,
  type SettingsSection,
} from "./settings/settingsShared";
import {
  diffLanguageVariantPreferences,
  getLanguageVariantSelectionSummary,
  mergeLanguageVariantPreferences,
  normalizeCustomLanguageVariants,
  normalizePreferredLanguageSelection,
} from "../utils/languageVariants";
import { formatAppWorkflowLabels } from "../utils/workflowLabels";

type PanelTone = "" | "success" | "error";

interface PanelMessage {
  tone: PanelTone;
  message: string;
}

interface AppProfilePromptDraft {
  toneHint: string;
  promptAppendix: string;
}

const SETTINGS_LOCALE = "zh-TW";
const EMPTY_PANEL_MESSAGE: PanelMessage = { tone: "", message: "" };
const EMPTY_BUSY_MESSAGE = { type: "" as const, message: "" };

const SECTION_META: Record<SettingsSection, { title: string; description?: string }> = {
  general: {
    title: "一般",
  },
  shortcuts: {
    title: "快捷鍵",
  },
  stt: {
    title: "語音輸入",
  },
  llm: {
    title: "LLM",
  },
  quickAction: {
    title: "快捷指令",
  },
  tts: {
    title: "語音合成",
  },
  appProfile: {
    title: "應用程式設定檔",
  },
  history: {
    title: "歷史與偏好",
  },
};

const SECTION_LABEL_KEYS: Record<SettingsSection, TranslationKey> = {
  general: "settings.section.general",
  shortcuts: "settings.section.shortcuts",
  stt: "settings.section.stt",
  llm: "settings.section.llm",
  quickAction: "settings.section.quickAction",
  tts: "settings.section.tts",
  appProfile: "settings.section.appProfile",
  history: "settings.section.history",
};

const createDefaultProfile = (index: number): AppProfile => ({
  id: `custom-${Date.now()}`,
  name: `新設定檔 ${index}`,
  keywords: [],
  enabled: true,
  applyToModes: ["A", "B1", "B2", "C"],
  toneHint: "",
  promptAppendix: "",
  preferredLanguage: "",
  outputMode: "",
  directPaste: null,
});

function SectionStatus({ status }: { status: PanelMessage | undefined }) {
  if (!status || !status.message) {
    return null;
  }

  return (
    <div
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        status.tone === "error" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
      }`}
    >
      {status.message}
    </div>
  );
}

function WorkspaceShell({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description?: string;
  status?: PanelMessage;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-shell-card flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-black/5 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[24px] font-semibold tracking-tight text-zinc-900">{title}</h2>
            {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
          </div>
          <SectionStatus status={status} />
        </div>
      </header>
      <div className="settings-scroll-area min-h-0 flex-1 px-5 py-4">{children}</div>
    </section>
  );
}

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
    customLanguageVariants, setCustomLanguageVariants,
    microphoneSource, setMicrophoneSource,
    launchOnStartup, setLaunchOnStartup,
    quickActionCommands, setQuickActionCommands,
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
    preferenceLearningEnabled, setPreferenceLearningEnabled,
    appProfiles, setAppProfiles,
  } = useAppStore();

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string>) => translate(SETTINGS_LOCALE, key, params),
    [],
  );

  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [sttApiKeyInput, setSttApiKeyInput] = useState("");
  const [sttApiKeySet, setSttApiKeySet] = useState(false);
  const [sttApiKeySaveStatus, setSttApiKeySaveStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaveStatus, setApiKeySaveStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [panelMessages, setPanelMessages] = useState<Record<string, PanelMessage>>({});
  const [hotkeyStatus, setHotkeyStatus] = useState<"" | "error">("");
  const [hotkeyErrorMessage, setHotkeyErrorMessage] = useState("");
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [audioDevicesLoading, setAudioDevicesLoading] = useState(false);
  const [localModels, setLocalModels] = useState<LocalSttModel[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = useState(false);
  const [localModelBusyId, setLocalModelBusyId] = useState("");
  const [localModelBusyAction, setLocalModelBusyAction] = useState<"" | "install" | "delete">("");
  const [localModelDownloadProgress, setLocalModelDownloadProgress] = useState<Record<string, ModelDownloadProgressEvent>>({});
  const [failedDownloadModelId, setFailedDownloadModelId] = useState("");
  const [localModelStatus, setLocalModelStatus] = useState<{ type: "" | "success" | "error"; message: string }>(EMPTY_BUSY_MESSAGE);
  const [localTtsModels, setLocalTtsModels] = useState<LocalTtsModel[]>([]);
  const [localTtsModelsLoading, setLocalTtsModelsLoading] = useState(false);
  const [ttsModelBusyId, setTtsModelBusyId] = useState("");
  const [ttsModelBusyAction, setTtsModelBusyAction] = useState<"" | "install" | "delete" | "select">("");
  const [ttsModelDownloadProgress, setTtsModelDownloadProgress] = useState<Record<string, ModelDownloadProgressEvent>>({});
  const [failedTtsDownloadModelId, setFailedTtsDownloadModelId] = useState("");
  const [ttsModelStatus, setTtsModelStatus] = useState<{ type: "" | "success" | "error"; message: string }>(EMPTY_BUSY_MESSAGE);
  const [promptDrafts, setPromptDrafts] = useState({ modeAPrompt, modeBPrompt, modeCPrompt });
  const [profilePromptDrafts, setProfilePromptDrafts] = useState<Record<string, AppProfilePromptDraft>>({});
  const [activeProfileOverlayId, setActiveProfileOverlayId] = useState<string | null>(null);
  const [languageVariantOverlay, setLanguageVariantOverlay] = useState<{ scope: "global" | "profile"; profileId?: string } | null>(null);

  const statusTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});

  const setPanelMessage = useCallback((panel: string, tone: PanelTone, message: string, ttlMs = STATUS_RESET_MS) => {
    setPanelMessages((prev) => ({ ...prev, [panel]: { tone, message } }));
    const existingTimer = statusTimersRef.current[panel];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    statusTimersRef.current[panel] = setTimeout(() => {
      setPanelMessages((prev) => ({ ...prev, [panel]: EMPTY_PANEL_MESSAGE }));
      statusTimersRef.current[panel] = undefined;
    }, ttlMs);
  }, []);

  const broadcastSettingsSaved = useCallback(async (payload: Record<string, unknown>) => {
    await emit("neuropen://settings-saved", payload);
  }, []);

  const formatBytes = useCallback((bytes?: number) => {
    if (!bytes || bytes <= 0) {
      return "0 MB";
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const normalizeHotkey = useCallback(
    (value: string) =>
      value
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "")
        .replace(/CONTROL/g, "CTRL"),
    [],
  );

  const currentSttModelChoice = useMemo(() => {
    const matchedLocalModel = localModels.find((model) => model.modelPath === sttModelPath)
      ?? localModels.find((model) => model.active);
    return sttEngine === "openAi" ? OPENAI_STT_MODEL : matchedLocalModel?.id ?? OPENAI_STT_MODEL;
  }, [localModels, sttEngine, sttModelPath]);

  const activeProfile = activeProfileOverlayId
    ? appProfiles.find((profile) => profile.id === activeProfileOverlayId) ?? null
    : null;

  const activeProfilePromptDraft = activeProfile
    ? profilePromptDrafts[activeProfile.id] ?? {
        toneHint: activeProfile.toneHint,
        promptAppendix: activeProfile.promptAppendix,
      }
    : null;

  const llmPromptDirty =
    promptDrafts.modeAPrompt !== modeAPrompt ||
    promptDrafts.modeBPrompt !== modeBPrompt ||
    promptDrafts.modeCPrompt !== modeCPrompt;

  const globalLanguageVariantSummary = useMemo(
    () =>
      getLanguageVariantSelectionSummary(preferredLanguage, customLanguageVariants, {
        emptyLabel: t("settings.preferredLanguage.auto"),
        countLabel: (count) => t("settings.languageVariant.profileSummary", { count: String(count) }),
      }),
    [customLanguageVariants, preferredLanguage, t],
  );

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await currentWindow.hide();
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(
    () => () => {
      Object.values(statusTimersRef.current).forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
    },
    [],
  );

  useEffect(() => {
    setPromptDrafts({ modeAPrompt, modeBPrompt, modeCPrompt });
  }, [modeAPrompt, modeBPrompt, modeCPrompt]);

  useEffect(() => {
    setProfilePromptDrafts((prev) => {
      const next: Record<string, AppProfilePromptDraft> = {};
      for (const profile of appProfiles) {
        next[profile.id] = prev[profile.id] ?? {
          toneHint: profile.toneHint,
          promptAppendix: profile.promptAppendix,
        };
      }
      return next;
    });
  }, [appProfiles]);

  useEffect(() => {
    settingsService.getSttCapabilities()
      .then((capabilities) => setLocalSttAvailable(capabilities.localAvailable))
      .catch(() => setLocalSttAvailable(false));

    settingsService.hasApiKey()
      .then((hasKey) => setApiKeySet(hasKey))
      .catch(() => setApiKeySet(false));

    settingsService.hasSttApiKey()
      .then((hasKey) => setSttApiKeySet(hasKey))
      .catch(() => setSttApiKeySet(false));

    setAudioDevicesLoading(true);
    settingsService.listAudioDevices()
      .then((devices) => setAudioDevices(devices))
      .catch(() => setAudioDevices([]))
      .finally(() => setAudioDevicesLoading(false));

    settingsService.getLaunchOnStartup()
      .then((enabled) => setLaunchOnStartup(enabled))
      .catch(() => {});

    settingsService.getRegisteredHotkeys()
      .then((registeredHotkeys) => {
        const effectiveTriggerHotkey = registeredHotkeys.triggerPersisted
          ? registeredHotkeys.triggerHotkey
          : hotkey;
        const effectiveScreenshotHotkey = registeredHotkeys.screenshotPersisted
          ? registeredHotkeys.screenshotHotkey
          : screenshotHotkey;
        const effectiveDialogHotkey = registeredHotkeys.dialogPersisted
          ? registeredHotkeys.dialogHotkey
          : dialogHotkey;
        setHotkey(effectiveTriggerHotkey);
        setScreenshotHotkey(effectiveScreenshotHotkey);
        setDialogHotkey(effectiveDialogHotkey);
      })
      .catch((error) => {
        console.warn("[Settings] get_registered_hotkeys failed:", error);
      });
  }, [
    dialogHotkey,
    hotkey,
    screenshotHotkey,
    setApiKeySet,
    setDialogHotkey,
    setHotkey,
    setLaunchOnStartup,
    setLocalSttAvailable,
    setScreenshotHotkey,
  ]);

  const loadLocalModels = useCallback(async () => {
    setLocalModelsLoading(true);
    try {
      setLocalModels(await settingsService.listLocalSttModels());
    } catch (error) {
      console.error("[Settings] list_local_stt_models failed:", error);
      setLocalModelStatus({ type: "error", message: t("settings.error.loadModels") });
    } finally {
      setLocalModelsLoading(false);
    }
  }, [t]);

  const loadLocalTtsModels = useCallback(async () => {
    setLocalTtsModelsLoading(true);
    try {
      setLocalTtsModels(await settingsService.listLocalTtsModels());
    } catch (error) {
      console.error("[Settings] list_local_tts_models failed:", error);
      setTtsModelStatus({ type: "error", message: t("settings.error.loadTtsModels") });
    } finally {
      setLocalTtsModelsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadLocalModels();
    void loadLocalTtsModels();
  }, [loadLocalModels, loadLocalTtsModels]);

  useEffect(() => {
    let disposed = false;
    let unlistenProgress: (() => void) | undefined;
    void listen<ModelDownloadProgressEvent>("stt://model-download-progress", (event) => {
      if (disposed) {
        return;
      }
      setLocalModelDownloadProgress((prev) => ({
        ...prev,
        [event.payload.modelId]: event.payload,
      }));
      if (event.payload.status === "cancelled") {
        setLocalModelStatus({ type: "success", message: t("settings.status.modelInstallCancelled") });
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlistenProgress = dispose;
    });

    return () => {
      disposed = true;
      unlistenProgress?.();
    };
  }, [t]);

  useEffect(() => {
    let disposed = false;
    let unlistenProgress: (() => void) | undefined;
    void listen<ModelDownloadProgressEvent>("tts://model-download-progress", (event) => {
      if (disposed) {
        return;
      }
      setTtsModelDownloadProgress((prev) => ({
        ...prev,
        [event.payload.modelId]: event.payload,
      }));
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlistenProgress = dispose;
    });

    return () => {
      disposed = true;
      unlistenProgress?.();
    };
  }, []);

  const validateHotkeys = useCallback((nextTrigger: string, nextScreenshot: string, nextDialog: string) => {
    const normalizedTrigger = normalizeHotkey(nextTrigger);
    const normalizedScreenshot = normalizeHotkey(nextScreenshot);
    const normalizedDialog = normalizeHotkey(nextDialog);
    const normalizedUndoHotkey = normalizeHotkey("Alt+Z");

    if (normalizedTrigger && normalizedTrigger === normalizedScreenshot) {
      return t("settings.hotkey.conflictTriggerScreenshot");
    }
    if (normalizedTrigger && normalizedTrigger === normalizedDialog) {
      return t("settings.hotkey.conflictTriggerDialog");
    }
    if (normalizedScreenshot && normalizedScreenshot === normalizedDialog) {
      return t("settings.hotkey.conflictScreenshotDialog");
    }
    if (
      normalizedTrigger === normalizedUndoHotkey ||
      normalizedScreenshot === normalizedUndoHotkey ||
      normalizedDialog === normalizedUndoHotkey
    ) {
      return t("settings.hotkey.conflictUndo");
    }
    return "";
  }, [normalizeHotkey, t]);

  const resolveSttSelection = useCallback((modelChoice: string): {
    engine: "openAi" | "localWhisper" | "senseVoice" | "moonshine";
    modelPath: string;
  } => {
    if (modelChoice === OPENAI_STT_MODEL) {
      return { engine: "openAi" as const, modelPath: "" };
    }
    const matchedLocalModel = localModels.find((model) => model.id === modelChoice && model.installed);
    if (!matchedLocalModel) {
      return { engine: "openAi" as const, modelPath: "" };
    }
    const engine: "openAi" | "localWhisper" | "senseVoice" | "moonshine" =
      matchedLocalModel.engine === "sensevoice"
        ? "senseVoice"
        : matchedLocalModel.engine === "moonshine"
          ? "moonshine"
          : "localWhisper";
    return {
      engine,
      modelPath: matchedLocalModel.modelPath,
    };
  }, [localModels]);

  const withModelBusy = useCallback(async (
    modelId: string,
    action: "install" | "delete",
    fn: () => Promise<void>,
    successMessage: string,
    errorMessage: string,
  ) => {
    setLocalModelBusyId(modelId);
    setLocalModelBusyAction(action);
    setLocalModelStatus({ type: "", message: "" });
    try {
      await fn();
      await loadLocalModels();
      setLocalModelStatus({ type: "success", message: successMessage });
      return true;
    } catch (error) {
      console.error(`[Settings] ${action}_local_stt_model failed:`, error);
      setLocalModelStatus({ type: "error", message: errorMessage });
      return false;
    } finally {
      setLocalModelBusyId("");
      setLocalModelBusyAction("");
    }
  }, [loadLocalModels]);

  const withTtsModelBusy = useCallback(async (
    modelId: string,
    action: "install" | "delete" | "select",
    fn: () => Promise<void>,
    successMessage: string,
    errorMessage: string,
  ) => {
    setTtsModelBusyId(modelId);
    setTtsModelBusyAction(action);
    setTtsModelStatus({ type: "", message: "" });
    try {
      await fn();
      await loadLocalTtsModels();
      setTtsModelStatus({ type: "success", message: successMessage });
      return true;
    } catch (error) {
      console.error(`[Settings] ${action}_local_tts_model failed:`, error);
      setTtsModelStatus({ type: "error", message: errorMessage });
      return false;
    } finally {
      setTtsModelBusyId("");
      setTtsModelBusyAction("");
    }
  }, [loadLocalTtsModels]);

  const handleSaveApiKey = useCallback(() => {
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
  }, [apiKeyInput, setApiKeySet]);

  const handleSaveSttApiKey = useCallback(() => {
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
  }, [sttApiKeyInput]);

  const handleToggleSetting = useCallback(async (
    section: SettingsSection,
    setter: (value: boolean) => void,
    payloadKey:
      | "sttEnabled"
      | "selectionEnabled"
      | "screenshotEnabled"
      | "historyEnabled"
      | "preferenceLearningEnabled"
      | "contextAwareTone"
      | "modeAStreamOutput"
      | "modeBStreamOutput",
    value: boolean,
  ) => {
    setter(value);
    await broadcastSettingsSaved({ [payloadKey]: value });
    setPanelMessage(section, "success", t("settings.saveApplied"));
  }, [broadcastSettingsSaved, setPanelMessage, t]);

  const applyHotkeyUpdate = useCallback(async (kind: "trigger" | "screenshot" | "dialog", value: string) => {
    const nextHotkey = kind === "trigger" ? value : hotkey;
    const nextScreenshotHotkey = kind === "screenshot" ? value : screenshotHotkey;
    const nextDialogHotkey = kind === "dialog" ? value : dialogHotkey;
    const conflictMessage = validateHotkeys(nextHotkey, nextScreenshotHotkey, nextDialogHotkey);

    if (conflictMessage) {
      setHotkeyStatus("error");
      setHotkeyErrorMessage(conflictMessage);
      setPanelMessage("shortcuts", "error", conflictMessage);
      return;
    }

    try {
      if (kind === "trigger") {
        await settingsService.changeHotkey(value.trim());
        setHotkey(value.trim());
        await broadcastSettingsSaved({ hotkey: value.trim() });
      } else if (kind === "screenshot") {
        await settingsService.changeScreenshotHotkey(value.trim());
        setScreenshotHotkey(value.trim());
        await broadcastSettingsSaved({ screenshotHotkey: value.trim() });
      } else {
        await settingsService.changeDialogHotkey(value.trim());
        setDialogHotkey(value.trim());
        await broadcastSettingsSaved({ dialogHotkey: value.trim() });
      }
      setHotkeyStatus("");
      setHotkeyErrorMessage("");
      setPanelMessage("shortcuts", "success", t("settings.saveApplied"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHotkeyStatus("error");
      setHotkeyErrorMessage(message);
      setPanelMessage("shortcuts", "error", message);
    }
  }, [
    broadcastSettingsSaved,
    dialogHotkey,
    hotkey,
    screenshotHotkey,
    setDialogHotkey,
    setHotkey,
    setPanelMessage,
    setScreenshotHotkey,
    t,
    validateHotkeys,
  ]);

  const handleWakeWordChange = useCallback(async (value: string) => {
    if (!value.trim()) {
      setPanelMessage("stt", "error", "喚醒詞不能留白。");
      return;
    }
    setWakeWord(value);
    await broadcastSettingsSaved({ wakeWord: value.trim() });
  }, [broadcastSettingsSaved, setPanelMessage, setWakeWord]);

  const handleLaunchOnStartupChange = useCallback(async (value: boolean) => {
    const previousValue = launchOnStartup;
    try {
      await settingsService.setLaunchOnStartup(value);
      setLaunchOnStartup(value);
      await broadcastSettingsSaved({ launchOnStartup: value });
      setPanelMessage("general", "success", t("settings.saveApplied"));
    } catch (error) {
      setLaunchOnStartup(previousValue);
      setPanelMessage("general", "error", error instanceof Error ? error.message : String(error));
    }
  }, [broadcastSettingsSaved, launchOnStartup, setLaunchOnStartup, setPanelMessage, t]);

  const handleMicrophoneSourceChange = useCallback(async (value: string) => {
    const previousValue = microphoneSource;
    try {
      await settingsService.setAudioDevice(value);
      setMicrophoneSource(value);
      await broadcastSettingsSaved({ microphoneSource: value });
    } catch (error) {
      setMicrophoneSource(previousValue);
      setPanelMessage("stt", "error", error instanceof Error ? error.message : String(error));
    }
  }, [broadcastSettingsSaved, microphoneSource, setMicrophoneSource, setPanelMessage]);

  const handleSttModelChoiceChange = useCallback(async (value: string) => {
    const { engine, modelPath } = resolveSttSelection(value);
    const isExternalChoice = value === OPENAI_STT_MODEL;
    if (!isExternalChoice && !localModels.some((model) => model.id === value && model.installed)) {
      setPanelMessage("stt", "error", t("settings.stt.localModelRequired"));
      return;
    }

    try {
      await settingsService.setRuntimeSttConfig({ engine, modelPath, sttLanguage });
      setSttEngine(engine);
      setSttModelPath(modelPath);
      await broadcastSettingsSaved({ sttEngine: engine, sttModelPath: modelPath, sttLanguage });
      setPanelMessage("stt", "success", t("settings.saveApplied"));
    } catch (error) {
      setPanelMessage("stt", "error", error instanceof Error ? error.message : String(error));
    }
  }, [
    broadcastSettingsSaved,
    localModels,
    resolveSttSelection,
    setPanelMessage,
    setSttEngine,
    setSttModelPath,
    sttLanguage,
    t,
  ]);

  const handleSttLanguageChange = useCallback(async (value: typeof sttLanguage) => {
    const previousValue = sttLanguage;
    try {
      await settingsService.setRuntimeSttConfig({ engine: sttEngine, modelPath: sttModelPath, sttLanguage: value });
      setSttLanguage(value);
      await broadcastSettingsSaved({ sttEngine, sttModelPath, sttLanguage: value });
    } catch (error) {
      setSttLanguage(previousValue);
      setPanelMessage("stt", "error", error instanceof Error ? error.message : String(error));
    }
  }, [broadcastSettingsSaved, setPanelMessage, setSttLanguage, sttEngine, sttLanguage, sttModelPath]);

  const handleSttOutputStrategyChange = useCallback(async (value: typeof sttOutputStrategy) => {
    const nextTranslationTarget = value === "llmRefine" ? translationTarget : "off";
    setSttOutputStrategy(value);
    if (value !== "llmRefine") {
      setTranslationTarget("off");
    }
    await broadcastSettingsSaved({ sttOutputStrategy: value, translationTarget: nextTranslationTarget });
  }, [broadcastSettingsSaved, setSttOutputStrategy, setTranslationTarget, translationTarget]);

  const handleTranslationTargetChange = useCallback(async (value: TranslationTarget) => {
    setTranslationTarget(value);
    await broadcastSettingsSaved({ translationTarget: value });
  }, [broadcastSettingsSaved, setTranslationTarget]);

  const handlePunctuationModeChange = useCallback(async (value: typeof punctuationMode) => {
    setPunctuationMode(value);
    await broadcastSettingsSaved({ punctuationMode: value });
  }, [broadcastSettingsSaved, setPunctuationMode]);

  const handleVocabularyTermsChange = useCallback(async (value: string) => {
    const nextVocabularyTerms = value
      .split(/\r?\n|,/)
      .map((term) => term.trim())
      .filter(Boolean);
    setVocabularyTerms(nextVocabularyTerms);
    await broadcastSettingsSaved({ vocabularyTerms: nextVocabularyTerms });
  }, [broadcastSettingsSaved, setVocabularyTerms]);

  const handleImportVocabularyFile = useCallback(async (file: File | null) => {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const imported = text.split(/\r?\n|,/).map((term) => term.trim()).filter(Boolean);
      const merged = Array.from(new Set([...vocabularyTerms, ...imported]));
      setVocabularyTerms(merged);
      await broadcastSettingsSaved({ vocabularyTerms: merged });
      setLocalModelStatus({ type: "success", message: t("settings.stt.vocabularyImported") });
    } catch (error) {
      console.error("[Settings] import vocabulary failed:", error);
      setLocalModelStatus({ type: "error", message: t("settings.stt.vocabularyImportFailed") });
    }
  }, [broadcastSettingsSaved, setVocabularyTerms, t, vocabularyTerms]);

  const handleLlmProviderChange = useCallback(async (value: typeof llmProvider) => {
    setLlmProvider(value);
    await broadcastSettingsSaved({ llmProvider: value });
  }, [broadcastSettingsSaved, setLlmProvider]);

  const handleLlmModelChange = useCallback(async (value: string) => {
    const nextValue = value.trim();
    if (!nextValue) {
      return;
    }
    const nextOptions = normalizeLlmModelOptions(llmModelOptions, nextValue);
    setLlmModel(nextValue);
    setLlmModelOptions(nextOptions);
    await broadcastSettingsSaved({ llmModel: nextValue, llmModelOptions: nextOptions });
  }, [broadcastSettingsSaved, llmModelOptions, setLlmModel, setLlmModelOptions]);

  const handleAddLlmModelOption = useCallback(async () => {
    const nextOptions = normalizeLlmModelOptions(llmModelOptions, llmModel);
    setLlmModelOptions(nextOptions);
    await broadcastSettingsSaved({ llmModelOptions: nextOptions, llmModel });
  }, [broadcastSettingsSaved, llmModel, llmModelOptions, setLlmModelOptions]);

  const handleDeleteLlmModelOption = useCallback(async (modelToDelete: string) => {
    const remainingModels = llmModelOptions.filter((model) => model !== modelToDelete);
    const fallbackModel = remainingModels[0] ?? llmModel;
    const nextOptions = normalizeLlmModelOptions(remainingModels, fallbackModel);
    setLlmModelOptions(nextOptions);
    if (llmModel === modelToDelete && fallbackModel.trim()) {
      setLlmModel(fallbackModel.trim());
    }
    await broadcastSettingsSaved({
      llmModel: llmModel === modelToDelete ? fallbackModel.trim() || llmModel : llmModel,
      llmModelOptions: nextOptions,
    });
  }, [broadcastSettingsSaved, llmModel, llmModelOptions, setLlmModel, setLlmModelOptions]);

  const handleOutputModeChange = useCallback(async (value: typeof outputMode) => {
    setOutputMode(value);
    await broadcastSettingsSaved({ outputMode: value });
  }, [broadcastSettingsSaved, setOutputMode]);

  const commitQuickActionCommands = useCallback(async (nextCommands: QuickActionCommand[]) => {
    setQuickActionCommands(nextCommands);
    await broadcastSettingsSaved({ quickActionCommands: nextCommands });
  }, [broadcastSettingsSaved, setQuickActionCommands]);

  const handleAddQuickActionCommand = useCallback(() => {
    void commitQuickActionCommands([
      ...quickActionCommands,
      { id: `custom-${Date.now()}`, label: t("settings.quickAction.newCommand"), instruction: "" },
    ]);
  }, [commitQuickActionCommands, quickActionCommands, t]);

  const handleUpdateQuickActionCommand = useCallback((commandId: string, field: "label" | "instruction", value: string) => {
    void commitQuickActionCommands(
      quickActionCommands.map((command) =>
        command.id === commandId ? { ...command, [field]: value } : command,
      ),
    );
  }, [commitQuickActionCommands, quickActionCommands]);

  const handleDeleteQuickActionCommand = useCallback((commandId: string) => {
    void commitQuickActionCommands(quickActionCommands.filter((command) => command.id !== commandId));
  }, [commitQuickActionCommands, quickActionCommands]);

  const handleMoveQuickActionCommand = useCallback((commandId: string, direction: "up" | "down") => {
    const index = quickActionCommands.findIndex((command) => command.id === commandId);
    if (index < 0) {
      return;
    }
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= quickActionCommands.length) {
      return;
    }
    const nextCommands = [...quickActionCommands];
    const [movedCommand] = nextCommands.splice(index, 1);
    nextCommands.splice(targetIndex, 0, movedCommand);
    void commitQuickActionCommands(nextCommands);
  }, [commitQuickActionCommands, quickActionCommands]);

  const handleTtsVoiceChange = useCallback(async (value: string) => {
    setTtsVoice(value);
    await broadcastSettingsSaved({ ttsVoice: value, ttsRate, ttsPitch });
  }, [broadcastSettingsSaved, setTtsVoice, ttsPitch, ttsRate]);

  const handleTtsRateChange = useCallback(async (value: string) => {
    setTtsRate(value);
    await broadcastSettingsSaved({ ttsVoice, ttsRate: value, ttsPitch });
  }, [broadcastSettingsSaved, setTtsRate, ttsPitch, ttsVoice]);

  const handleTtsPitchChange = useCallback(async (value: string) => {
    setTtsPitch(value);
    await broadcastSettingsSaved({ ttsVoice, ttsRate, ttsPitch: value });
  }, [broadcastSettingsSaved, setTtsPitch, ttsRate, ttsVoice]);

  const handleInstallLocalModel = useCallback(async (modelId: string) => {
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
  }, [t, withModelBusy]);

  const handleCancelLocalModelDownload = useCallback(async () => {
    await settingsService.cancelLocalSttDownload();
  }, []);

  const handleDeleteLocalModel = useCallback((modelId: string) => {
    void withModelBusy(
      modelId,
      "delete",
      async () => {
        const deletingModel = localModels.find((model) => model.id === modelId);
        await settingsService.deleteLocalSttModel(modelId);
        if (deletingModel && (deletingModel.modelPath === sttModelPath || currentSttModelChoice === modelId)) {
          setSttEngine("openAi");
          setSttModelPath("");
          await settingsService.setRuntimeSttConfig({ engine: "openAi", modelPath: "", sttLanguage });
          await broadcastSettingsSaved({ sttEngine: "openAi", sttModelPath: "", sttLanguage });
        }
      },
      t("settings.status.modelDeleted"),
      t("settings.status.modelDeleteFailed"),
    );
  }, [
    broadcastSettingsSaved,
    currentSttModelChoice,
    localModels,
    setSttEngine,
    setSttModelPath,
    sttLanguage,
    sttModelPath,
    t,
    withModelBusy,
  ]);

  const handleInstallLocalTtsModel = useCallback(async (modelId: string) => {
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
  }, [t, withTtsModelBusy]);

  const handleCancelLocalTtsModelDownload = useCallback(async () => {
    await settingsService.cancelLocalTtsDownload();
  }, []);

  const handleSelectLocalTtsModel = useCallback((modelId: string) => {
    void withTtsModelBusy(
      modelId,
      "select",
      async () => {
        const modelPath = await settingsService.selectLocalTtsModel(modelId);
        setTtsVoice(modelPath);
        await broadcastSettingsSaved({ ttsVoice: modelPath, ttsRate, ttsPitch });
      },
      t("settings.status.ttsModelSelected"),
      t("settings.status.ttsModelSelectFailed"),
    );
  }, [broadcastSettingsSaved, setTtsVoice, t, ttsPitch, ttsRate, withTtsModelBusy]);

  const handleDeleteLocalTtsModel = useCallback((modelId: string) => {
    void withTtsModelBusy(
      modelId,
      "delete",
      async () => {
        const deletingModel = localTtsModels.find((model) => model.id === modelId);
        await settingsService.deleteLocalTtsModel(modelId);
        if (deletingModel?.modelPath === ttsVoice) {
          setTtsVoice("");
          await broadcastSettingsSaved({ ttsVoice: "", ttsRate, ttsPitch });
        }
      },
      t("settings.status.ttsModelDeleted"),
      t("settings.status.ttsModelDeleteFailed"),
    );
  }, [broadcastSettingsSaved, localTtsModels, setTtsVoice, t, ttsPitch, ttsRate, ttsVoice, withTtsModelBusy]);

  const handleSaveModePrompts = useCallback(async () => {
    const nextModeAPrompt = promptDrafts.modeAPrompt.trim();
    const nextModeBPrompt = promptDrafts.modeBPrompt.trim();
    const nextModeCPrompt = promptDrafts.modeCPrompt.trim();
    if (!nextModeAPrompt || !nextModeBPrompt || !nextModeCPrompt) {
      setPanelMessage("llm", "error", "Mode Prompt 不可留白。");
      return;
    }
    setModeAPrompt(nextModeAPrompt);
    setModeBPrompt(nextModeBPrompt);
    setModeCPrompt(nextModeCPrompt);
    await broadcastSettingsSaved({
      modeAPrompt: nextModeAPrompt,
      modeBPrompt: nextModeBPrompt,
      modeCPrompt: nextModeCPrompt,
    });
    setPanelMessage("llm", "success", "Prompt 已儲存並套用。");
  }, [broadcastSettingsSaved, promptDrafts, setModeAPrompt, setModeBPrompt, setModeCPrompt, setPanelMessage]);

  const updateProfiles = useCallback(async (
    nextProfiles: AppProfile[],
    options?: { message?: string; includeCustomVariants?: CustomLanguageVariant[] },
  ) => {
    setAppProfiles(nextProfiles);
    await broadcastSettingsSaved({
      appProfiles: nextProfiles,
      ...(options?.includeCustomVariants ? { customLanguageVariants: options.includeCustomVariants } : {}),
    });
    if (options?.message) {
      setPanelMessage("appProfile", "success", options.message);
    }
  }, [broadcastSettingsSaved, setAppProfiles, setPanelMessage]);

  const handleAddProfile = useCallback(() => {
    const newProfile = createDefaultProfile(appProfiles.length + 1);
    void updateProfiles([...appProfiles, newProfile], { message: "已新增設定檔。" });
    setActiveProfileOverlayId(newProfile.id);
  }, [appProfiles, updateProfiles]);

  const handleDeleteProfile = useCallback((profileId: string) => {
    void updateProfiles(appProfiles.filter((profile) => profile.id !== profileId), { message: "設定檔已刪除。" });
    setProfilePromptDrafts((prev) => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
    if (activeProfileOverlayId === profileId) {
      setActiveProfileOverlayId(null);
    }
  }, [activeProfileOverlayId, appProfiles, updateProfiles]);

  const handleMoveProfile = useCallback((profileId: string, direction: "up" | "down") => {
    const currentIndex = appProfiles.findIndex((profile) => profile.id === profileId);
    if (currentIndex < 0) {
      return;
    }
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= appProfiles.length) {
      return;
    }
    const nextProfiles = [...appProfiles];
    const [movedProfile] = nextProfiles.splice(currentIndex, 1);
    nextProfiles.splice(targetIndex, 0, movedProfile);
    void updateProfiles(nextProfiles);
  }, [appProfiles, updateProfiles]);

  const handleImmediateProfileChange = useCallback((profileId: string, patch: Partial<AppProfile>) => {
    void updateProfiles(
      appProfiles.map((profile) => (profile.id === profileId ? { ...profile, ...patch } : profile)),
    );
  }, [appProfiles, updateProfiles]);

  const handleProfilePromptDraftChange = useCallback((profileId: string, patch: { toneHint?: string; promptAppendix?: string }) => {
    setProfilePromptDrafts((prev) => ({
      ...prev,
      [profileId]: {
        toneHint: patch.toneHint ?? prev[profileId]?.toneHint ?? "",
        promptAppendix: patch.promptAppendix ?? prev[profileId]?.promptAppendix ?? "",
      },
    }));
  }, []);

  const handleSaveProfilePrompts = useCallback(async (profileId: string) => {
    const promptDraft = profilePromptDrafts[profileId];
    if (!promptDraft) {
      return;
    }
    const nextProfiles = appProfiles.map((profile) =>
      profile.id === profileId
        ? { ...profile, toneHint: promptDraft.toneHint, promptAppendix: promptDraft.promptAppendix }
        : profile,
    );
    setAppProfiles(nextProfiles);
    await broadcastSettingsSaved({ appProfiles: nextProfiles });
    setPanelMessage("appProfile", "success", "設定檔 prompt 已儲存。");
  }, [appProfiles, broadcastSettingsSaved, profilePromptDrafts, setAppProfiles, setPanelMessage]);

  const handleApplyLanguageVariantSelection = useCallback(async (payload: SettingsLanguageVariantOverlayApplyPayload) => {
    const nextCustomVariants = normalizeCustomLanguageVariants(payload.customVariants);
    setCustomLanguageVariants(nextCustomVariants);

    if (payload.scope === "global") {
      const normalizedPreferences = normalizePreferredLanguageSelection(payload.preferences, nextCustomVariants);
      setPreferredLanguage(normalizedPreferences);
      await broadcastSettingsSaved({
        preferredLanguage: normalizedPreferences,
        customLanguageVariants: nextCustomVariants,
      });
      setPanelMessage("llm", "success", "語言變體已立即套用。");
      return;
    }

    const nextProfilePreferences: PreferredLanguage | "" = payload.useGlobal
      ? ""
      : (() => {
          const diff = diffLanguageVariantPreferences(preferredLanguage, payload.preferences, nextCustomVariants);
          return Object.keys(diff).length > 0 ? diff : "";
        })();

    await updateProfiles(
      appProfiles.map((profile) =>
        profile.id === payload.profileId ? { ...profile, preferredLanguage: nextProfilePreferences } : profile,
      ),
      { includeCustomVariants: nextCustomVariants },
    );
    setPanelMessage("appProfile", "success", "設定檔語言變體已立即套用。");
  }, [
    appProfiles,
    broadcastSettingsSaved,
    preferredLanguage,
    setCustomLanguageVariants,
    setPanelMessage,
    setPreferredLanguage,
    updateProfiles,
  ]);

  const renderGeneralSection = () => (
    <WorkspaceShell {...SECTION_META.general} status={panelMessages.general}>
      <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <section className="settings-stage-card p-4">
              <div className="grid gap-3 lg:grid-cols-2">
                {[
                  [
                    "settings.feature.stt",
                    "控制按住錄音、喚醒詞與語音辨識流程是否啟用。",
                    sttEnabled,
                    setSttEnabled,
                    "sttEnabled",
                  ],
                  [
                    "settings.feature.selection",
                    "控制選詞後的 Quick Action 與選詞語音流程是否啟用。",
                    selectionEnabled,
                    setSelectionEnabled,
                    "selectionEnabled",
                  ],
                  [
                    "settings.feature.screenshot",
                    "控制截圖問 AI 與相關熱鍵是否啟用。",
                    screenshotEnabled,
                    setScreenshotEnabled,
                    "screenshotEnabled",
                  ],
                ].map(([labelKey, hintText, enabled, setter, payloadKey]) => (
                  <div
                    key={String(labelKey)}
                    className="flex min-h-[52px] items-center justify-between rounded-2xl border border-zinc-200 bg-white px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2 pr-3">
                      <span className="truncate text-sm font-medium text-zinc-800">{t(labelKey as TranslationKey)}</span>
                      <SettingsInfoHint text={String(hintText)} />
                    </div>
                    <SettingsToggle
                      checked={Boolean(enabled)}
                      onChange={(nextValue) =>
                        void handleToggleSetting(
                          "general",
                          setter as (value: boolean) => void,
                          payloadKey as never,
                          nextValue,
                        )}
                      ariaLabel={t(labelKey as TranslationKey)}
                    />
                  </div>
                ))}
                <div className="flex min-h-[52px] items-center justify-between rounded-2xl border border-zinc-200 bg-[#fcfbf8] px-3 py-2">
                  <div className="pr-3">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-zinc-800">{t("settings.launchOnStartup.label")}</p>
                      <SettingsInfoHint text={t("settings.launchOnStartup.hint")} />
                    </div>
                    <p className="text-[11px] text-zinc-500">{t("settings.launchOnStartup.hint")}</p>
                  </div>
                  <SettingsToggle
                    checked={launchOnStartup}
                    onChange={(nextValue) => void handleLaunchOnStartupChange(nextValue)}
                    ariaLabel={t("settings.launchOnStartup.label")}
                  />
                </div>
              </div>
            </section>
            <section className="settings-stage-card p-4">
              <SettingsUpdater t={t} />
            </section>
          </div>
          <section className="settings-stage-card p-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-zinc-900">{SECTION_META.shortcuts.title}</h3>
              <SettingsInfoHint text="設定錄音、截圖與 AI 對話框的全域快捷鍵，變更後立即註冊。" />
            </div>
            <div className="mt-3">
              <SettingsShortcutsSection
                draftHotkey={hotkey}
                draftScreenshotHotkey={screenshotHotkey}
                draftDialogHotkey={dialogHotkey}
                hotkeyStatus={hotkeyStatus}
                hotkeyErrorMessage={hotkeyErrorMessage}
                onHotkeyChange={(value) => void applyHotkeyUpdate("trigger", value)}
                onScreenshotHotkeyChange={(value) => void applyHotkeyUpdate("screenshot", value)}
                onDialogHotkeyChange={(value) => void applyHotkeyUpdate("dialog", value)}
                onClearHotkeyError={() => {
                  setHotkeyStatus("");
                  setHotkeyErrorMessage("");
                }}
                t={t}
              />
            </div>
          </section>
      </div>
    </WorkspaceShell>
  );

  const renderQuickActionSection = () => (
    <WorkspaceShell {...SECTION_META.quickAction} status={panelMessages.quickAction}>
      <section className="settings-stage-card p-4">
        <SettingsQuickActionSection
          commands={quickActionCommands}
          onAdd={handleAddQuickActionCommand}
          onDelete={handleDeleteQuickActionCommand}
          onMove={handleMoveQuickActionCommand}
          onUpdate={handleUpdateQuickActionCommand}
          t={t}
        />
      </section>
    </WorkspaceShell>
  );

  const renderAppProfileSection = () => (
    <WorkspaceShell {...SECTION_META.appProfile} status={panelMessages.appProfile}>
      <div className="space-y-4">
        <section className="settings-stage-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-zinc-900">{t("settings.appProfile.title")}</h3>
                <SettingsInfoHint text={t("settings.appProfile.description")} />
              </div>
              <p className="text-xs text-zinc-500">{t("settings.appProfile.description")}</p>
            </div>
            <SettingsToggle
              checked={contextAwareTone}
              onChange={(nextValue) =>
                void handleToggleSetting("appProfile", setContextAwareTone, "contextAwareTone", nextValue)}
              ariaLabel={t("settings.appProfile.title")}
            />
          </div>
        </section>
        <section className={`settings-stage-card p-4 ${contextAwareTone ? "" : "opacity-50"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-zinc-900">設定檔</h3>
            <button type="button" onClick={handleAddProfile} disabled={!contextAwareTone} className="btn-primary px-4 py-2 text-sm disabled:opacity-40">
              + {t("settings.appProfile.add")}
            </button>
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {appProfiles.map((profile, index) => (
              <article key={profile.id} className="rounded-[22px] border border-zinc-200 bg-[#fcfbf8] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate text-base font-semibold text-zinc-900">
                      {profile.name || t("settings.appProfile.namePlaceholder")}
                    </h4>
                    <p className="mt-1 text-xs text-zinc-500">
                      {profile.keywords.length > 0 ? profile.keywords.join("、") : "尚未設定關鍵字"}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button type="button" onClick={() => handleMoveProfile(profile.id, "up")} disabled={index === 0 || !contextAwareTone} className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs disabled:opacity-30">▲</button>
                    <button type="button" onClick={() => handleMoveProfile(profile.id, "down")} disabled={index === appProfiles.length - 1 || !contextAwareTone} className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs disabled:opacity-30">▼</button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <div className="settings-chip">{formatAppWorkflowLabels(profile.applyToModes, t)}</div>
                  <div className="settings-chip">
                    {getLanguageVariantSelectionSummary(profile.preferredLanguage, customLanguageVariants, {
                      emptyLabel: t("settings.appProfile.useGlobal"),
                      globalLabel: t("settings.appProfile.useGlobal"),
                      countLabel: (count) => t("settings.languageVariant.profileSummary", { count: String(count) }),
                    })}
                  </div>
                  <div className="settings-chip">{profile.outputMode || t("settings.appProfile.useGlobal")}</div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">啟用</span>
                    <SettingsToggle
                      checked={profile.enabled}
                      disabled={!contextAwareTone}
                      onChange={(nextValue) => handleImmediateProfileChange(profile.id, { enabled: nextValue })}
                      ariaLabel={profile.name || t("settings.appProfile.namePlaceholder")}
                    />
                  </div>
                  <button type="button" onClick={() => setActiveProfileOverlayId(profile.id)} disabled={!contextAwareTone} className="btn-primary px-4 py-2 text-sm disabled:opacity-40">
                    編輯
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );

  const renderSection = () => {
    switch (activeSection) {
      case "general":
        return renderGeneralSection();
      case "shortcuts":
        return renderGeneralSection();
      case "stt":
        return (
          <WorkspaceShell {...SECTION_META.stt} status={panelMessages.stt}>
            <SettingsSttSection
              draftWakeWord={wakeWord}
              draftSttEnabled={sttEnabled}
              draftSttModelChoice={currentSttModelChoice}
              draftSttLanguage={sttLanguage}
              draftMicrophoneSource={microphoneSource}
              draftTranslationTarget={translationTarget}
              draftSttOutputStrategy={sttOutputStrategy}
              draftPunctuationMode={punctuationMode}
              draftVocabularyTerms={vocabularyTerms.join("\n")}
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
              getLocalizedModelName={(model) => model.name}
              getLocalizedModelDescription={(model) => model.description}
              onWakeWordChange={(value) => void handleWakeWordChange(value)}
              onSttModelChoiceChange={(value) => void handleSttModelChoiceChange(value)}
              onSttLanguageChange={(value) => void handleSttLanguageChange(value)}
              onMicrophoneSourceChange={(value) => void handleMicrophoneSourceChange(value)}
              onSttApiKeyInputChange={setSttApiKeyInput}
              onSaveSttApiKey={handleSaveSttApiKey}
              onSttOutputStrategyChange={(value) => void handleSttOutputStrategyChange(value)}
              onTranslationTargetChange={(value) => void handleTranslationTargetChange(value)}
              onPunctuationModeChange={(value) => void handlePunctuationModeChange(value)}
              onVocabularyTermsChange={(value) => void handleVocabularyTermsChange(value)}
              onImportVocabularyFile={handleImportVocabularyFile}
              onInstallLocalModel={handleInstallLocalModel}
              onCancelLocalModelDownload={handleCancelLocalModelDownload}
              onDeleteLocalModel={handleDeleteLocalModel}
              t={t}
            />
          </WorkspaceShell>
        );
      case "llm":
        return (
          <WorkspaceShell {...SECTION_META.llm} status={panelMessages.llm}>
            <div className="space-y-4">
              <section className="settings-stage-card p-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-[22px] border border-zinc-200 bg-[#fcfbf8] p-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-zinc-500">{t("settings.llm.outputMode")}</label>
                        <SettingsInfoHint text="決定 LLM 結果先進預覽視窗，或直接注入到目前輸入位置。" />
                      </div>
                      <div className="mt-2 grid gap-2">
                        {(["PreviewStream", "DirectInject"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => void handleOutputModeChange(mode)}
                            className={`flex h-10 items-center justify-between rounded-2xl px-3 text-sm font-medium ${
                              outputMode === mode ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-700"
                            }`}
                          >
                            <span>{mode === "PreviewStream" ? t("settings.llm.previewStream") : t("settings.llm.directInject")}</span>
                            <span className="text-xs">{outputMode === mode ? "使用中" : "切換"}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-zinc-200 bg-[#fcfbf8] p-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-zinc-500">{t("settings.llm.streamToggles")}</label>
                        <SettingsInfoHint text={t("settings.llm.streamTogglesHint")} />
                      </div>
                      <div className="mt-2 space-y-2">
                        <div className="flex h-10 items-center justify-between rounded-2xl border border-zinc-200 bg-white px-3">
                          <span className="pr-3 text-sm text-zinc-700">{t("settings.llm.modeAStreamOutput")}</span>
                          <SettingsToggle
                            checked={modeAStreamOutput}
                            onChange={(nextValue) =>
                              void handleToggleSetting("llm", setModeAStreamOutput, "modeAStreamOutput", nextValue)}
                            ariaLabel={t("settings.llm.modeAStreamOutput")}
                          />
                        </div>
                        <div className="flex h-10 items-center justify-between rounded-2xl border border-zinc-200 bg-white px-3">
                          <span className="pr-3 text-sm text-zinc-700">{t("settings.llm.modeBStreamOutput")}</span>
                          <SettingsToggle
                            checked={modeBStreamOutput}
                            onChange={(nextValue) =>
                              void handleToggleSetting("llm", setModeBStreamOutput, "modeBStreamOutput", nextValue)}
                            ariaLabel={t("settings.llm.modeBStreamOutput")}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-zinc-200 bg-[#fcfbf8] p-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-zinc-500">{t("settings.llm.provider")}</label>
                        <SettingsInfoHint text="切換要呼叫的 LLM 服務商，變更後立即套用。" />
                      </div>
                      <select className="settings-input-compact mt-1.5" value={llmProvider} onChange={(event) => void handleLlmProviderChange(event.target.value as typeof llmProvider)}>
                        <option value="openAi">OpenAI</option>
                        <option value="gemini">Gemini</option>
                        <option value="claude">Claude</option>
                        <option value="grok">Grok</option>
                        <option value="qwen">Qwen</option>
                        <option value="doubao">豆包 Doubao</option>
                        <option value="deepseek">DeepSeek</option>
                        <option value="ollama">{t("settings.llm.ollamaLocal")}</option>
                      </select>
                    </div>
                    <div className="rounded-[22px] border border-zinc-200 bg-[#fcfbf8] p-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-zinc-500">{t("settings.llm.model")}</label>
                        <SettingsInfoHint text={t("settings.llm.modelHint")} />
                      </div>
                      <select className="settings-input-compact mt-1.5 font-mono" value={llmModel} onChange={(event) => void handleLlmModelChange(event.target.value)}>
                        {llmModelOptions.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                      <input className="settings-input-compact mt-2 font-mono" value={llmModel} onChange={(event) => void handleLlmModelChange(event.target.value)} placeholder="gpt-4o-mini / qwen-plus / deepseek-chat" />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => void handleAddLlmModelOption()} className="btn-secondary px-3 py-2 text-xs">{t("settings.llm.modelAdd")}</button>
                        {llmModelOptions.map((model) => (
                          <button key={model} type="button" onClick={() => void handleDeleteLlmModelOption(model)} className="rounded-full bg-white px-2.5 py-1 text-[11px] text-zinc-700 hover:bg-red-100 hover:text-red-700">
                            {model} ×
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-[22px] border border-zinc-200 bg-[#f6efe1] p-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-zinc-500">{t("settings.languageVariant.label")}</label>
                        <SettingsInfoHint text={t("settings.languageVariant.summaryHint")} />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-3">
                        <p className="min-w-0 flex-1 truncate text-sm text-zinc-700">{globalLanguageVariantSummary}</p>
                        <button type="button" onClick={() => setLanguageVariantOverlay({ scope: "global" })} className="btn-secondary px-3 py-2 text-xs">
                          {t("settings.languageVariant.openButton")}
                        </button>
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-zinc-200 bg-white p-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-zinc-500">{t("settings.llm.apiKey")}</label>
                        <SettingsInfoHint text="只在按下儲存後安全送往後端，不會直接寫進前端偏好儲存。" />
                      </div>
                      {apiKeySet && <p className="mt-1 text-xs text-green-600">{t("settings.llm.apiKeySet")}</p>}
                      <div className="mt-2 flex gap-2">
                        <input type="password" className="settings-input-compact flex-1 font-mono" value={apiKeyInput} onChange={(event) => setApiKeyInput(event.target.value)} placeholder={apiKeySet ? "••••••••" : t("settings.llm.apiKeyPlaceholder")} />
                        <button type="button" onClick={handleSaveApiKey} disabled={!apiKeyInput || apiKeySaveStatus === "saving"} className="btn-primary px-4 py-2 text-sm disabled:opacity-40">
                          {apiKeySaveStatus === "saving" ? t("settings.llm.saving") : t("settings.llm.save")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              <section className="settings-stage-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-zinc-900">{t("settings.llm.modePrompts")}</h3>
                    <SettingsInfoHint text={t("settings.llm.modePromptsHint")} />
                  </div>
                  <button type="button" onClick={() => void handleSaveModePrompts()} disabled={!llmPromptDirty} className="btn-primary px-4 py-2 text-sm disabled:opacity-40">儲存</button>
                </div>
                <div className="mt-3 grid gap-3 xl:grid-cols-3">
                  {[
                    ["modeAPrompt", t("settings.llm.modeAPrompt"), t("settings.llm.modeAPromptPlaceholder")],
                    ["modeBPrompt", t("settings.llm.modeBPrompt"), t("settings.llm.modeBPromptPlaceholder")],
                    ["modeCPrompt", t("settings.llm.modeCPrompt"), t("settings.llm.modeCPromptPlaceholder")],
                  ].map(([key, label, placeholder]) => (
                    <div key={String(key)} className="rounded-[22px] border border-zinc-200 bg-[#fcfbf8] p-4">
                      <label className="text-xs font-medium text-zinc-500">{label}</label>
                      <textarea className="input-field mt-1.5 min-h-[180px] w-full px-3 py-2 text-sm leading-6" value={promptDrafts[key as keyof typeof promptDrafts]} onChange={(event) => setPromptDrafts((prev) => ({ ...prev, [key]: event.target.value }))} placeholder={String(placeholder)} />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </WorkspaceShell>
        );
      case "quickAction":
        return renderQuickActionSection();
      case "tts":
        return (
          <WorkspaceShell {...SECTION_META.tts} status={panelMessages.tts}>
            <SettingsTtsSection draftTtsPitch={ttsPitch} draftTtsRate={ttsRate} draftTtsVoice={ttsVoice} localTtsModels={localTtsModels} localTtsModelsLoading={localTtsModelsLoading} ttsModelBusyId={ttsModelBusyId} ttsModelBusyAction={ttsModelBusyAction} ttsModelDownloadProgress={ttsModelDownloadProgress} failedTtsDownloadModelId={failedTtsDownloadModelId} ttsModelStatus={ttsModelStatus} formatBytes={formatBytes} onPitchChange={(value) => void handleTtsPitchChange(value)} onRateChange={(value) => void handleTtsRateChange(value)} onVoiceChange={(value) => void handleTtsVoiceChange(value)} onInstallModel={handleInstallLocalTtsModel} onCancelDownload={handleCancelLocalTtsModelDownload} onDeleteModel={handleDeleteLocalTtsModel} onSelectModel={handleSelectLocalTtsModel} t={t} />
          </WorkspaceShell>
        );
      case "appProfile":
        return renderAppProfileSection();
      case "history":
        return (
          <WorkspaceShell {...SECTION_META.history} status={panelMessages.history}>
            <SettingsHistorySection draftHistoryEnabled={historyEnabled} draftPreferenceLearningEnabled={preferenceLearningEnabled} onToggleHistory={() => void handleToggleSetting("history", setHistoryEnabled, "historyEnabled", !historyEnabled)} onTogglePreferenceLearning={() => void handleToggleSetting("history", setPreferenceLearningEnabled, "preferenceLearningEnabled", !preferenceLearningEnabled)} t={t} />
          </WorkspaceShell>
        );
      default:
        return null;
    }
  };

  return (
    <div className="relative h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(250,240,220,0.94),_rgba(243,244,246,1)_40%,_rgba(232,238,245,1)_100%)] text-zinc-900" style={{ fontFamily: "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif" }}>
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.52),transparent_35%,rgba(255,255,255,0.24)_100%)]" />
      <div className="relative z-10 flex h-full min-h-0 flex-col px-4 py-4">
        <div className="grid h-full min-h-0 flex-1 gap-4 overflow-hidden grid-cols-[220px_minmax(0,1fr)]">
          <aside className="h-full min-h-0">
            <SettingsSidebar activeSection={activeSection} navItems={NAV_ITEMS} onSelectSection={setActiveSection} sectionLabelKey={SECTION_LABEL_KEYS} t={t} />
          </aside>
          <main className="relative flex h-full min-h-0 overflow-hidden">
            {renderSection()}
            {activeProfile && activeProfilePromptDraft && (
              <SettingsAppProfileEditorOverlay
                profile={activeProfile}
                customLanguageVariants={customLanguageVariants}
                promptDraft={activeProfilePromptDraft}
                onClose={() => setActiveProfileOverlayId(null)}
                onDelete={() => handleDeleteProfile(activeProfile.id)}
                onImmediateChange={(patch) => handleImmediateProfileChange(activeProfile.id, patch)}
                onPromptDraftChange={(patch) => handleProfilePromptDraftChange(activeProfile.id, patch)}
                onSavePromptFields={() => handleSaveProfilePrompts(activeProfile.id)}
                onOpenLanguageVariantPicker={() => setLanguageVariantOverlay({ scope: "profile", profileId: activeProfile.id })}
                t={t}
              />
            )}
            {languageVariantOverlay && (
              <SettingsLanguageVariantOverlay
                scope={languageVariantOverlay.scope}
                profileId={languageVariantOverlay.profileId}
                preferences={
                  languageVariantOverlay.scope === "global"
                    ? preferredLanguage
                    : mergeLanguageVariantPreferences(
                        preferredLanguage,
                        appProfiles.find((profile) => profile.id === languageVariantOverlay.profileId)?.preferredLanguage ?? "",
                        customLanguageVariants,
                      )
                }
                globalPreferences={preferredLanguage}
                customVariants={customLanguageVariants}
                useGlobalByDefault={
                  languageVariantOverlay.scope === "profile"
                    ? !appProfiles.find((profile) => profile.id === languageVariantOverlay.profileId)?.preferredLanguage
                    : false
                }
                onApply={handleApplyLanguageVariantSelection}
                onClose={() => setLanguageVariantOverlay(null)}
                t={t}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
