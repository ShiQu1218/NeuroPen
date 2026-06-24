import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { translate, useI18n, type TranslationKey } from "../i18n";
import { settingsService } from "../services/settingsService";
import {
  normalizeLlmModelOptions,
  useAppStore,
  type AppLanguage,
  type AppProfile,
  type CustomLanguageVariant,
  type LlmProvider,
  type PreferredLanguage,
  type QuickActionCommand,
  type ThemePreference,
  type TranslationTarget,
} from "../store/useAppStore";
import {
  getDefaultLlmModel,
  getDefaultLlmModelOptions,
  isLocalRuntimeLlmProvider,
} from "../store/appStoreDefaults";
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
import {
  DEFAULT_MODE_A_PROMPT,
  DEFAULT_MODE_B_PROMPT,
  DEFAULT_MODE_C_PROMPT,
} from "../store/appStoreTypes";

type PanelTone = "" | "success" | "error";

interface PanelMessage {
  tone: PanelTone;
  message: string;
}

interface AppProfilePromptDraft {
  toneHint: string;
  promptAppendix: string;
}

interface AppProfileTextDraft {
  name: string;
}

interface SttTextDrafts {
  wakeWord: string;
  vocabularyTerms: string;
}

interface TtsTextDrafts {
  voice: string;
  rate: string;
  pitch: string;
}

const EMPTY_PANEL_MESSAGE: PanelMessage = { tone: "", message: "" };
const EMPTY_BUSY_MESSAGE = { type: "" as const, message: "" };
const DEFAULT_MODE_PROMPTS = {
  modeAPrompt: DEFAULT_MODE_A_PROMPT,
  modeBPrompt: DEFAULT_MODE_B_PROMPT,
  modeCPrompt: DEFAULT_MODE_C_PROMPT,
} as const;
type ModePromptDraftKey = keyof typeof DEFAULT_MODE_PROMPTS;
const MODE_PROMPT_FIELDS: ReadonlyArray<{
  key: ModePromptDraftKey;
  labelKey: TranslationKey;
  placeholderKey: TranslationKey;
}> = [
  {
    key: "modeAPrompt",
    labelKey: "settings.llm.modeAPrompt",
    placeholderKey: "settings.llm.modeAPromptPlaceholder",
  },
  {
    key: "modeBPrompt",
    labelKey: "settings.llm.modeBPrompt",
    placeholderKey: "settings.llm.modeBPromptPlaceholder",
  },
  {
    key: "modeCPrompt",
    labelKey: "settings.llm.modeCPrompt",
    placeholderKey: "settings.llm.modeCPromptPlaceholder",
  },
];

const normalizeRuntimeModelCatalog = (models: string[]) =>
  Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));

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

const UI_LANGUAGE_OPTIONS: AppLanguage[] = [
  "zh-TW",
  "en-US",
  "ja-JP",
  "es-ES",
  "ko-KR",
  "zh-CN",
  "de-DE",
  "fr-FR",
  "ar-SA",
  "ru-RU",
];

const THEME_PREFERENCE_OPTIONS: ThemePreference[] = ["light", "dark", "system"];

const createDefaultProfile = (name: string): AppProfile => ({
  id: `custom-${Date.now()}`,
  name,
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
        status.tone === "error"
          ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200"
          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200"
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
  const { t, language } = useI18n();
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
    llmModelOptionsByProvider,
    llmSelectedModelByProvider,
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
    setLanguage,
    themePreference, setThemePreference,
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
  const [profilePromptDrafts, setProfilePromptDrafts] = useState<Record<string, AppProfilePromptDraft>>(() =>
    Object.fromEntries(appProfiles.map((p) => [p.id, { toneHint: p.toneHint, promptAppendix: p.promptAppendix }]))
  );
  const [profileTextDrafts, setProfileTextDrafts] = useState<Record<string, AppProfileTextDraft>>(() =>
    Object.fromEntries(appProfiles.map((p) => [p.id, { name: p.name }]))
  );
  const [sttTextDrafts, setSttTextDrafts] = useState<SttTextDrafts>({
    wakeWord,
    vocabularyTerms: vocabularyTerms.join("\n"),
  });
  const [llmModelsLoading, setLlmModelsLoading] = useState(false);
  const [llmModelDraft, setLlmModelDraft] = useState(llmModel);
  const [quickActionDraftCommands, setQuickActionDraftCommands] = useState<QuickActionCommand[]>(quickActionCommands);
  const [ttsTextDrafts, setTtsTextDrafts] = useState<TtsTextDrafts>({
    voice: ttsVoice,
    rate: ttsRate,
    pitch: ttsPitch,
  });
  const [activeProfileOverlayId, setActiveProfileOverlayId] = useState<string | null>(null);
  const [languageVariantOverlay, setLanguageVariantOverlay] = useState<{ scope: "global" | "profile"; profileId?: string } | null>(null);

  const initialLocalLlmCatalogSyncedRef = useRef(false);
  const statusTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});
  const sectionMeta = useMemo(
    () =>
      Object.fromEntries(
        (Object.entries(SECTION_LABEL_KEYS) as Array<[SettingsSection, TranslationKey]>).map(([section, key]) => [
          section,
          { title: t(key) },
        ]),
      ) as Record<SettingsSection, { title: string }>,
    [t],
  );

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

  const applyResolvedLlmProviderState = useCallback(async (
    provider: LlmProvider,
    nextModel: string,
    nextOptions: string[],
  ) => {
    setLlmProvider(provider);
    setLlmModel(nextModel);
    setLlmModelOptions(nextOptions);
    setLlmModelDraft(nextModel);
    await broadcastSettingsSaved({
      llmProvider: provider,
      llmModel: nextModel,
      llmModelOptions: nextOptions,
    });
  }, [broadcastSettingsSaved, setLlmModel, setLlmModelOptions, setLlmProvider]);

  const resolveProviderModelState = useCallback(async (
    provider: LlmProvider,
    preferredModel?: string,
  ) => {
    const rememberedModel = llmSelectedModelByProvider[provider]?.trim() ?? "";
    const requestedModel = preferredModel?.trim() || rememberedModel;
    if (isLocalRuntimeLlmProvider(provider)) {
      const fallbackModel = getDefaultLlmModel(provider);
      const fallbackOptions = normalizeRuntimeModelCatalog([fallbackModel]);
      setLlmModelsLoading(true);
      try {
        const discoveredModels = normalizeRuntimeModelCatalog(
          await settingsService.listAvailableLlmModels(provider)
        );
        const nextOptions = discoveredModels.length > 0 ? discoveredModels : fallbackOptions;
        const trimmedPreferredModel = requestedModel;
        const nextModel =
          trimmedPreferredModel && nextOptions.includes(trimmedPreferredModel)
            ? trimmedPreferredModel
            : nextOptions[0] ?? fallbackModel;
        return { nextModel, nextOptions };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setPanelMessage("llm", "error", reason || t("settings.saveError"));
        const retainedModel = requestedModel || fallbackModel;
        return {
          nextModel: retainedModel,
          nextOptions: normalizeRuntimeModelCatalog([retainedModel, ...fallbackOptions]),
        };
      } finally {
        setLlmModelsLoading(false);
      }
    }

    const nextModel = requestedModel || getDefaultLlmModel(provider);
    const nextOptions = normalizeLlmModelOptions(
      llmModelOptionsByProvider[provider] ?? getDefaultLlmModelOptions(provider),
      nextModel,
    );
    return { nextModel, nextOptions };
  }, [llmModelOptionsByProvider, llmSelectedModelByProvider, setPanelMessage, t]);

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

  const activeProfileTextDraft = activeProfile
    ? profileTextDrafts[activeProfile.id] ?? {
        name: activeProfile.name,
      }
    : null;

  const llmPromptDirty =
    promptDrafts.modeAPrompt !== modeAPrompt ||
    promptDrafts.modeBPrompt !== modeBPrompt ||
    promptDrafts.modeCPrompt !== modeCPrompt;
  const localLlmProviderSelected = isLocalRuntimeLlmProvider(llmProvider);

  const wakeWordDirty = sttTextDrafts.wakeWord !== wakeWord;
  const vocabularyDirty = sttTextDrafts.vocabularyTerms !== vocabularyTerms.join("\n");
  const llmModelDraftDirty = Boolean(
    llmModelDraft.trim() && (
      llmModelDraft.trim() !== llmModel ||
      !llmModelOptions.includes(llmModelDraft.trim())
    ),
  );
  const quickActionDraftDirty =
    JSON.stringify(quickActionDraftCommands) !== JSON.stringify(quickActionCommands);
  const ttsTextDraftDirty =
    ttsTextDrafts.voice !== ttsVoice ||
    ttsTextDrafts.rate !== ttsRate ||
    ttsTextDrafts.pitch !== ttsPitch;

  const globalLanguageVariantSummary = useMemo(
    () =>
      getLanguageVariantSelectionSummary(preferredLanguage, customLanguageVariants, {
        emptyLabel: t("settings.preferredLanguage.auto"),
        countLabel: (count) => t("settings.languageVariant.profileSummary", { count: String(count) }),
      }),
    [customLanguageVariants, preferredLanguage, t],
  );

  const getLocalizedSttModelName = useCallback(
    (model: LocalSttModel) => {
      const key = `settings.stt.model.${model.id}.name` as TranslationKey;
      const localized = t(key);
      return localized === key ? model.name : localized;
    },
    [t],
  );

  const getLocalizedSttModelDescription = useCallback(
    (model: LocalSttModel) => {
      const key = `settings.stt.model.${model.id}.description` as TranslationKey;
      const localized = t(key);
      return localized === key ? model.description : localized;
    },
    [t],
  );

  const getLocalizedTtsModelName = useCallback(
    (model: LocalTtsModel) => {
      const key = `settings.tts.model.${model.id}.name` as TranslationKey;
      const localized = t(key);
      return localized === key ? model.name : localized;
    },
    [t],
  );

  const getLocalizedTtsModelDescription = useCallback(
    (model: LocalTtsModel) => {
      const key = `settings.tts.model.${model.id}.description` as TranslationKey;
      const localized = t(key);
      return localized === key ? model.description : localized;
    },
    [t],
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
    if (initialLocalLlmCatalogSyncedRef.current) {
      return;
    }
    initialLocalLlmCatalogSyncedRef.current = true;
    if (!isLocalRuntimeLlmProvider(llmProvider)) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const { nextModel, nextOptions } = await resolveProviderModelState(llmProvider, llmModel);
      if (cancelled) {
        return;
      }
      if (
        nextModel === llmModel &&
        nextOptions.length === llmModelOptions.length &&
        nextOptions.every((modelOption, index) => modelOption === llmModelOptions[index])
      ) {
        return;
      }
      await applyResolvedLlmProviderState(llmProvider, nextModel, nextOptions);
    })();

    return () => {
      cancelled = true;
    };
  }, [applyResolvedLlmProviderState, llmModel, llmModelOptions, llmProvider, resolveProviderModelState]);

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

  const handleSaveWakeWord = useCallback(async () => {
    const nextWakeWord = sttTextDrafts.wakeWord.trim();
    if (!nextWakeWord) {
      setPanelMessage("stt", "error", t("settings.status.wakeWordRequired"));
      return;
    }
    setWakeWord(nextWakeWord);
    setSttTextDrafts((prev) => ({ ...prev, wakeWord: nextWakeWord }));
    await broadcastSettingsSaved({ wakeWord: nextWakeWord });
    setPanelMessage("stt", "success", t("settings.saveApplied"));
  }, [broadcastSettingsSaved, setPanelMessage, setWakeWord, sttTextDrafts.wakeWord, t]);

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

  const handleLanguageChange = useCallback(async (value: AppLanguage) => {
    if (value === language) {
      return;
    }
    setLanguage(value);
    await broadcastSettingsSaved({ language: value });
    setPanelMessage("general", "success", translate(value, "settings.saveApplied"));
  }, [broadcastSettingsSaved, language, setLanguage, setPanelMessage]);

  const handleThemePreferenceChange = useCallback(async (value: ThemePreference) => {
    if (value === themePreference) {
      return;
    }
    setThemePreference(value);
    await broadcastSettingsSaved({ themePreference: value });
    setPanelMessage("general", "success", t("settings.saveApplied"));
  }, [broadcastSettingsSaved, setPanelMessage, setThemePreference, t, themePreference]);

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

  const handleSaveVocabularyTerms = useCallback(async () => {
    const nextVocabularyTerms = sttTextDrafts.vocabularyTerms
      .split(/\r?\n|,/)
      .map((term) => term.trim())
      .filter(Boolean);
    setVocabularyTerms(nextVocabularyTerms);
    setSttTextDrafts((prev) => ({
      ...prev,
      vocabularyTerms: nextVocabularyTerms.join("\n"),
    }));
    await broadcastSettingsSaved({ vocabularyTerms: nextVocabularyTerms });
    setPanelMessage("stt", "success", t("settings.saveApplied"));
  }, [broadcastSettingsSaved, setPanelMessage, setVocabularyTerms, sttTextDrafts.vocabularyTerms, t]);

  const handleImportVocabularyFile = useCallback(async (file: File | null) => {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const imported = text.split(/\r?\n|,/).map((term) => term.trim()).filter(Boolean);
      const currentDraftTerms = sttTextDrafts.vocabularyTerms
        .split(/\r?\n|,/)
        .map((term) => term.trim())
        .filter(Boolean);
      const merged = Array.from(new Set([...currentDraftTerms, ...imported]));
      setSttTextDrafts((prev) => ({
        ...prev,
        vocabularyTerms: merged.join("\n"),
      }));
      setPanelMessage("stt", "success", t("settings.stt.vocabularyImported"));
    } catch (error) {
      console.error("[Settings] import vocabulary failed:", error);
      setPanelMessage("stt", "error", t("settings.stt.vocabularyImportFailed"));
    }
  }, [setPanelMessage, sttTextDrafts.vocabularyTerms, t]);

  const handleLlmProviderChange = useCallback(async (value: typeof llmProvider) => {
    const { nextModel, nextOptions } = await resolveProviderModelState(
      value,
      llmSelectedModelByProvider[value],
    );
    await applyResolvedLlmProviderState(value, nextModel, nextOptions);
  }, [applyResolvedLlmProviderState, llmSelectedModelByProvider, resolveProviderModelState]);

  const localLlmProviderNoKeyHint =
    llmProvider === "ollama"
      ? t("settings.llm.ollamaNoKey")
      : llmProvider === "llamaCpp"
        ? t("settings.llm.llamaCppNoKey")
        : llmProvider === "lmStudio"
          ? t("settings.llm.lmStudioNoKey")
        : "";

  const handleLlmModelChange = useCallback(async (value: string) => {
    const nextValue = value.trim();
    if (!nextValue) {
      return;
    }
    setLlmModel(nextValue);
    setLlmModelDraft(nextValue);
    await broadcastSettingsSaved({ llmModel: nextValue, llmModelOptions });
  }, [broadcastSettingsSaved, llmModelOptions, setLlmModel]);

  const handleAddLlmModelOption = useCallback(async () => {
    if (localLlmProviderSelected) {
      return;
    }
    const nextValue = llmModelDraft.trim();
    if (!nextValue) {
      return;
    }
    const nextOptions = normalizeLlmModelOptions(llmModelOptions, nextValue);
    setLlmModel(nextValue);
    setLlmModelOptions(nextOptions);
    setLlmModelDraft(nextValue);
    await broadcastSettingsSaved({ llmModelOptions: nextOptions, llmModel: nextValue });
    setPanelMessage("llm", "success", t("settings.saveApplied"));
  }, [broadcastSettingsSaved, llmModelDraft, llmModelOptions, localLlmProviderSelected, setLlmModel, setLlmModelOptions, setPanelMessage, t]);

  const handleDeleteLlmModelOption = useCallback(async (modelToDelete: string) => {
    if (localLlmProviderSelected) {
      return;
    }
    const remainingModels = llmModelOptions.filter((model) => model !== modelToDelete);
    const fallbackModel = remainingModels[0] ?? llmModel;
    const nextOptions = normalizeLlmModelOptions(remainingModels, fallbackModel);
    setLlmModelOptions(nextOptions);
    if (llmModel === modelToDelete && fallbackModel.trim()) {
      setLlmModel(fallbackModel.trim());
      setLlmModelDraft(fallbackModel.trim());
    }
    await broadcastSettingsSaved({
      llmModel: llmModel === modelToDelete ? fallbackModel.trim() || llmModel : llmModel,
      llmModelOptions: nextOptions,
    });
  }, [broadcastSettingsSaved, llmModel, llmModelOptions, localLlmProviderSelected, setLlmModel, setLlmModelDraft, setLlmModelOptions]);

  const handleOutputModeChange = useCallback(async (value: typeof outputMode) => {
    setOutputMode(value);
    await broadcastSettingsSaved({ outputMode: value });
  }, [broadcastSettingsSaved, setOutputMode]);

  const commitQuickActionCommands = useCallback(async (nextCommands: QuickActionCommand[]) => {
    setQuickActionCommands(nextCommands);
    await broadcastSettingsSaved({ quickActionCommands: nextCommands });
  }, [broadcastSettingsSaved, setQuickActionCommands]);

  const handleAddQuickActionCommand = useCallback(() => {
    setQuickActionDraftCommands([
      ...quickActionDraftCommands,
      { id: `custom-${Date.now()}`, label: t("settings.quickAction.newCommand"), instruction: "" },
    ]);
  }, [quickActionDraftCommands, t]);

  const handleUpdateQuickActionCommand = useCallback((commandId: string, field: "label" | "instruction", value: string) => {
    setQuickActionDraftCommands(
      quickActionDraftCommands.map((command) =>
        command.id === commandId ? { ...command, [field]: value } : command,
      ),
    );
  }, [quickActionDraftCommands]);

  const handleDeleteQuickActionCommand = useCallback((commandId: string) => {
    setQuickActionDraftCommands(quickActionDraftCommands.filter((command) => command.id !== commandId));
  }, [quickActionDraftCommands]);

  const handleMoveQuickActionCommand = useCallback((commandId: string, direction: "up" | "down") => {
    const index = quickActionDraftCommands.findIndex((command) => command.id === commandId);
    if (index < 0) {
      return;
    }
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= quickActionDraftCommands.length) {
      return;
    }
    const nextCommands = [...quickActionDraftCommands];
    const [movedCommand] = nextCommands.splice(index, 1);
    nextCommands.splice(targetIndex, 0, movedCommand);
    setQuickActionDraftCommands(nextCommands);
  }, [quickActionDraftCommands]);

  const handleSaveQuickActionCommands = useCallback(async () => {
    if (quickActionDraftCommands.length === 0) {
      setPanelMessage("quickAction", "error", t("settings.quickAction.requireOne"));
      return;
    }
    await commitQuickActionCommands(quickActionDraftCommands);
    setPanelMessage("quickAction", "success", t("settings.saveApplied"));
  }, [commitQuickActionCommands, quickActionDraftCommands, setPanelMessage, t]);

  const handleSaveTtsTextSettings = useCallback(async () => {
    const nextVoice = ttsTextDrafts.voice.trim();
    const nextRate = ttsTextDrafts.rate.trim();
    const nextPitch = ttsTextDrafts.pitch.trim();
    setTtsVoice(nextVoice);
    setTtsRate(nextRate);
    setTtsPitch(nextPitch);
    setTtsTextDrafts({
      voice: nextVoice,
      rate: nextRate,
      pitch: nextPitch,
    });
    await broadcastSettingsSaved({
      ttsVoice: nextVoice,
      ttsRate: nextRate,
      ttsPitch: nextPitch,
    });
    setPanelMessage("tts", "success", t("settings.saveApplied"));
  }, [broadcastSettingsSaved, setPanelMessage, setTtsPitch, setTtsRate, setTtsVoice, t, ttsTextDrafts]);

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
        setTtsTextDrafts((prev) => ({ ...prev, voice: modelPath }));
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
          setTtsTextDrafts((prev) => ({ ...prev, voice: "" }));
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
      setPanelMessage("llm", "error", t("settings.status.modePromptRequired"));
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
    setPanelMessage("llm", "success", t("settings.status.modePromptSaved"));
  }, [broadcastSettingsSaved, promptDrafts, setModeAPrompt, setModeBPrompt, setModeCPrompt, setPanelMessage, t]);

  const handleResetModePromptDraft = useCallback((key: ModePromptDraftKey) => {
    setPromptDrafts((prev) => {
      const nextValue = DEFAULT_MODE_PROMPTS[key];
      if (prev[key] === nextValue) {
        return prev;
      }
      return {
        ...prev,
        [key]: nextValue,
      };
    });
  }, []);

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
    const newProfile = createDefaultProfile(
      t("settings.appProfile.defaultName", { index: String(appProfiles.length + 1) }),
    );
    void updateProfiles([...appProfiles, newProfile], { message: t("settings.status.profileAdded") });
    setActiveProfileOverlayId(newProfile.id);
  }, [appProfiles, t, updateProfiles]);

  const handleDeleteProfile = useCallback((profileId: string) => {
    void updateProfiles(appProfiles.filter((profile) => profile.id !== profileId), {
      message: t("settings.status.profileDeleted"),
    });
    setProfilePromptDrafts((prev) => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
    if (activeProfileOverlayId === profileId) {
      setActiveProfileOverlayId(null);
    }
  }, [activeProfileOverlayId, appProfiles, t, updateProfiles]);

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

  const handleProfileTextDraftChange = useCallback((profileId: string, patch: Partial<AppProfileTextDraft>) => {
    setProfileTextDrafts((prev) => ({
      ...prev,
      [profileId]: {
        name: patch.name ?? prev[profileId]?.name ?? "",
      },
    }));
  }, []);

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
    const profileForFallback = appProfiles.find((p) => p.id === profileId);
    if (!profileForFallback) return;
    const promptDraft = profilePromptDrafts[profileId] ?? {
      toneHint: profileForFallback.toneHint,
      promptAppendix: profileForFallback.promptAppendix,
    };
    const nextProfiles = appProfiles.map((profile) =>
      profile.id === profileId
        ? { ...profile, toneHint: promptDraft.toneHint, promptAppendix: promptDraft.promptAppendix }
        : profile,
    );
    setAppProfiles(nextProfiles);
    await broadcastSettingsSaved({ appProfiles: nextProfiles });
    setPanelMessage("appProfile", "success", t("settings.status.profilePromptSaved"));
  }, [appProfiles, broadcastSettingsSaved, profilePromptDrafts, setAppProfiles, setPanelMessage, t]);

  const handleSaveProfileTextFields = useCallback(async (profileId: string) => {
    const profileForFallback = appProfiles.find((p) => p.id === profileId);
    if (!profileForFallback) return;
    const textDraft = profileTextDrafts[profileId] ?? { name: profileForFallback.name };
    const nextName = textDraft.name.trim();
    setProfileTextDrafts((prev) => ({
      ...prev,
      [profileId]: {
        name: nextName,
      },
    }));
    await updateProfiles(
      appProfiles.map((profile) =>
        profile.id === profileId ? { ...profile, name: nextName } : profile,
      ),
      { message: t("settings.saveApplied") },
    );
  }, [appProfiles, profileTextDrafts, t, updateProfiles]);

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
      setPanelMessage("llm", "success", t("settings.status.languageVariantApplied"));
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
    setPanelMessage("appProfile", "success", t("settings.status.profileLanguageVariantApplied"));
  }, [
    appProfiles,
    broadcastSettingsSaved,
    preferredLanguage,
    setCustomLanguageVariants,
    setPanelMessage,
    setPreferredLanguage,
    t,
    updateProfiles,
  ]);

  const renderGeneralSection = () => (
    <WorkspaceShell {...sectionMeta.general} status={panelMessages.general}>
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <section className="settings-stage-card p-4">
            <div className="grid gap-3 lg:grid-cols-2">
              {[
                [
                  "settings.feature.stt",
                  "settings.general.feature.sttHint",
                  sttEnabled,
                  setSttEnabled,
                  "sttEnabled",
                ],
                [
                  "settings.feature.selection",
                  "settings.general.feature.selectionHint",
                  selectionEnabled,
                  setSelectionEnabled,
                  "selectionEnabled",
                ],
                [
                  "settings.feature.screenshot",
                  "settings.general.feature.screenshotHint",
                  screenshotEnabled,
                  setScreenshotEnabled,
                  "screenshotEnabled",
                ],
              ].map(([labelKey, hintKey, enabled, setter, payloadKey]) => (
                <div
                  key={String(labelKey)}
                  className="flex min-h-[52px] items-center justify-between rounded-2xl border border-zinc-200 bg-white px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2 pr-3">
                    <span className="truncate text-sm font-medium text-zinc-800">{t(labelKey as TranslationKey)}</span>
                    <SettingsInfoHint text={t(hintKey as TranslationKey)} />
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
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("settings.theme.label")}</label>
                  <SettingsInfoHint text={t("settings.theme.hint")} />
                </div>
                <select
                  className="settings-input-compact mt-1.5"
                  value={themePreference}
                  onChange={(event) => void handleThemePreferenceChange(event.target.value as ThemePreference)}
                  aria-label={t("settings.theme.label")}
                >
                  {THEME_PREFERENCE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`settings.theme.${option}` as TranslationKey)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("settings.language.label")}</label>
                  <SettingsInfoHint text={t("settings.language.hint")} />
                </div>
                <select
                  className="settings-input-compact mt-1.5"
                  value={language}
                  onChange={(event) => void handleLanguageChange(event.target.value as AppLanguage)}
                  aria-label={t("settings.language.label")}
                >
                  {UI_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`settings.language.${option}` as TranslationKey)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        </div>
        <section className="settings-stage-card p-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-zinc-900">{sectionMeta.shortcuts.title}</h3>
            <SettingsInfoHint text={t("settings.general.shortcutsHint")} />
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
    <WorkspaceShell {...sectionMeta.quickAction} status={panelMessages.quickAction}>
      <section className="settings-stage-card p-4">
        <SettingsQuickActionSection
          commands={quickActionDraftCommands}
          commandsDirty={quickActionDraftDirty}
          onAdd={handleAddQuickActionCommand}
          onDelete={handleDeleteQuickActionCommand}
          onMove={handleMoveQuickActionCommand}
          onUpdate={handleUpdateQuickActionCommand}
          onSave={handleSaveQuickActionCommands}
          t={t}
        />
      </section>
    </WorkspaceShell>
  );

  const renderAppProfileSection = () => (
    <WorkspaceShell {...sectionMeta.appProfile} status={panelMessages.appProfile}>
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
            <h3 className="text-sm font-medium text-zinc-900">{t("settings.appProfile.listTitle")}</h3>
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
                      {profile.keywords.length > 0 ? profile.keywords.join("、") : t("settings.appProfile.noKeywords")}
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
                    <span className="text-xs text-zinc-500">{t("settings.appProfile.enabled")}</span>
                    <SettingsToggle
                      checked={profile.enabled}
                      disabled={!contextAwareTone}
                      onChange={(nextValue) => handleImmediateProfileChange(profile.id, { enabled: nextValue })}
                      ariaLabel={profile.name || t("settings.appProfile.namePlaceholder")}
                    />
                  </div>
                  <button type="button" onClick={() => setActiveProfileOverlayId(profile.id)} disabled={!contextAwareTone} className="btn-primary px-4 py-2 text-sm disabled:opacity-40">
                    {t("settings.appProfile.edit")}
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
          <WorkspaceShell {...sectionMeta.stt} status={panelMessages.stt}>
            <SettingsSttSection
              draftWakeWord={sttTextDrafts.wakeWord}
              wakeWordDirty={wakeWordDirty}
              draftSttEnabled={sttEnabled}
              draftSttModelChoice={currentSttModelChoice}
              draftSttLanguage={sttLanguage}
              draftMicrophoneSource={microphoneSource}
              draftTranslationTarget={translationTarget}
              draftSttOutputStrategy={sttOutputStrategy}
              draftPunctuationMode={punctuationMode}
              draftVocabularyTerms={sttTextDrafts.vocabularyTerms}
              vocabularyDirty={vocabularyDirty}
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
              getLocalizedModelName={getLocalizedSttModelName}
              getLocalizedModelDescription={getLocalizedSttModelDescription}
              onWakeWordDraftChange={(value) =>
                setSttTextDrafts((prev) => ({ ...prev, wakeWord: value }))
              }
              onSaveWakeWord={handleSaveWakeWord}
              onSttModelChoiceChange={(value) => void handleSttModelChoiceChange(value)}
              onSttLanguageChange={(value) => void handleSttLanguageChange(value)}
              onMicrophoneSourceChange={(value) => void handleMicrophoneSourceChange(value)}
              onSttApiKeyInputChange={setSttApiKeyInput}
              onSaveSttApiKey={handleSaveSttApiKey}
              onSttOutputStrategyChange={(value) => void handleSttOutputStrategyChange(value)}
              onTranslationTargetChange={(value) => void handleTranslationTargetChange(value)}
              onPunctuationModeChange={(value) => void handlePunctuationModeChange(value)}
              onVocabularyTermsDraftChange={(value) =>
                setSttTextDrafts((prev) => ({ ...prev, vocabularyTerms: value }))
              }
              onSaveVocabularyTerms={handleSaveVocabularyTerms}
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
          <WorkspaceShell {...sectionMeta.llm} status={panelMessages.llm}>
            <div className="space-y-4">
              <section className="settings-stage-card p-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-[22px] border border-zinc-200 bg-[#fcfbf8] p-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-zinc-500">{t("settings.llm.outputMode")}</label>
                        <SettingsInfoHint text={t("settings.llm.outputModeHint")} />
                      </div>
                      <div className="mt-2 grid gap-2">
                        {(["PreviewStream", "DirectInject"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => void handleOutputModeChange(mode)}
                            className={`flex h-10 items-center justify-between rounded-2xl px-3 text-sm font-medium ${
                              outputMode === mode
                                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-950"
                                : "border border-zinc-200 bg-white text-zinc-700"
                            }`}
                          >
                            <span>{mode === "PreviewStream" ? t("settings.llm.previewStream") : t("settings.llm.directInject")}</span>
                            <span className="text-xs">{outputMode === mode ? t("settings.llm.status.active") : t("settings.llm.status.switch")}</span>
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
                        <SettingsInfoHint text={t("settings.llm.providerHint")} />
                      </div>
                      <select className="settings-input-compact mt-1.5" value={llmProvider} onChange={(event) => void handleLlmProviderChange(event.target.value as typeof llmProvider)}>
                        <option value="openAi">OpenAI</option>
                        <option value="gemini">Gemini</option>
                        <option value="claude">Claude</option>
                        <option value="grok">Grok</option>
                        <option value="openRouter">OpenRouter</option>
                        <option value="qwen">Qwen</option>
                        <option value="doubao">豆包 Doubao</option>
                        <option value="deepseek">DeepSeek</option>
                        <option value="ollama">{t("settings.llm.ollamaLocal")}</option>
                        <option value="llamaCpp">{t("settings.llm.llamaCppLocal")}</option>
                        <option value="lmStudio">{t("settings.llm.lmStudioLocal")}</option>
                      </select>
                    </div>
                    <div className="rounded-[22px] border border-zinc-200 bg-[#fcfbf8] p-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-zinc-500">{t("settings.llm.model")}</label>
                        <SettingsInfoHint text={t("settings.llm.modelHint")} />
                      </div>
                      <select
                        className="settings-input-compact mt-1.5 font-mono"
                        value={llmModel}
                        onChange={(event) => void handleLlmModelChange(event.target.value)}
                        disabled={llmModelsLoading}
                      >
                        {llmModelOptions.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                      {!localLlmProviderSelected && (
                        <>
                          <input
                            className="settings-input-compact mt-2 font-mono"
                            value={llmModelDraft}
                            onChange={(event) => setLlmModelDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && llmModelDraftDirty) {
                                event.preventDefault();
                                void handleAddLlmModelOption();
                              }
                            }}
                            placeholder="gpt-4o-mini / openai/gpt-4o-mini / deepseek-chat"
                          />
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => void handleAddLlmModelOption()} disabled={!llmModelDraftDirty} className="btn-secondary px-3 py-2 text-xs disabled:opacity-40">{t("settings.llm.modelAdd")}</button>
                            {llmModelOptions.map((model) => (
                              <button key={model} type="button" onClick={() => void handleDeleteLlmModelOption(model)} className="rounded-full bg-white px-2.5 py-1 text-[11px] text-zinc-700 hover:bg-red-100 hover:text-red-700">
                                {model} ×
                              </button>
                            ))}
                          </div>
                        </>
                      )}
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
                        <SettingsInfoHint text={t("settings.llm.apiKeyHint")} />
                      </div>
                      {localLlmProviderNoKeyHint && <p className="mt-1 text-xs text-zinc-500">{localLlmProviderNoKeyHint}</p>}
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
                  <button type="button" onClick={() => void handleSaveModePrompts()} disabled={!llmPromptDirty} className="btn-primary px-4 py-2 text-sm disabled:opacity-40">{t("settings.save")}</button>
                </div>
                <div className="mt-3 grid gap-3 xl:grid-cols-3">
                  {MODE_PROMPT_FIELDS.map(({ key, labelKey, placeholderKey }) => (
                    <div key={key} className="rounded-[22px] border border-zinc-200 bg-[#fcfbf8] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <label className="text-xs font-medium text-zinc-500">{t(labelKey)}</label>
                        <button
                          type="button"
                          onClick={() => handleResetModePromptDraft(key)}
                          disabled={promptDrafts[key] === DEFAULT_MODE_PROMPTS[key]}
                          className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
                        >
                          {t("settings.appProfile.resetDefaults")}
                        </button>
                      </div>
                      <textarea
                        className="input-field mt-1.5 min-h-[180px] w-full px-3 py-2 text-sm leading-6"
                        value={promptDrafts[key]}
                        onChange={(event) =>
                          setPromptDrafts((prev) => ({ ...prev, [key]: event.target.value }))
                        }
                        placeholder={t(placeholderKey)}
                      />
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
          <WorkspaceShell {...sectionMeta.tts} status={panelMessages.tts}>
            <SettingsTtsSection draftTtsPitch={ttsTextDrafts.pitch} draftTtsRate={ttsTextDrafts.rate} draftTtsVoice={ttsTextDrafts.voice} localTtsModels={localTtsModels} localTtsModelsLoading={localTtsModelsLoading} ttsModelBusyId={ttsModelBusyId} ttsModelBusyAction={ttsModelBusyAction} ttsModelDownloadProgress={ttsModelDownloadProgress} failedTtsDownloadModelId={failedTtsDownloadModelId} ttsModelStatus={ttsModelStatus} formatBytes={formatBytes} getLocalizedModelName={getLocalizedTtsModelName} getLocalizedModelDescription={getLocalizedTtsModelDescription} onPitchChange={(value) => setTtsTextDrafts((prev) => ({ ...prev, pitch: value }))} onRateChange={(value) => setTtsTextDrafts((prev) => ({ ...prev, rate: value }))} onVoiceChange={(value) => setTtsTextDrafts((prev) => ({ ...prev, voice: value }))} onSaveTextSettings={handleSaveTtsTextSettings} textSettingsDirty={ttsTextDraftDirty} onInstallModel={handleInstallLocalTtsModel} onCancelDownload={handleCancelLocalTtsModelDownload} onDeleteModel={handleDeleteLocalTtsModel} onSelectModel={handleSelectLocalTtsModel} t={t} />
          </WorkspaceShell>
        );
      case "appProfile":
        return renderAppProfileSection();
      case "history":
        return (
          <WorkspaceShell {...sectionMeta.history} status={panelMessages.history}>
            <SettingsHistorySection draftHistoryEnabled={historyEnabled} draftPreferenceLearningEnabled={preferenceLearningEnabled} onToggleHistory={() => void handleToggleSetting("history", setHistoryEnabled, "historyEnabled", !historyEnabled)} onTogglePreferenceLearning={() => void handleToggleSetting("history", setPreferenceLearningEnabled, "preferenceLearningEnabled", !preferenceLearningEnabled)} t={t} />
          </WorkspaceShell>
        );
      default:
        return null;
    }
  };

  return (
    <div className="relative h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(250,240,220,0.94),_rgba(243,244,246,1)_40%,_rgba(232,238,245,1)_100%)] text-zinc-900 dark:bg-[radial-gradient(circle_at_top_left,_rgba(68,64,60,0.42),_rgba(9,9,11,1)_42%,_rgba(15,23,42,1)_100%)]" style={{ fontFamily: "'Noto Sans TC', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', 'Microsoft JhengHei', 'Segoe UI', sans-serif" }}>
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.52),transparent_35%,rgba(255,255,255,0.24)_100%)] dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.05),transparent_35%,rgba(255,255,255,0.08)_100%)]" />
      <div className="relative z-10 flex h-full min-h-0 flex-col px-4 py-4">
        <div className="grid h-full min-h-0 flex-1 gap-4 overflow-hidden grid-cols-[220px_minmax(0,1fr)]">
          <aside className="h-full min-h-0">
            <SettingsSidebar
              activeSection={activeSection}
              navItems={NAV_ITEMS}
              onSelectSection={setActiveSection}
              sectionLabelKey={SECTION_LABEL_KEYS}
              t={t}
              footer={<SettingsUpdater t={t} layout="rail" />}
            />
          </aside>
          <main className="relative flex h-full min-h-0 overflow-hidden">
            {renderSection()}
            {activeProfile && activeProfilePromptDraft && (
              <SettingsAppProfileEditorOverlay
                profile={activeProfile}
                globalOutputMode={outputMode}
                customLanguageVariants={customLanguageVariants}
                textDraft={activeProfileTextDraft ?? { name: activeProfile.name }}
                textFieldsDirty={(activeProfileTextDraft?.name ?? activeProfile.name) !== activeProfile.name}
                promptDraft={activeProfilePromptDraft}
                onClose={() => setActiveProfileOverlayId(null)}
                onDelete={() => handleDeleteProfile(activeProfile.id)}
                onImmediateChange={(patch) => handleImmediateProfileChange(activeProfile.id, patch)}
                onTextDraftChange={(patch) => handleProfileTextDraftChange(activeProfile.id, patch)}
                onSaveTextFields={() => handleSaveProfileTextFields(activeProfile.id)}
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
                uiLanguage={language}
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
