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
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useI18n, type TranslationKey } from "../i18n";
import {
  useAppStore,
  type AppLanguage,
  type LlmProvider,
  type PreferredLanguage,
  type QuickActionCommand,
  type SttOutputStrategy,
  type PunctuationMode,
} from "../store/useAppStore";

interface LocalSttModel {
  id: string;
  name: string;
  description: string;
  speed: number;
  accuracy: number;
  downloadUrl: string;
  fileName: string;
  installed: boolean;
  active: boolean;
  modelPath: string;
}

type SettingsSection = "general" | "stt" | "quickAction" | "llm" | "privacy";

const STATUS_RESET_MS = 2000;
const RATING_INDICES = [0, 1, 2, 3, 4];
const OPENAI_STT_MODEL = "openai-whisper-api";

const NAV_ITEMS: { id: SettingsSection; icon: React.ReactNode }[] = [
  {
    id: "general",
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3v4m0 10v4m9-9h-4M7 12H3m14.364 6.364-2.828-2.828M9.464 9.464 6.636 6.636m10.728 0-2.828 2.828M9.464 14.536l-2.828 2.828" />
      </svg>
    ),
  },
  {
    id: "stt",
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-3 0h6" />
      </svg>
    ),
  },
  {
    id: "quickAction",
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 7h10v10H7z" />
        <path d="M3 12h2m14 0h2M12 3v2m0 14v2" />
      </svg>
    ),
  },
  {
    id: "llm",
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.2 4.5 3 5.7V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.3c1.8-1.2 3-3.2 3-5.7a7 7 0 0 0-7-7Z" />
        <path d="M9 21h6M10 17v4M14 17v4" />
        <path d="M9 10h0M15 10h0" />
        <path d="M9.5 13a3.5 3.5 0 0 0 5 0" />
      </svg>
    ),
  },
  {
    id: "privacy",
    icon: (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3 5 6v5c0 5 3.5 8 7 10 3.5-2 7-5 7-10V6l-7-3Z" />
      </svg>
    ),
  },
];

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
    incognito, setIncognito,
    hotkey, setHotkey,
    sttEngine, setSttEngine,
    preferredLanguage, setPreferredLanguage,
    microphoneSource, setMicrophoneSource,
    launchOnStartup, setLaunchOnStartup,
    quickActionCommands, setQuickActionCommands,
    language, setLanguage,
    localSttAvailable, setLocalSttAvailable,
    apiKeySet, setApiKeySet,
  } = useAppStore();
  const { t } = useI18n();
  const sectionLabelKey: Record<SettingsSection, TranslationKey> = {
    general: "settings.section.general",
    stt: "settings.section.stt",
    quickAction: "settings.section.quickAction",
    llm: "settings.section.llm",
    privacy: "settings.section.privacy",
  };
  const sttModelNameKey: Partial<Record<string, TranslationKey>> = {
    "whisper-small": "settings.stt.model.whisper-small.name",
    "whisper-medium": "settings.stt.model.whisper-medium.name",
    "whisper-large": "settings.stt.model.whisper-large.name",
    "whisper-turbo": "settings.stt.model.whisper-turbo.name",
  };
  const sttModelDescriptionKey: Partial<Record<string, TranslationKey>> = {
    "whisper-small": "settings.stt.model.whisper-small.description",
    "whisper-medium": "settings.stt.model.whisper-medium.description",
    "whisper-large": "settings.stt.model.whisper-large.description",
    "whisper-turbo": "settings.stt.model.whisper-turbo.description",
  };
  const getLocalizedModelName = (model: LocalSttModel) =>
    sttModelNameKey[model.id] ? t(sttModelNameKey[model.id]!) : model.name;
  const getLocalizedModelDescription = (model: LocalSttModel) =>
    sttModelDescriptionKey[model.id] ? t(sttModelDescriptionKey[model.id]!) : model.description;
  const resolveEngineAndPathByModel = (modelChoice: string): { engine: "openAi" | "localWhisper"; modelPath: string } => {
    if (modelChoice === OPENAI_STT_MODEL) {
      return { engine: "openAi", modelPath: "" };
    }
    const matchedLocalModel = localModels.find((model) => model.id === modelChoice && model.installed);
    if (matchedLocalModel) {
      return { engine: "localWhisper", modelPath: matchedLocalModel.modelPath };
    }
    const fallbackLocal = localModels.find((model) => model.installed && model.modelPath === sttModelPath)
      ?? localModels.find((model) => model.installed && model.active);
    if (fallbackLocal) {
      return { engine: "localWhisper", modelPath: fallbackLocal.modelPath };
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
  const [draftHotkey, setDraftHotkey] = useState(hotkey);
  const [draftSttEngine, setDraftSttEngine] = useState(sttEngine);
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
  const [draftPreferredLanguage, setDraftPreferredLanguage] = useState<PreferredLanguage>(preferredLanguage);
  const [draftMicrophoneSource, setDraftMicrophoneSource] = useState(microphoneSource);
  const [draftLaunchOnStartup, setDraftLaunchOnStartup] = useState(launchOnStartup);
  const [draftQuickActionCommands, setDraftQuickActionCommands] = useState<QuickActionCommand[]>(quickActionCommands);
  const [draftLanguage, setDraftLanguage] = useState<AppLanguage>(language);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [audioDevicesLoading, setAudioDevicesLoading] = useState(false);
  const [localModels, setLocalModels] = useState<LocalSttModel[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = useState(false);
  const [localModelBusyId, setLocalModelBusyId] = useState("");
  const [localModelBusyAction, setLocalModelBusyAction] = useState<"" | "install" | "delete">("");
  const [localModelStatus, setLocalModelStatus] = useState<{ type: "" | "success" | "error"; message: string }>({
    type: "",
    message: "",
  });
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  // Query backend once on mount
  useEffect(() => {
    invoke<{
      openAiAvailable: boolean;
      localAvailable: boolean;
    }>("get_stt_capabilities")
      .then((caps) => {
        setLocalSttAvailable(caps.localAvailable);
      })
      .catch(() => {
        setLocalSttAvailable(false);
      });

    invoke<boolean>("has_api_key")
      .then((has) => setApiKeySet(has))
      .catch(() => setApiKeySet(false));

    invoke<boolean>("has_stt_api_key")
      .then((has) => setSttApiKeySet(has))
      .catch(() => setSttApiKeySet(false));

    setAudioDevicesLoading(true);
    invoke<string[]>("list_audio_devices")
      .then((devices) => setAudioDevices(devices))
      .catch(() => setAudioDevices([]))
      .finally(() => setAudioDevicesLoading(false));

    invoke<boolean>("get_launch_on_startup")
      .then((enabled) => {
        setLaunchOnStartup(enabled);
        setDraftLaunchOnStartup(enabled);
      })
      .catch(() => {});
  }, [setLaunchOnStartup]);

  // Sync all drafts from store (2a: merged 7 useEffects into 1)
  useEffect(() => {
    const matchedLocalModel = localModels.find((model) => model.modelPath === sttModelPath)
      ?? localModels.find((model) => model.active);
    const nextSttModelChoice =
      sttEngine === "openAi"
        ? OPENAI_STT_MODEL
        : matchedLocalModel?.id ?? OPENAI_STT_MODEL;
    setDraftWakeWord(wakeWord);
    setDraftHotkey(hotkey);
    setDraftSttEngine(sttEngine);
    setDraftSttModelChoice(nextSttModelChoice);
    setDraftOutputMode(outputMode);
    setDraftSttOutputStrategy(sttOutputStrategy);
    setDraftPunctuationMode(punctuationMode);
    setDraftContextAwareTone(contextAwareTone);
    setDraftVocabularyTerms(vocabularyTerms.join("\n"));
    setDraftLlmProvider(llmProvider);
    setDraftLlmModel(llmModel);
    setDraftPreferredLanguage(preferredLanguage);
    setDraftMicrophoneSource(microphoneSource);
    setDraftLaunchOnStartup(launchOnStartup);
    setDraftQuickActionCommands(quickActionCommands);
    setDraftLanguage(language);
  }, [
    wakeWord,
    hotkey,
    sttEngine,
    outputMode,
    sttOutputStrategy,
    punctuationMode,
    contextAwareTone,
    vocabularyTerms,
    llmProvider,
    llmModel,
    preferredLanguage,
    microphoneSource,
    launchOnStartup,
    quickActionCommands,
    language,
    localModels,
    sttModelPath,
  ]);

  const loadLocalModels = useCallback(async () => {
    setLocalModelsLoading(true);
    try {
      const models = await invoke<LocalSttModel[]>("list_local_stt_models");
      setLocalModels(models);
    } catch (err) {
      console.error("[Settings] list_local_stt_models failed:", err);
      setLocalModelStatus({ type: "error", message: t("settings.error.loadModels") });
    } finally {
      setLocalModelsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadLocalModels();
  }, [loadLocalModels]);

  const handleSaveApiKey = () => {
    setApiKeySaveStatus("saving");
    invoke("set_api_key", { key: apiKeyInput })
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
    invoke("set_stt_api_key", { key: sttApiKeyInput })
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
    } catch (err) {
      console.error(`[Settings] ${action}_local_stt_model failed:`, err);
      setLocalModelStatus({ type: "error", message: errorMsg });
    } finally {
      setLocalModelBusyId("");
      setLocalModelBusyAction("");
    }
  };

  const handleSaveSettings = async () => {
    const nextWakeWord = draftWakeWord.trim();
    const nextModel = draftLlmModel.trim();
    const isExternalModelChoice = draftSttModelChoice === OPENAI_STT_MODEL;
    if (!isExternalModelChoice && !localModels.some((model) => model.id === draftSttModelChoice && model.installed)) {
      setSettingsSaveStatus("error");
      setLocalModelStatus({ type: "error", message: "請先安裝本地模型，或改選 OpenAI Whisper API。" });
      setTimeout(() => setSettingsSaveStatus(""), STATUS_RESET_MS);
      return;
    }
    const { engine: nextSttEngine, modelPath: nextSttModelPath } = resolveEngineAndPathByModel(draftSttModelChoice);
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
      if (draftHotkey !== hotkey) {
        await invoke("change_hotkey", { hotkeyStr: draftHotkey });
      }
      if (draftLaunchOnStartup !== launchOnStartup) {
        await invoke("set_launch_on_startup", { enabled: draftLaunchOnStartup });
      }
      await invoke("set_audio_device", { name: draftMicrophoneSource });

      setWakeWord(nextWakeWord);
      setHotkey(draftHotkey);
      setSttEngine(nextSttEngine);
      setSttModelPath(nextSttModelPath);
      setOutputMode(draftOutputMode);
      setSttOutputStrategy(draftSttOutputStrategy);
      setPunctuationMode(draftPunctuationMode);
      setContextAwareTone(draftContextAwareTone);
      setVocabularyTerms(nextVocabularyTerms);
      setLlmProvider(draftLlmProvider);
      setLlmModel(nextModel);
      setPreferredLanguage(draftPreferredLanguage);
      setMicrophoneSource(draftMicrophoneSource);
      setLaunchOnStartup(draftLaunchOnStartup);
      setQuickActionCommands(nextQuickActionCommands);
      setLanguage(draftLanguage);
      await invoke("set_runtime_stt_config", {
        engine: nextSttEngine,
        modelPath: nextSttModelPath,
      });
      await emit("talkflow://settings-saved", {
        wakeWord: nextWakeWord,
        hotkey: draftHotkey,
        sttEngine: nextSttEngine,
        sttModelPath: nextSttModelPath,
        outputMode: draftOutputMode,
        sttOutputStrategy: draftSttOutputStrategy,
        punctuationMode: draftPunctuationMode,
        contextAwareTone: draftContextAwareTone,
        vocabularyTerms: nextVocabularyTerms,
        llmProvider: draftLlmProvider,
        llmModel: nextModel,
        preferredLanguage: draftPreferredLanguage,
        microphoneSource: draftMicrophoneSource,
        launchOnStartup: draftLaunchOnStartup,
        language: draftLanguage,
        quickActionCommands: nextQuickActionCommands,
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
    setDraftHotkey(hotkey);
    setDraftSttEngine(sttEngine);
    setDraftSttModelChoice(nextSttModelChoice);
    setDraftOutputMode(outputMode);
    setDraftSttOutputStrategy(sttOutputStrategy);
    setDraftPunctuationMode(punctuationMode);
    setDraftContextAwareTone(contextAwareTone);
    setDraftVocabularyTerms(vocabularyTerms.join("\n"));
    setDraftLlmProvider(llmProvider);
    setDraftLlmModel(llmModel);
    setDraftPreferredLanguage(preferredLanguage);
    setDraftMicrophoneSource(microphoneSource);
    setDraftLaunchOnStartup(launchOnStartup);
    setDraftQuickActionCommands(quickActionCommands);
    setDraftLanguage(language);
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
      setLocalModelStatus({ type: "success", message: "詞彙庫已匯入，可按儲存套用。" });
    } catch (err) {
      console.error("[Settings] import vocabulary failed:", err);
      setLocalModelStatus({ type: "error", message: "詞彙庫匯入失敗，請確認檔案格式。" });
    }
  };

  const handleInstallLocalModel = (modelId: string) =>
    withModelBusy(
      modelId,
      "install",
      () => invoke<void>("install_local_stt_model", { modelId }),
      t("settings.status.modelInstalled"),
      t("settings.status.modelInstallFailed"),
    );

  const handleDeleteLocalModel = (modelId: string) =>
    withModelBusy(
      modelId,
      "delete",
      async () => {
        const deleting = localModels.find((model) => model.id === modelId);
        await invoke("delete_local_stt_model", { modelId });
        if (deleting && (deleting.modelPath === sttModelPath || draftSttModelChoice === modelId)) {
          setDraftSttModelChoice(OPENAI_STT_MODEL);
          setDraftSttEngine("openAi");
          setSttModelPath("");
          await invoke("set_runtime_stt_config", {
            engine: "openAi",
            modelPath: "",
          });
          await emit("talkflow://settings-saved", {
            wakeWord: draftWakeWord.trim() || wakeWord,
            hotkey: draftHotkey,
            sttEngine: "openAi",
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
            preferredLanguage: draftPreferredLanguage,
            microphoneSource: draftMicrophoneSource,
            launchOnStartup: draftLaunchOnStartup,
            language: draftLanguage,
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
      draftHotkey !== hotkey ||
      draftSttEngine !== sttEngine ||
      draftSttModelChoice !== currentSttModelChoice ||
      draftOutputMode !== outputMode ||
      draftSttOutputStrategy !== sttOutputStrategy ||
      draftPunctuationMode !== punctuationMode ||
      draftContextAwareTone !== contextAwareTone ||
      draftVocabularyTerms !== vocabularyTerms.join("\n") ||
      draftLlmProvider !== llmProvider ||
      draftLlmModel !== llmModel ||
      draftPreferredLanguage !== preferredLanguage ||
      draftMicrophoneSource !== microphoneSource ||
      draftLaunchOnStartup !== launchOnStartup ||
      draftLanguage !== language ||
      JSON.stringify(draftQuickActionCommands) !== JSON.stringify(quickActionCommands),
    [
      draftWakeWord,
      wakeWord,
      draftHotkey,
      hotkey,
      draftSttEngine,
      sttEngine,
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
      draftPreferredLanguage,
      preferredLanguage,
      draftMicrophoneSource,
      microphoneSource,
      draftLaunchOnStartup,
      launchOnStartup,
      draftLanguage,
      language,
      draftQuickActionCommands,
      quickActionCommands,
    ],
  );

  return (
    <div className="h-screen bg-[#f5f5f7] p-6 text-sm text-zinc-800 flex flex-col overflow-hidden">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{t("settings.title")}</h1>
        <p className="text-xs text-slate-500 mt-1">{t("settings.subtitle")}</p>
      </div>

      <div className="mt-4 grid grid-cols-[210px_minmax(0,1fr)] gap-4 flex-1 min-h-0">
        {/* 2b: sidebar rendered via NAV_ITEMS.map() */}
        <div className="self-start glass-panel-sm p-2 min-h-0 overflow-y-auto">
          <p className="px-2 py-1 text-xs font-semibold text-zinc-500">{t("settings.directory")}</p>
          <div className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={activeSection === item.id ? "nav-tab-active" : "nav-tab-inactive"}
              >
                <span className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
                    {item.icon}
                  </span>
                  <span>{t(sectionLabelKey[item.id])}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="glass-panel-md p-4 min-h-0 flex flex-col">
          <div className="space-y-5 min-h-0 overflow-y-auto pr-1">
          {activeSection === "general" && (
            <>
              <div className="space-y-1">
                <label className="font-medium">{t("settings.language.label")}</label>
                <select
                  className="w-full input-field px-2 py-1"
                  value={draftLanguage}
                  onChange={(e) => setDraftLanguage(e.target.value as AppLanguage)}
                >
                  <option value="zh-TW">{t("settings.language.zh-TW")}</option>
                  <option value="zh-CN">{t("settings.language.zh-CN")}</option>
                  <option value="en-US">{t("settings.language.en-US")}</option>
                  <option value="ja-JP">{t("settings.language.ja-JP")}</option>
                  <option value="es-ES">{t("settings.language.es-ES")}</option>
                  <option value="ko-KR">{t("settings.language.ko-KR")}</option>
                  <option value="de-DE">{t("settings.language.de-DE")}</option>
                  <option value="fr-FR">{t("settings.language.fr-FR")}</option>
                  <option value="ar-SA">{t("settings.language.ar-SA")}</option>
                  <option value="ru-RU">{t("settings.language.ru-RU")}</option>
                </select>
                <p className="text-xs text-gray-400">{t("settings.language.hint")}</p>
              </div>

              <div className="space-y-1">
                <label className="font-medium">LLM 輸出偏好語言</label>
                <select
                  className="w-full input-field px-2 py-1"
                  value={draftPreferredLanguage}
                  onChange={(e) => setDraftPreferredLanguage(e.target.value as PreferredLanguage)}
                >
                  <option value="auto">跟隨輸入語言（自動）</option>
                  <option value="zh-TW">繁體中文</option>
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                  <option value="ja-JP">日本語</option>
                  <option value="es-ES">Español</option>
                  <option value="ko-KR">한국어</option>
                  <option value="de-DE">Deutsch</option>
                  <option value="fr-FR">Français</option>
                  <option value="ar-SA">العربية</option>
                  <option value="ru-RU">Русский</option>
                </select>
                <p className="text-xs text-gray-400">控制 LLM 回覆預設語言（除非指令明確要求翻譯）。</p>
              </div>

              <div className="space-y-1">
                <label className="font-medium">開機自動啟動</label>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={draftLaunchOnStartup}
                    onChange={(e) => setDraftLaunchOnStartup(e.target.checked)}
                  />
                  登入 Windows 後自動啟動 TalkFlow
                </label>
              </div>

              {/* Hotkey */}
              <div className="space-y-1">
                <label className="font-medium">{t("settings.hotkey.label")}</label>
                <input
                  className="w-full input-field px-2 py-1"
                  value={draftHotkey}
                  readOnly
                  placeholder={t("settings.hotkey.placeholder")}
                  onKeyDown={(e) => {
                    e.preventDefault();
                    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

                    const parts: string[] = [];
                    if (e.ctrlKey) parts.push("Ctrl");
                    if (e.altKey) parts.push("Alt");
                    if (e.shiftKey) parts.push("Shift");
                    if (e.metaKey) parts.push("Super");

                    let key = e.key;
                    if (e.code === "Backquote" || key === "Dead") key = "Backquote";
                    else if (key === " ") key = "Space";
                    else if (key.length === 1) key = key.toUpperCase();
                    parts.push(key);

                    setDraftHotkey(parts.join("+"));
                    setHotkeyStatus("");
                    setHotkeyErrorMessage("");
                  }}
                />
                <p className="text-xs text-gray-400">{t("settings.hotkey.help")}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftHotkey("Alt+Backquote");
                      setHotkeyStatus("");
                      setHotkeyErrorMessage("");
                    }}
                    className="btn-secondary px-2 py-1 text-xs"
                  >
                    {t("settings.hotkey.reset")}
                  </button>
                  <span className="text-xs text-gray-400">{t("settings.hotkey.resetHint")}</span>
                </div>
                {hotkeyStatus === "error" && (
                  <p className="text-xs text-red-600">
                    {hotkeyErrorMessage
                      ? t("settings.hotkey.errorWithReason", { reason: hotkeyErrorMessage })
                      : t("settings.hotkey.error")}
                  </p>
                )}
              </div>

              {/* Wake word */}
              <div className="space-y-1">
                <label className="font-medium">{t("settings.wakeWord.label")}</label>
                <input
                  className="w-full input-field px-2 py-1"
                  value={draftWakeWord}
                  onChange={(e) => setDraftWakeWord(e.target.value)}
                  placeholder={t("settings.wakeWord.placeholder")}
                />
                <p className="text-xs text-gray-400">{t("settings.wakeWord.hint")}</p>
              </div>
            </>
          )}

          {activeSection === "stt" && (
            <>
              {/* STT model selector */}
              <div className="space-y-1">
                <label className="font-medium">STT 模型</label>
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
                  <option value={OPENAI_STT_MODEL}>OpenAI Whisper API（雲端）</option>
                  {localModels
                    .filter((model) => model.installed)
                    .map((model) => (
                      <option key={model.id} value={model.id}>
                        {getLocalizedModelName(model)}（本地）
                      </option>
                    ))}
                </select>
                <p className="text-xs text-gray-500">下載選項已集中在下方「模型下載與管理」。</p>
                {!localSttAvailable && (
                  <div className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <p className="font-medium">{t("settings.stt.localDisabledTitle")}</p>
                    <p className="mt-0.5 text-amber-700">
                      {t("settings.stt.localDisabledHintPrefix")}
                      <code className="mx-1 font-mono bg-amber-100 px-1 rounded">cargo build --features local-stt</code>
                      {t("settings.stt.localDisabledHintSuffix")}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-medium">麥克風來源</label>
                <select
                  className="w-full input-field px-2 py-1"
                  value={draftMicrophoneSource}
                  onChange={(e) => setDraftMicrophoneSource(e.target.value)}
                  disabled={audioDevicesLoading}
                >
                  <option value="">系統預設麥克風</option>
                  {audioDevices.map((device) => (
                    <option key={device} value={device}>
                      {device}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">可切換錄音輸入裝置，儲存後立即生效。</p>
              </div>

              {draftSttModelChoice === OPENAI_STT_MODEL && (
                <div className="space-y-1">
                  <label className="font-medium">Whisper API Key（STT）</label>
                  {sttApiKeySet && (
                    <p className="text-xs text-green-600">已設定 Whisper STT API Key</p>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="password"
                      className="flex-1 input-field px-2 py-1 font-mono text-xs"
                      value={sttApiKeyInput}
                      onChange={(e) => setSttApiKeyInput(e.target.value)}
                      placeholder={sttApiKeySet ? "••••••••" : "輸入 Whisper STT API Key"}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && sttApiKeyInput) handleSaveSttApiKey();
                      }}
                    />
                    <button
                      onClick={handleSaveSttApiKey}
                      disabled={!sttApiKeyInput || sttApiKeySaveStatus === "saving"}
                      className="px-3 py-1 rounded text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {sttApiKeySaveStatus === "saving" ? "儲存中..." : "儲存"}
                    </button>
                  </div>
                  {sttApiKeySaveStatus === "saved" && (
                    <p className="text-xs text-green-600">Whisper STT API Key 已更新</p>
                  )}
                  {sttApiKeySaveStatus === "error" && (
                    <p className="text-xs text-red-600">Whisper STT API Key 儲存失敗</p>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <label className="font-medium">STT 輸出策略</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="sttOutputStrategy"
                      value="raw"
                      checked={draftSttOutputStrategy === "raw"}
                      onChange={() => setDraftSttOutputStrategy("raw")}
                    />
                    純 STT 直出
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="sttOutputStrategy"
                      value="llmRefine"
                      checked={draftSttOutputStrategy === "llmRefine"}
                      onChange={() => setDraftSttOutputStrategy("llmRefine")}
                    />
                    先經 LLM 潤飾
                  </label>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-medium">智慧標點 / 排版</label>
                <select
                  className="w-full input-field px-2 py-1"
                  value={draftPunctuationMode}
                  onChange={(e) => setDraftPunctuationMode(e.target.value as PunctuationMode)}
                >
                  <option value="off">關閉</option>
                  <option value="balanced">平衡</option>
                  <option value="aggressive">積極</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-medium">應用程式情境感知</label>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={draftContextAwareTone}
                    onChange={(e) => setDraftContextAwareTone(e.target.checked)}
                  />
                  根據目前前景應用程式調整潤飾語氣
                </label>
              </div>

              <div className="space-y-1">
                <label className="font-medium">專業詞彙庫</label>
                <textarea
                  className="w-full min-h-[96px] input-field px-2 py-1 text-xs font-mono"
                  value={draftVocabularyTerms}
                  onChange={(e) => setDraftVocabularyTerms(e.target.value)}
                  placeholder="每行一個詞彙，或用逗號分隔"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept=".txt,.csv"
                    onChange={(e) => void handleImportVocabularyFile(e.target.files?.[0] ?? null)}
                    className="text-xs"
                  />
                  <span className="text-xs text-gray-500">支援 .txt / .csv</span>
                </div>
              </div>

              {/* Local STT model manager */}
              <div className="space-y-1">
                <label className="font-medium">模型下載與管理</label>
                <p className="text-xs text-gray-400">所有可下載模型統一在此管理（安裝 / 刪除）。</p>
                {!localSttAvailable && (
                  <p className="text-xs text-amber-700">{t("settings.stt.localNotEnabledHint")}</p>
                )}
                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {localModelsLoading && (
                    <div className="text-xs text-gray-500">{t("settings.stt.loadingModels")}</div>
                  )}
                  {!localModelsLoading && localModels.map((model) => {
                    const isBusy = localModelBusyId === model.id;
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
                            <button
                              onClick={() => handleInstallLocalModel(model.id)}
                              disabled={!!localModelBusyId}
                              className="px-2.5 py-1 rounded text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              {isBusy && localModelBusyAction === "install" ? t("settings.stt.installing") : t("settings.stt.install")}
                            </button>
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
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="font-medium">{t("settings.quickAction.label")}</label>
                  <p className="text-xs text-gray-400">{t("settings.quickAction.hint")}</p>
                </div>
                <button
                  onClick={handleAddQuickActionCommand}
                  className="btn-primary px-3 py-1.5 text-xs"
                >
                  {t("settings.quickAction.add")}
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                {draftQuickActionCommands.map((command, index) => (
                  <div key={command.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <input
                      className="w-full input-field px-2 py-1 text-xs"
                      value={command.label}
                      onChange={(e) => handleUpdateQuickActionCommand(command.id, "label", e.target.value)}
                      placeholder={t("settings.quickAction.namePlaceholder")}
                    />
                    <textarea
                      className="w-full min-h-[72px] input-field px-2 py-1 text-xs"
                      value={command.instruction}
                      onChange={(e) => handleUpdateQuickActionCommand(command.id, "instruction", e.target.value)}
                      placeholder={t("settings.quickAction.instructionPlaceholder")}
                    />
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => handleMoveQuickActionCommand(command.id, "up")}
                        disabled={index === 0}
                        className="btn-secondary px-2.5 py-1 rounded-lg text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        title="上移"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => handleMoveQuickActionCommand(command.id, "down")}
                        disabled={index === draftQuickActionCommands.length - 1}
                        className="btn-secondary px-2.5 py-1 rounded-lg text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        title="下移"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => handleDeleteQuickActionCommand(command.id)}
                        className="btn-danger px-2.5 py-1 rounded-lg text-xs"
                      >
                        {t("settings.stt.delete")}
                      </button>
                    </div>
                  </div>
                ))}
                {draftQuickActionCommands.length === 0 && (
                  <p className="text-xs text-amber-700">{t("settings.quickAction.requireOne")}</p>
                )}
              </div>
            </div>
          )}

          {activeSection === "llm" && (
            <>
              {/* Output mode */}
              <div className="space-y-1">
                <label className="font-medium">{t("settings.llm.outputMode")}</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="outputMode"
                      value="PreviewStream"
                      checked={draftOutputMode === "PreviewStream"}
                      onChange={() => setDraftOutputMode("PreviewStream")}
                    />
                    {t("settings.llm.previewStream")}
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="outputMode"
                      value="DirectInject"
                      checked={draftOutputMode === "DirectInject"}
                      onChange={() => setDraftOutputMode("DirectInject")}
                    />
                    {t("settings.llm.directInject")}
                  </label>
                </div>
              </div>

              {/* LLM Provider + Model */}
              <div className="space-y-1">
                <label className="font-medium">{t("settings.llm.provider")}</label>
                <select
                  className="w-full input-field px-2 py-1"
                  value={draftLlmProvider}
                  onChange={(e) => setDraftLlmProvider(e.target.value as LlmProvider)}
                >
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
              <div className="space-y-1">
                <label className="font-medium">{t("settings.llm.model")}</label>
                <input
                  className="w-full input-field px-2 py-1 font-mono text-xs"
                  value={draftLlmModel}
                  onChange={(e) => setDraftLlmModel(e.target.value)}
                  placeholder="e.g. gpt-4o-mini / qwen-plus / doubao-seed-1-6-250615 / deepseek-chat / llama3.2"
                />
              </div>

              {/* API Key — sent to Rust, never stored in localStorage */}
              <div className="space-y-1">
                <label className="font-medium">{t("settings.llm.apiKey")}</label>
                {draftLlmProvider === "ollama" && (
                  <p className="text-xs text-gray-500">{t("settings.llm.ollamaNoKey")}</p>
                )}
                {apiKeySet && (
                  <p className="text-xs text-green-600">{t("settings.llm.apiKeySet")}</p>
                )}
                <div className="flex gap-2">
                  <input
                    type="password"
                    className="flex-1 input-field px-2 py-1 font-mono text-xs"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={apiKeySet ? "••••••••" : t("settings.llm.apiKeyPlaceholder")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && apiKeyInput) handleSaveApiKey();
                    }}
                  />
                  <button
                    onClick={handleSaveApiKey}
                    disabled={!apiKeyInput || apiKeySaveStatus === "saving"}
                    className="px-3 py-1 rounded text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {apiKeySaveStatus === "saving" ? t("settings.llm.saving") : t("settings.llm.save")}
                  </button>
                </div>
                {apiKeySaveStatus === "saved" && (
                  <p className="text-xs text-green-600">{t("settings.llm.savedToMemory")}</p>
                )}
                {apiKeySaveStatus === "error" && (
                  <p className="text-xs text-red-600">{t("settings.llm.saveFailed")}</p>
                )}
              </div>
            </>
          )}

          {activeSection === "privacy" && (
            <div className="flex items-center gap-3">
              <label className="font-medium">{t("settings.privacy.label")}</label>
              <button
                onClick={() => setIncognito(!incognito)}
                className={`relative w-10 h-5 rounded-full transition-colors ${incognito ? "bg-blue-500" : "bg-gray-300"}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${incognito ? "translate-x-5" : ""}`}
                />
              </button>
            </div>
          )}
          </div>
        </div>
      </div>

      <div className="pt-3 mt-3 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
        {settingsSaveStatus === "saved" && (
          <p className="text-xs text-green-600">{t("settings.saveApplied")}</p>
        )}
        {settingsSaveStatus === "error" && (
          <p className="text-xs text-red-600">{t("settings.saveError")}</p>
        )}
        <button
          onClick={handleCancelSettings}
          disabled={!hasSettingsChanges}
          className="btn-secondary px-3.5 py-1.5 text-xs"
        >
          {t("settings.cancel")}
        </button>
        <button
          onClick={handleSaveSettings}
          disabled={!hasSettingsChanges}
          className="btn-primary px-3.5 py-1.5 text-xs"
        >
          {t("settings.save")}
        </button>
      </div>
    </div>
  );
}
