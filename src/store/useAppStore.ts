import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import {
  DEFAULT_APP_PROFILES,
  createDefaultLlmModelOptionsByProvider,
  getDefaultLlmModel,
  getDefaultLlmModelOptions,
  DEFAULT_QUICK_ACTION_COMMANDS,
  normalizeLlmModelOptions,
  normalizeLlmModelOptionsByProvider,
  normalizeLlmSelectedModelsByProvider,
} from "./appStoreDefaults";
import {
  DEFAULT_MODE_A_PROMPT,
  DEFAULT_MODE_B_PROMPT,
  PREVIOUS_DEFAULT_MODE_A_PROMPT,
  PREVIOUS_DEFAULT_MODE_B_PROMPT,
  PREVIOUS_DEFAULT_MODE_C_PROMPT,
  type CustomLanguageVariant,
  DEFAULT_MODE_C_PROMPT,
  type AppLanguage,
  type AppMode,
  type AppProfile,
  type LlmProvider,
  type OutputMode,
  type PreferredLanguage,
  type PunctuationMode,
  type QuickActionCommand,
  type SttEngine,
  type SttLanguage,
  type SttOutputStrategy,
  type ThemePreference,
  type TranslationTarget,
} from "./appStoreTypes";
import {
  getDefaultLanguageVariantPreferences,
  normalizeCustomLanguageVariants,
  normalizePreferredLanguageSelection,
  normalizeProfilePreferredLanguageSelection,
} from "../utils/languageVariants";

export type {
  AppLanguage,
  AppMode,
  AppProfile,
  CustomLanguageVariant,
  LlmProvider,
  OutputMode,
  PreferredLanguage,
  PunctuationMode,
  QuickActionCommand,
  SttEngine,
  SttLanguage,
  SttOutputStrategy,
  ThemePreference,
  TranslationTarget,
} from "./appStoreTypes";
export type { AppProfileMode, QuickActionAttachment } from "./appStoreTypes";
export { normalizeLlmModelOptions } from "./appStoreDefaults";

const LEGACY_MODE_B_PROMPTS = [
  PREVIOUS_DEFAULT_MODE_B_PROMPT,
  "You are handling selected-text commands for Selection Processing. If the instruction is a transformation request, output only the transformed text. If the instruction is asking about the selected text, answer directly and clearly in natural text. Use short paragraphs or lists only when they genuinely help. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.",
  "You are handling selected-text commands for Mode B. If the instruction is a transformation request, output only the transformed text. If the instruction is asking about the selected text, answer directly and clearly in natural text. Use short paragraphs or lists only when they genuinely help. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.",
  "You are handling selected-text commands for Mode B. If the instruction is a transformation request, output only the transformed text. If the instruction is asking about the selected text, answer directly in clean Markdown with short paragraphs and bullets only when they help. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.",
] as const;

const LEGACY_MODE_A_PROMPTS = [
  PREVIOUS_DEFAULT_MODE_A_PROMPT,
  "Rewrite the transcript into a clean final text. Preserve the original meaning and order, improve readability, and use natural paragraphs only when they help. Avoid over-formatting, avoid unnecessary headings, and output only the final text. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.",
] as const;

const LEGACY_MODE_C_PROMPTS = [
  PREVIOUS_DEFAULT_MODE_C_PROMPT,
  "You are handling spoken assistant queries for Assistant Chat. Reply directly and clearly in natural text. Keep short paragraphs when helpful, use lists only when they genuinely improve clarity, avoid filler opening lines, and avoid unnecessary headings for simple answers. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.",
  "You are handling spoken assistant queries for Mode C. Reply directly and clearly in natural text. Keep short paragraphs when helpful, use lists only when they genuinely improve clarity, avoid filler opening lines, and avoid unnecessary headings for simple answers. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.",
  "You are handling spoken assistant queries for Mode C. Reply in clean Markdown like a polished Typeless-style response: short paragraphs, meaningful bullet lists when useful, no filler opening lines, and no unnecessary headings for simple answers. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.",
] as const;

const normalizePersistedPrompt = (value: unknown, legacyValues: readonly string[], nextDefault: string) =>
  typeof value === "string" && legacyValues.includes(value.trim()) ? nextDefault : value;

const normalizePersistedAppProfiles = (
  value: unknown,
  customLanguageVariants: CustomLanguageVariant[]
): AppProfile[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_APP_PROFILES;
  }
  return value
    .filter((profile): profile is AppProfile => Boolean(profile) && typeof profile === "object")
    .map((profile) => ({
      ...profile,
      preferredLanguage: normalizeProfilePreferredLanguageSelection(
        profile.preferredLanguage,
        customLanguageVariants
      ),
    }));
};

const PERSISTED_APP_STATE_VERSION = 1;

const isLegacyTtsPitch = (value: unknown) =>
  typeof value === "string" && /^[+-]?\d+(?:\.\d+)?hz$/i.test(value.trim());

const normalizePersistedTtsPitch = (value: unknown, fallback: string) => {
  if (isLegacyTtsPitch(value)) {
    return "";
  }
  return typeof value === "string" ? value : fallback;
};

const normalizePersistedProviderModelOptions = (value: unknown): Partial<Record<LlmProvider, string[]>> => {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as Partial<Record<LlmProvider, string[]>>;
};

const normalizePersistedProviderSelectedModels = (value: unknown): Partial<Record<LlmProvider, string>> => {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as Partial<Record<LlmProvider, string>>;
};

interface AppState {
  // --- User preferences (persisted) ---
  wakeWord: string;
  sttModelPath: string;
  outputMode: OutputMode;
  llmProvider: LlmProvider;
  llmModel: string;
  llmModelOptions: string[];
  llmModelOptionsByProvider: Record<LlmProvider, string[]>;
  llmSelectedModelByProvider: Record<LlmProvider, string>;
  incognito: boolean;
  sttEnabled: boolean;
  selectionEnabled: boolean;
  screenshotEnabled: boolean;
  hotkey: string;
  screenshotHotkey: string;
  dialogHotkey: string;
  sttEngine: SttEngine;
  sttLanguage: SttLanguage;
  sttOutputStrategy: SttOutputStrategy;
  punctuationMode: PunctuationMode;
  contextAwareTone: boolean;
  preferredLanguage: PreferredLanguage;
  customLanguageVariants: CustomLanguageVariant[];
  microphoneSource: string;
  launchOnStartup: boolean;
  quickActionCommands: QuickActionCommand[];
  language: AppLanguage;
  themePreference: ThemePreference;
  vocabularyTerms: string[];
  ttsEnabled: boolean;
  ttsVoice: string;
  ttsRate: string;
  ttsPitch: string;
  modeAPrompt: string;
  modeBPrompt: string;
  modeCPrompt: string;
  modeAStreamOutput: boolean;
  modeBStreamOutput: boolean;
  translationTarget: TranslationTarget;
  historyEnabled: boolean;
  preferenceLearningEnabled: boolean;
  appProfiles: AppProfile[];

  // --- Runtime state (not persisted) ---
  isRecording: boolean;
  selectedText: string;
  currentMode: AppMode;
  transcript: string;
  sttError: string;
  localSttAvailable: boolean;
  apiKeySet: boolean;
  llmOutput: string;
  isLlmLoading: boolean;
  llmError: string;
  lastSelectedText: string;
  lastInstruction: string;
  isTtsPlaying: boolean;
  partialTranscript: string;
  sttDurationMs: number;
  llmDurationMs: number;
  pendingScreenshot: string;
  currentRequestId: string;
  currentPreferenceCategoryKey: string;
  currentPreferenceCategoryLabel: string;
  currentQuickActionCommandId: string;
  currentFeedbackRating: "up" | "down" | null;

  // --- Actions ---
  setWakeWord: (word: string) => void;
  setSttModelPath: (path: string) => void;
  setOutputMode: (mode: OutputMode) => void;
  setLlmProvider: (provider: LlmProvider) => void;
  setLlmModel: (model: string) => void;
  setLlmModelOptions: (models: string[]) => void;
  setIncognito: (on: boolean) => void;
  setSttEnabled: (enabled: boolean) => void;
  setSelectionEnabled: (enabled: boolean) => void;
  setScreenshotEnabled: (enabled: boolean) => void;
  setHotkey: (hotkey: string) => void;
  setScreenshotHotkey: (hotkey: string) => void;
  setDialogHotkey: (hotkey: string) => void;
  setSttEngine: (engine: SttEngine) => void;
  setSttLanguage: (language: SttLanguage) => void;
  setSttOutputStrategy: (strategy: SttOutputStrategy) => void;
  setPunctuationMode: (mode: PunctuationMode) => void;
  setContextAwareTone: (enabled: boolean) => void;
  setPreferredLanguage: (language: PreferredLanguage) => void;
  setCustomLanguageVariants: (variants: CustomLanguageVariant[]) => void;
  setMicrophoneSource: (source: string) => void;
  setLaunchOnStartup: (enabled: boolean) => void;
  setQuickActionCommands: (commands: QuickActionCommand[]) => void;
  setLanguage: (language: AppLanguage) => void;
  setThemePreference: (themePreference: ThemePreference) => void;
  setVocabularyTerms: (terms: string[]) => void;
  setIsRecording: (recording: boolean) => void;
  setSelectedText: (text: string) => void;
  setCurrentMode: (mode: AppMode) => void;
  setTranscript: (text: string) => void;
  setSttError: (error: string) => void;
  setLocalSttAvailable: (v: boolean) => void;
  setApiKeySet: (v: boolean) => void;
  setLlmOutput: (text: string) => void;
  setIsLlmLoading: (loading: boolean) => void;
  setLlmError: (error: string) => void;
  setLastSelectedText: (text: string) => void;
  setLastInstruction: (text: string) => void;
  setTtsEnabled: (enabled: boolean) => void;
  setTtsVoice: (voice: string) => void;
  setTtsRate: (rate: string) => void;
  setTtsPitch: (pitch: string) => void;
  setModeAPrompt: (prompt: string) => void;
  setModeBPrompt: (prompt: string) => void;
  setModeCPrompt: (prompt: string) => void;
  setModeAStreamOutput: (enabled: boolean) => void;
  setModeBStreamOutput: (enabled: boolean) => void;
  setTranslationTarget: (target: TranslationTarget) => void;
  setHistoryEnabled: (enabled: boolean) => void;
  setPreferenceLearningEnabled: (enabled: boolean) => void;
  setAppProfiles: (profiles: AppProfile[]) => void;
  setIsTtsPlaying: (playing: boolean) => void;
  setPartialTranscript: (text: string) => void;
  setSttDurationMs: (ms: number) => void;
  setLlmDurationMs: (ms: number) => void;
  setPendingScreenshot: (base64: string) => void;
  setCurrentRequestContext: (context: {
    requestId?: string;
    preferenceCategoryKey?: string;
    preferenceCategoryLabel?: string;
    quickActionCommandId?: string;
  }) => void;
  setCurrentFeedbackRating: (rating: "up" | "down" | null) => void;
  clearCurrentRequestContext: () => void;
  resetSession: () => void;
}

const PERSISTED_APP_STATE_KEYS = [
  "wakeWord",
  "sttModelPath",
  "outputMode",
  "llmProvider",
  "llmModel",
  "llmModelOptions",
  "llmModelOptionsByProvider",
  "llmSelectedModelByProvider",
  "incognito",
  "sttEnabled",
  "selectionEnabled",
  "screenshotEnabled",
  "hotkey",
  "screenshotHotkey",
  "dialogHotkey",
  "sttEngine",
  "sttLanguage",
  "sttOutputStrategy",
  "punctuationMode",
  "contextAwareTone",
  "preferredLanguage",
  "customLanguageVariants",
  "microphoneSource",
  "launchOnStartup",
  "quickActionCommands",
  "language",
  "themePreference",
  "vocabularyTerms",
  "ttsEnabled",
  "ttsVoice",
  "ttsRate",
  "ttsPitch",
  "modeAPrompt",
  "modeBPrompt",
  "modeCPrompt",
  "modeAStreamOutput",
  "modeBStreamOutput",
  "translationTarget",
  "historyEnabled",
  "preferenceLearningEnabled",
  "appProfiles",
] as const satisfies readonly (keyof AppState)[];

type PersistedAppStateKey = (typeof PERSISTED_APP_STATE_KEYS)[number];
type PersistedAppState = Pick<AppState, PersistedAppStateKey>;
type AppStateUpdate =
  | Partial<AppState>
  | ((state: AppState) => Partial<AppState> | AppState);

const pickPersistedAppState = (state: AppState): PersistedAppState =>
  Object.fromEntries(
    PERSISTED_APP_STATE_KEYS.map((key) => [key, state[key]])
  ) as PersistedAppState;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasSameValue = (left: unknown, right: unknown) =>
  Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);

const mergeChangedValue = (
  baselineValue: unknown,
  nextValue: unknown,
  storedValue: unknown
): unknown => {
  if (!isRecord(baselineValue) || !isRecord(nextValue) || !isRecord(storedValue)) {
    return nextValue;
  }

  const mergedValue: Record<string, unknown> = { ...storedValue };
  for (const [key, nextChild] of Object.entries(nextValue)) {
    if (!hasSameValue(baselineValue[key], nextChild)) {
      mergedValue[key] = mergeChangedValue(baselineValue[key], nextChild, storedValue[key]);
    }
  }
  for (const key of Object.keys(baselineValue)) {
    if (!(key in nextValue)) {
      delete mergedValue[key];
    }
  }
  return mergedValue;
};

/**
 * Zustand persist serializes after every `set`, including runtime-only updates.
 * Each Tauri window owns a separate store, so only a preference setter may write
 * to storage, and it merges its changed fields with the latest saved snapshot.
 */
const createCrossWindowPersistController = () => {
  let pendingPreferenceKeys: readonly PersistedAppStateKey[] | undefined;
  let localBaseline: PersistedAppState | undefined;
  let isHydrating = false;
  let hydratedStorageVersion: number | undefined;

  const withPendingPreferenceKeys = <T>(
    keys: readonly PersistedAppStateKey[] | undefined,
    callback: () => T
  ): T => {
    const previousKeys = pendingPreferenceKeys;
    pendingPreferenceKeys = keys;
    try {
      return callback();
    } finally {
      pendingPreferenceKeys = previousKeys;
    }
  };

  const updateLocalBaseline = (
    state: PersistedAppState,
    keys: readonly PersistedAppStateKey[] = PERSISTED_APP_STATE_KEYS
  ) => {
    localBaseline = {
      ...(localBaseline ?? state),
      ...Object.fromEntries(keys.map((key) => [key, state[key]])),
    } as PersistedAppState;
  };

  const storage: PersistStorage<PersistedAppState> | undefined =
    typeof window === "undefined"
      ? undefined
      : {
          getItem: (name) => {
            const rawValue = window.localStorage.getItem(name);
            if (rawValue === null) {
              localBaseline = undefined;
              hydratedStorageVersion = undefined;
              return null;
            }

            const storedValue = JSON.parse(rawValue) as StorageValue<PersistedAppState>;
            hydratedStorageVersion =
              typeof storedValue?.version === "number" ? storedValue.version : undefined;
            localBaseline = isRecord(storedValue?.state)
              ? (storedValue.state as PersistedAppState)
              : undefined;
            return storedValue;
          },
          setItem: (name, value) => {
            const isMigrationWrite =
              isHydrating &&
              !pendingPreferenceKeys &&
              hydratedStorageVersion !== undefined &&
              hydratedStorageVersion !== value.version;
            if (isMigrationWrite) {
              window.localStorage.setItem(name, JSON.stringify(value));
              hydratedStorageVersion = value.version;
              updateLocalBaseline(value.state);
              return;
            }
            if (!pendingPreferenceKeys) {
              return;
            }

            let storedValue: StorageValue<PersistedAppState> | null = null;
            try {
              const rawValue = window.localStorage.getItem(name);
              storedValue = rawValue === null
                ? null
                : (JSON.parse(rawValue) as StorageValue<PersistedAppState>);
            } catch {
              // A subsequent preference save restores a malformed old value.
            }

            const storedState = isRecord(storedValue?.state) ? storedValue.state : undefined;
            const changedState = Object.fromEntries(
              pendingPreferenceKeys.map((key) => [
                key,
                mergeChangedValue(localBaseline?.[key], value.state[key], storedState?.[key]),
              ])
            );
            const nextValue: StorageValue<PersistedAppState> = {
              ...value,
              state: {
                ...value.state,
                ...storedState,
                ...changedState,
              } as PersistedAppState,
            };

            window.localStorage.setItem(name, JSON.stringify(nextValue));
            updateLocalBaseline(value.state, pendingPreferenceKeys);
          },
          removeItem: (name) => {
            window.localStorage.removeItem(name);
            localBaseline = undefined;
            hydratedStorageVersion = undefined;
          },
        };

  return {
    storage,
    setHydrating: (hydrating: boolean) => {
      isHydrating = hydrating;
    },
    setBaseline: (state: AppState) => {
      localBaseline = pickPersistedAppState(state);
    },
    withPreferences: <T>(keys: readonly PersistedAppStateKey[], callback: () => T) =>
      withPendingPreferenceKeys(keys, callback),
    withRuntime: <T>(callback: () => T) =>
      withPendingPreferenceKeys(undefined, callback),
  };
};

const appStorePersistController = createCrossWindowPersistController();

const SESSION_RUNTIME_RESET: Pick<
  AppState,
  | "isRecording"
  | "selectedText"
  | "currentMode"
  | "transcript"
  | "sttError"
  | "llmOutput"
  | "isLlmLoading"
  | "llmError"
  | "lastSelectedText"
  | "lastInstruction"
  | "isTtsPlaying"
  | "partialTranscript"
  | "sttDurationMs"
  | "llmDurationMs"
  | "pendingScreenshot"
  | "currentRequestId"
  | "currentPreferenceCategoryKey"
  | "currentPreferenceCategoryLabel"
  | "currentQuickActionCommandId"
  | "currentFeedbackRating"
> = {
  isRecording: false,
  selectedText: "",
  currentMode: null,
  transcript: "",
  sttError: "",
  llmOutput: "",
  isLlmLoading: false,
  llmError: "",
  lastSelectedText: "",
  lastInstruction: "",
  isTtsPlaying: false,
  partialTranscript: "",
  sttDurationMs: 0,
  llmDurationMs: 0,
  pendingScreenshot: "",
  currentRequestId: "",
  currentPreferenceCategoryKey: "",
  currentPreferenceCategoryLabel: "",
  currentQuickActionCommandId: "",
  currentFeedbackRating: null,
};

const DEFAULT_LLM_MODEL_OPTIONS_BY_PROVIDER_STATE = createDefaultLlmModelOptionsByProvider();
const DEFAULT_LLM_SELECTED_MODEL_BY_PROVIDER_STATE = normalizeLlmSelectedModelsByProvider(
  undefined,
  DEFAULT_LLM_MODEL_OPTIONS_BY_PROVIDER_STATE,
);

export const useAppStore = create<AppState>()(
  persist(
    (set) => {
      const setPreferences = (
        keys: readonly PersistedAppStateKey[],
        update: AppStateUpdate
      ) => appStorePersistController.withPreferences(keys, () => set(update));
      const setRuntime = (update: AppStateUpdate) =>
        appStorePersistController.withRuntime(() => set(update));

      return {
        // Defaults
        wakeWord: "助理",
        sttModelPath: "",
        outputMode: "PreviewStream",
        llmProvider: "openAi",
        llmModel: DEFAULT_LLM_SELECTED_MODEL_BY_PROVIDER_STATE.openAi,
        llmModelOptions: DEFAULT_LLM_MODEL_OPTIONS_BY_PROVIDER_STATE.openAi,
        llmModelOptionsByProvider: DEFAULT_LLM_MODEL_OPTIONS_BY_PROVIDER_STATE,
        llmSelectedModelByProvider: DEFAULT_LLM_SELECTED_MODEL_BY_PROVIDER_STATE,
        incognito: false,
        sttEnabled: true,
        selectionEnabled: true,
        screenshotEnabled: true,
        hotkey: "Alt+`",
        screenshotHotkey: "Alt+S",
        dialogHotkey: "Alt+Shift+D",
        sttEngine: "openAi",
        sttLanguage: "auto",
        sttOutputStrategy: "raw",
        punctuationMode: "balanced",
        contextAwareTone: true,
        preferredLanguage: getDefaultLanguageVariantPreferences(),
        customLanguageVariants: [],
        microphoneSource: "",
        launchOnStartup: false,
        quickActionCommands: DEFAULT_QUICK_ACTION_COMMANDS,
        language: "zh-TW",
        themePreference: "light",
        vocabularyTerms: [],
        ttsEnabled: false,
        ttsVoice: "",
        ttsRate: "+0%",
        ttsPitch: "",
        modeAPrompt: DEFAULT_MODE_A_PROMPT,
        modeBPrompt: DEFAULT_MODE_B_PROMPT,
        modeCPrompt: DEFAULT_MODE_C_PROMPT,
        modeAStreamOutput: false,
        modeBStreamOutput: true,
        translationTarget: "off",
        historyEnabled: false,
        preferenceLearningEnabled: false,
        appProfiles: DEFAULT_APP_PROFILES,

        isRecording: false,
        selectedText: "",
        currentMode: null,
        transcript: "",
        sttError: "",
        localSttAvailable: false,
        apiKeySet: false,
        llmOutput: "",
        isLlmLoading: false,
        llmError: "",
        lastSelectedText: "",
        lastInstruction: "",
        isTtsPlaying: false,
        partialTranscript: "",
        sttDurationMs: 0,
        llmDurationMs: 0,
        pendingScreenshot: "",
        currentRequestId: "",
        currentPreferenceCategoryKey: "",
        currentPreferenceCategoryLabel: "",
        currentQuickActionCommandId: "",
        currentFeedbackRating: null,

        setWakeWord: (word) => setPreferences(["wakeWord"], { wakeWord: word }),
        setSttModelPath: (path) => setPreferences(["sttModelPath"], { sttModelPath: path }),
        setOutputMode: (mode) => setPreferences(["outputMode"], { outputMode: mode }),
        setLlmProvider: (provider) =>
          setPreferences(
            [
              "llmProvider",
              "llmModel",
              "llmModelOptions",
              "llmModelOptionsByProvider",
              "llmSelectedModelByProvider",
            ],
            (state) => {
              const rememberedModel =
                state.llmSelectedModelByProvider[provider]?.trim() || getDefaultLlmModel(provider);
              const nextOptions = normalizeLlmModelOptions(
                state.llmModelOptionsByProvider[provider] ?? getDefaultLlmModelOptions(provider),
                rememberedModel,
              );
              const nextModel =
                rememberedModel && nextOptions.includes(rememberedModel)
                  ? rememberedModel
                  : nextOptions[0] ?? getDefaultLlmModel(provider);
              return {
                llmProvider: provider,
                llmModel: nextModel,
                llmModelOptions: nextOptions,
                llmModelOptionsByProvider: {
                  ...state.llmModelOptionsByProvider,
                  [provider]: nextOptions,
                },
                llmSelectedModelByProvider: {
                  ...state.llmSelectedModelByProvider,
                  [provider]: nextModel,
                },
              };
            }
          ),
        setLlmModel: (model) => {
          const nextModel = model.trim();
          if (!nextModel) {
            return;
          }

          setPreferences(
            ["llmModel", "llmModelOptions", "llmModelOptionsByProvider", "llmSelectedModelByProvider"],
            (state) => {
              const nextOptions = normalizeLlmModelOptions(state.llmModelOptions, nextModel);
              return {
                llmModel: nextModel,
                llmModelOptions: nextOptions,
                llmModelOptionsByProvider: {
                  ...state.llmModelOptionsByProvider,
                  [state.llmProvider]: nextOptions,
                },
                llmSelectedModelByProvider: {
                  ...state.llmSelectedModelByProvider,
                  [state.llmProvider]: nextModel,
                },
              };
            }
          );
        },
        setLlmModelOptions: (llmModelOptions) =>
          setPreferences(
            ["llmModel", "llmModelOptions", "llmModelOptionsByProvider", "llmSelectedModelByProvider"],
            (state) => {
              const nextOptions = normalizeLlmModelOptions(llmModelOptions, state.llmModel);
              const nextModel =
                state.llmModel.trim() && nextOptions.includes(state.llmModel.trim())
                  ? state.llmModel.trim()
                  : nextOptions[0] ?? getDefaultLlmModel(state.llmProvider);
              return {
                llmModel: nextModel,
                llmModelOptions: nextOptions,
                llmModelOptionsByProvider: {
                  ...state.llmModelOptionsByProvider,
                  [state.llmProvider]: nextOptions,
                },
                llmSelectedModelByProvider: {
                  ...state.llmSelectedModelByProvider,
                  [state.llmProvider]: nextModel,
                },
              };
            }
          ),
        setIncognito: (on) => setPreferences(["incognito"], { incognito: on }),
        setSttEnabled: (sttEnabled) => setPreferences(["sttEnabled"], { sttEnabled }),
        setSelectionEnabled: (selectionEnabled) => setPreferences(["selectionEnabled"], { selectionEnabled }),
        setScreenshotEnabled: (screenshotEnabled) => setPreferences(["screenshotEnabled"], { screenshotEnabled }),
        setHotkey: (hotkey) => setPreferences(["hotkey"], { hotkey }),
        setScreenshotHotkey: (screenshotHotkey) => setPreferences(["screenshotHotkey"], { screenshotHotkey }),
        setDialogHotkey: (dialogHotkey) => setPreferences(["dialogHotkey"], { dialogHotkey }),
        setSttEngine: (engine) => setPreferences(["sttEngine"], { sttEngine: engine }),
        setSttLanguage: (sttLanguage) => setPreferences(["sttLanguage"], { sttLanguage }),
        setSttOutputStrategy: (strategy) => setPreferences(["sttOutputStrategy"], { sttOutputStrategy: strategy }),
        setPunctuationMode: (mode) => setPreferences(["punctuationMode"], { punctuationMode: mode }),
        setContextAwareTone: (enabled) => setPreferences(["contextAwareTone"], { contextAwareTone: enabled }),
        setPreferredLanguage: (preferredLanguage) =>
          setPreferences(["preferredLanguage"], (state) => ({
            preferredLanguage: normalizePreferredLanguageSelection(
              preferredLanguage,
              state.customLanguageVariants
            ),
          })),
        setCustomLanguageVariants: (customLanguageVariants) =>
          setPreferences(["customLanguageVariants", "preferredLanguage", "appProfiles"], (state) => {
            const normalizedCustomLanguageVariants = normalizeCustomLanguageVariants(customLanguageVariants);
            return {
              customLanguageVariants: normalizedCustomLanguageVariants,
              preferredLanguage: normalizePreferredLanguageSelection(
                state.preferredLanguage,
                normalizedCustomLanguageVariants
              ),
              appProfiles: normalizePersistedAppProfiles(
                state.appProfiles,
                normalizedCustomLanguageVariants
              ),
            };
          }),
        setMicrophoneSource: (microphoneSource) => setPreferences(["microphoneSource"], { microphoneSource }),
        setLaunchOnStartup: (launchOnStartup) => setPreferences(["launchOnStartup"], { launchOnStartup }),
        setQuickActionCommands: (commands) => setPreferences(["quickActionCommands"], { quickActionCommands: commands }),
        setLanguage: (language) => setPreferences(["language"], { language }),
        setThemePreference: (themePreference) => setPreferences(["themePreference"], { themePreference }),
        setVocabularyTerms: (terms) => setPreferences(["vocabularyTerms"], { vocabularyTerms: terms }),
        setIsRecording: (recording) => setRuntime({ isRecording: recording }),
        setSelectedText: (text) => setRuntime({ selectedText: text }),
        setCurrentMode: (mode) => setRuntime({ currentMode: mode }),
        setTranscript: (text) => setRuntime({ transcript: text }),
        setSttError: (error) => setRuntime({ sttError: error }),
        setLocalSttAvailable: (v) => setRuntime({ localSttAvailable: v }),
        setApiKeySet: (v) => setRuntime({ apiKeySet: v }),
        setLlmOutput: (text) => setRuntime({ llmOutput: text }),
        setIsLlmLoading: (loading) => setRuntime({ isLlmLoading: loading }),
        setLlmError: (error) => setRuntime({ llmError: error }),
        setLastSelectedText: (text) => setRuntime({ lastSelectedText: text }),
        setLastInstruction: (text) => setRuntime({ lastInstruction: text }),
        setTtsEnabled: (enabled) => setPreferences(["ttsEnabled"], { ttsEnabled: enabled }),
        setTtsVoice: (voice) => setPreferences(["ttsVoice"], { ttsVoice: voice }),
        setTtsRate: (rate) => setPreferences(["ttsRate"], { ttsRate: rate }),
        setTtsPitch: (pitch) => setPreferences(["ttsPitch"], { ttsPitch: pitch }),
        setModeAPrompt: (modeAPrompt) => setPreferences(["modeAPrompt"], { modeAPrompt }),
        setModeBPrompt: (modeBPrompt) => setPreferences(["modeBPrompt"], { modeBPrompt }),
        setModeCPrompt: (modeCPrompt) => setPreferences(["modeCPrompt"], { modeCPrompt }),
        setModeAStreamOutput: (modeAStreamOutput) => setPreferences(["modeAStreamOutput"], { modeAStreamOutput }),
        setModeBStreamOutput: (modeBStreamOutput) => setPreferences(["modeBStreamOutput"], { modeBStreamOutput }),
        setTranslationTarget: (target) => setPreferences(["translationTarget"], { translationTarget: target }),
        setHistoryEnabled: (enabled) => setPreferences(["historyEnabled"], { historyEnabled: enabled }),
        setPreferenceLearningEnabled: (enabled) => setPreferences(["preferenceLearningEnabled"], { preferenceLearningEnabled: enabled }),
        setAppProfiles: (profiles) =>
          setPreferences(["appProfiles"], (state) => ({
            appProfiles: normalizePersistedAppProfiles(
              profiles,
              state.customLanguageVariants
            ),
          })),
        setIsTtsPlaying: (playing) => setRuntime({ isTtsPlaying: playing }),
        setPartialTranscript: (text) => setRuntime({ partialTranscript: text }),
        setSttDurationMs: (ms) => setRuntime({ sttDurationMs: ms }),
        setLlmDurationMs: (ms) => setRuntime({ llmDurationMs: ms }),
        setPendingScreenshot: (base64) => setRuntime({ pendingScreenshot: base64 }),
        setCurrentRequestContext: (context) =>
          setRuntime({
            currentRequestId: context.requestId?.trim() ?? "",
            currentPreferenceCategoryKey: context.preferenceCategoryKey?.trim() ?? "",
            currentPreferenceCategoryLabel: context.preferenceCategoryLabel?.trim() ?? "",
            currentQuickActionCommandId: context.quickActionCommandId?.trim() ?? "",
          }),
        setCurrentFeedbackRating: (rating) => setRuntime({ currentFeedbackRating: rating }),
        clearCurrentRequestContext: () =>
          setRuntime({
            currentRequestId: "",
            currentPreferenceCategoryKey: "",
            currentPreferenceCategoryLabel: "",
            currentQuickActionCommandId: "",
            currentFeedbackRating: null,
          }),
        resetSession: () => setRuntime(SESSION_RUNTIME_RESET),
      };
    },
    {
      name: "neuropen-settings",
      storage: appStorePersistController.storage,
      onRehydrateStorage: () => {
        appStorePersistController.setHydrating(true);
        return (state) => {
          appStorePersistController.setHydrating(false);
          if (state) {
            appStorePersistController.setBaseline(state);
          }
        };
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<AppState> | undefined) ?? {};
        const normalizedModeAPrompt = normalizePersistedPrompt(
          persisted.modeAPrompt,
          LEGACY_MODE_A_PROMPTS,
          DEFAULT_MODE_A_PROMPT,
        );
        const normalizedModeBPrompt = normalizePersistedPrompt(
          persisted.modeBPrompt,
          LEGACY_MODE_B_PROMPTS,
          DEFAULT_MODE_B_PROMPT,
        );
        const normalizedModeCPrompt = normalizePersistedPrompt(
          persisted.modeCPrompt,
          LEGACY_MODE_C_PROMPTS,
          DEFAULT_MODE_C_PROMPT,
        );
        const nextProvider =
          typeof persisted.llmProvider === "string"
            ? persisted.llmProvider
            : currentState.llmProvider;
        const legacyCurrentModel =
          typeof persisted.llmModel === "string" && persisted.llmModel.trim()
            ? persisted.llmModel.trim()
            : getDefaultLlmModel(nextProvider);
        const persistedModelOptionsByProvider = normalizePersistedProviderModelOptions(
          persisted.llmModelOptionsByProvider
        );
        const persistedSelectedModelsByProvider = normalizePersistedProviderSelectedModels(
          persisted.llmSelectedModelByProvider
        );
        const migratedModelOptionsByProvider = normalizeLlmModelOptionsByProvider(
          {
            ...currentState.llmModelOptionsByProvider,
            ...persistedModelOptionsByProvider,
            ...(Array.isArray(persisted.llmModelOptions)
              ? { [nextProvider]: persisted.llmModelOptions }
              : {}),
          },
          {
            ...currentState.llmSelectedModelByProvider,
            ...persistedSelectedModelsByProvider,
            [nextProvider]: legacyCurrentModel,
          },
        );
        const migratedSelectedModelsByProvider = normalizeLlmSelectedModelsByProvider(
          {
            ...currentState.llmSelectedModelByProvider,
            ...persistedSelectedModelsByProvider,
            [nextProvider]: legacyCurrentModel,
          },
          migratedModelOptionsByProvider,
        );
        const nextModel = migratedSelectedModelsByProvider[nextProvider] ?? legacyCurrentModel;
        const nextModelOptions = normalizeLlmModelOptions(
          migratedModelOptionsByProvider[nextProvider] ?? getDefaultLlmModelOptions(nextProvider),
          nextModel,
        );
        const normalizedCustomVariants = normalizeCustomLanguageVariants(persisted.customLanguageVariants);
        return {
          ...currentState,
          ...persisted,
          preferredLanguage: normalizePreferredLanguageSelection(
            persisted.preferredLanguage,
            normalizedCustomVariants
          ),
          modeAPrompt: typeof normalizedModeAPrompt === "string" ? normalizedModeAPrompt : currentState.modeAPrompt,
          modeBPrompt: typeof normalizedModeBPrompt === "string" ? normalizedModeBPrompt : currentState.modeBPrompt,
          modeCPrompt: typeof normalizedModeCPrompt === "string" ? normalizedModeCPrompt : currentState.modeCPrompt,
          llmProvider: nextProvider,
          llmModel: nextModel,
          llmModelOptions: nextModelOptions,
          llmModelOptionsByProvider: {
            ...migratedModelOptionsByProvider,
            [nextProvider]: nextModelOptions,
          },
          llmSelectedModelByProvider: {
            ...migratedSelectedModelsByProvider,
            [nextProvider]: nextModel,
          },
          ttsPitch: normalizePersistedTtsPitch(persisted.ttsPitch, currentState.ttsPitch),
          preferenceLearningEnabled:
            typeof persisted.preferenceLearningEnabled === "boolean"
              ? persisted.preferenceLearningEnabled
              : currentState.preferenceLearningEnabled,
          customLanguageVariants: normalizedCustomVariants,
          themePreference:
            persisted.themePreference === "light" ||
            persisted.themePreference === "dark" ||
            persisted.themePreference === "system"
              ? persisted.themePreference
              : currentState.themePreference,
          appProfiles: normalizePersistedAppProfiles(
            persisted.appProfiles,
            normalizedCustomVariants
          ),
        };
      },
      version: PERSISTED_APP_STATE_VERSION,
      migrate: (persistedState, version) => {
        const persisted = (persistedState ?? {}) as PersistedAppState;
        if (version < PERSISTED_APP_STATE_VERSION && isLegacyTtsPitch(persisted.ttsPitch)) {
          return { ...persisted, ttsPitch: "" };
        }
        return persisted;
      },
      // Only persist user preferences, not runtime state
      partialize: pickPersistedAppState,
    }
  )
);
