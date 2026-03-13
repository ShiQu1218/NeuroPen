import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_APP_PROFILES,
  DEFAULT_LLM_MODEL_OPTIONS,
  DEFAULT_QUICK_ACTION_COMMANDS,
  normalizeLlmModelOptions,
} from "./appStoreDefaults";
import {
  DEFAULT_MODE_A_PROMPT,
  DEFAULT_MODE_B_PROMPT,
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
  TranslationTarget,
} from "./appStoreTypes";
export type { AppProfileMode } from "./appStoreTypes";
export { DEFAULT_MODE_A_PROMPT, DEFAULT_MODE_B_PROMPT, DEFAULT_MODE_C_PROMPT } from "./appStoreTypes";
export { normalizeLlmModelOptions } from "./appStoreDefaults";

const LEGACY_MODE_B_PROMPTS = [
  "You are handling selected-text commands for Mode B. If the instruction is a transformation request, output only the transformed text. If the instruction is asking about the selected text, answer directly and clearly in natural text. Use short paragraphs or lists only when they genuinely help. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.",
  "You are handling selected-text commands for Mode B. If the instruction is a transformation request, output only the transformed text. If the instruction is asking about the selected text, answer directly in clean Markdown with short paragraphs and bullets only when they help. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.",
] as const;

const LEGACY_MODE_C_PROMPTS = [
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

interface AppState {
  // --- User preferences (persisted) ---
  wakeWord: string;
  sttModelPath: string;
  outputMode: OutputMode;
  llmProvider: LlmProvider;
  llmModel: string;
  llmModelOptions: string[];
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

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Defaults
      wakeWord: "助理",
      sttModelPath: "",
      outputMode: "PreviewStream",
      llmProvider: "openAi",
      llmModel: "gpt-4o-mini",
      llmModelOptions: normalizeLlmModelOptions(DEFAULT_LLM_MODEL_OPTIONS, "gpt-4o-mini"),
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
      vocabularyTerms: [],
      ttsEnabled: false,
      ttsVoice: "",
      ttsRate: "+0%",
      ttsPitch: "+0Hz",
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

      setWakeWord: (word) => set({ wakeWord: word }),
      setSttModelPath: (path) => set({ sttModelPath: path }),
      setOutputMode: (mode) => set({ outputMode: mode }),
      setLlmProvider: (provider) => set({ llmProvider: provider }),
      setLlmModel: (model) =>
        set((state) => {
          const nextModel = model.trim();
          if (!nextModel) {
            return state;
          }
          return {
            llmModel: nextModel,
            llmModelOptions: normalizeLlmModelOptions(state.llmModelOptions, nextModel),
          };
        }),
      setLlmModelOptions: (llmModelOptions) =>
        set((state) => ({
          llmModelOptions: normalizeLlmModelOptions(llmModelOptions, state.llmModel),
        })),
      setIncognito: (on) => set({ incognito: on }),
      setSttEnabled: (sttEnabled) => set({ sttEnabled }),
      setSelectionEnabled: (selectionEnabled) => set({ selectionEnabled }),
      setScreenshotEnabled: (screenshotEnabled) => set({ screenshotEnabled }),
      setHotkey: (hotkey) => set({ hotkey }),
      setScreenshotHotkey: (screenshotHotkey) => set({ screenshotHotkey }),
      setDialogHotkey: (dialogHotkey) => set({ dialogHotkey }),
      setSttEngine: (engine) => set({ sttEngine: engine }),
      setSttLanguage: (sttLanguage) => set({ sttLanguage }),
      setSttOutputStrategy: (strategy) => set({ sttOutputStrategy: strategy }),
      setPunctuationMode: (mode) => set({ punctuationMode: mode }),
      setContextAwareTone: (enabled) => set({ contextAwareTone: enabled }),
      setPreferredLanguage: (preferredLanguage) =>
        set((state) => ({
          preferredLanguage: normalizePreferredLanguageSelection(
            preferredLanguage,
            state.customLanguageVariants
          ),
        })),
      setCustomLanguageVariants: (customLanguageVariants) =>
        set((state) => {
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
      setMicrophoneSource: (microphoneSource) => set({ microphoneSource }),
      setLaunchOnStartup: (launchOnStartup) => set({ launchOnStartup }),
      setQuickActionCommands: (commands) => set({ quickActionCommands: commands }),
      setLanguage: (language) => set({ language }),
      setVocabularyTerms: (terms) => set({ vocabularyTerms: terms }),
      setIsRecording: (recording) => set({ isRecording: recording }),
      setSelectedText: (text) => set({ selectedText: text }),
      setCurrentMode: (mode) => set({ currentMode: mode }),
      setTranscript: (text) => set({ transcript: text }),
      setSttError: (error) => set({ sttError: error }),
      setLocalSttAvailable: (v) => set({ localSttAvailable: v }),
      setApiKeySet: (v) => set({ apiKeySet: v }),
      setLlmOutput: (text) => set({ llmOutput: text }),
      setIsLlmLoading: (loading) => set({ isLlmLoading: loading }),
      setLlmError: (error) => set({ llmError: error }),
      setLastSelectedText: (text) => set({ lastSelectedText: text }),
      setLastInstruction: (text) => set({ lastInstruction: text }),
      setTtsEnabled: (enabled) => set({ ttsEnabled: enabled }),
      setTtsVoice: (voice) => set({ ttsVoice: voice }),
      setTtsRate: (rate) => set({ ttsRate: rate }),
      setTtsPitch: (pitch) => set({ ttsPitch: pitch }),
      setModeAPrompt: (modeAPrompt) => set({ modeAPrompt }),
      setModeBPrompt: (modeBPrompt) => set({ modeBPrompt }),
      setModeCPrompt: (modeCPrompt) => set({ modeCPrompt }),
      setModeAStreamOutput: (modeAStreamOutput) => set({ modeAStreamOutput }),
      setModeBStreamOutput: (modeBStreamOutput) => set({ modeBStreamOutput }),
      setTranslationTarget: (target) => set({ translationTarget: target }),
      setHistoryEnabled: (enabled) => set({ historyEnabled: enabled }),
      setPreferenceLearningEnabled: (enabled) => set({ preferenceLearningEnabled: enabled }),
      setAppProfiles: (profiles) =>
        set((state) => ({
          appProfiles: normalizePersistedAppProfiles(
            profiles,
            state.customLanguageVariants
          ),
        })),
      setIsTtsPlaying: (playing) => set({ isTtsPlaying: playing }),
      setPartialTranscript: (text) => set({ partialTranscript: text }),
      setSttDurationMs: (ms) => set({ sttDurationMs: ms }),
      setLlmDurationMs: (ms) => set({ llmDurationMs: ms }),
      setPendingScreenshot: (base64) => set({ pendingScreenshot: base64 }),
      setCurrentRequestContext: (context) =>
        set({
          currentRequestId: context.requestId?.trim() ?? "",
          currentPreferenceCategoryKey: context.preferenceCategoryKey?.trim() ?? "",
          currentPreferenceCategoryLabel: context.preferenceCategoryLabel?.trim() ?? "",
          currentQuickActionCommandId: context.quickActionCommandId?.trim() ?? "",
        }),
      setCurrentFeedbackRating: (rating) => set({ currentFeedbackRating: rating }),
      clearCurrentRequestContext: () =>
        set({
          currentRequestId: "",
          currentPreferenceCategoryKey: "",
          currentPreferenceCategoryLabel: "",
          currentQuickActionCommandId: "",
          currentFeedbackRating: null,
        }),
      resetSession: () => set(SESSION_RUNTIME_RESET),
    }),
    {
      name: "neuropen-settings",
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<AppState> | undefined) ?? {};
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
        const nextModel =
          typeof persisted.llmModel === "string" && persisted.llmModel.trim()
            ? persisted.llmModel.trim()
            : currentState.llmModel;
        const normalizedCustomVariants = normalizeCustomLanguageVariants(persisted.customLanguageVariants);
        return {
          ...currentState,
          ...persisted,
          preferredLanguage: normalizePreferredLanguageSelection(
            persisted.preferredLanguage,
            normalizedCustomVariants
          ),
          modeBPrompt: typeof normalizedModeBPrompt === "string" ? normalizedModeBPrompt : currentState.modeBPrompt,
          modeCPrompt: typeof normalizedModeCPrompt === "string" ? normalizedModeCPrompt : currentState.modeCPrompt,
          llmModel: nextModel,
          llmModelOptions: normalizeLlmModelOptions(
            Array.isArray(persisted.llmModelOptions) ? persisted.llmModelOptions : currentState.llmModelOptions,
            nextModel,
          ),
          preferenceLearningEnabled:
            typeof persisted.preferenceLearningEnabled === "boolean"
              ? persisted.preferenceLearningEnabled
              : currentState.preferenceLearningEnabled,
          customLanguageVariants: normalizedCustomVariants,
          appProfiles: normalizePersistedAppProfiles(
            persisted.appProfiles,
            normalizedCustomVariants
          ),
        };
      },
      // Only persist user preferences, not runtime state
      partialize: (state) => ({
        wakeWord: state.wakeWord,
        sttModelPath: state.sttModelPath,
        outputMode: state.outputMode,
        llmProvider: state.llmProvider,
        llmModel: state.llmModel,
        llmModelOptions: state.llmModelOptions,
        incognito: state.incognito,
        sttEnabled: state.sttEnabled,
        selectionEnabled: state.selectionEnabled,
        screenshotEnabled: state.screenshotEnabled,
        hotkey: state.hotkey,
        screenshotHotkey: state.screenshotHotkey,
        dialogHotkey: state.dialogHotkey,
        sttEngine: state.sttEngine,
        sttLanguage: state.sttLanguage,
        sttOutputStrategy: state.sttOutputStrategy,
        punctuationMode: state.punctuationMode,
        contextAwareTone: state.contextAwareTone,
        preferredLanguage: state.preferredLanguage,
        customLanguageVariants: state.customLanguageVariants,
        microphoneSource: state.microphoneSource,
        launchOnStartup: state.launchOnStartup,
        quickActionCommands: state.quickActionCommands,
        language: state.language,
        vocabularyTerms: state.vocabularyTerms,
        ttsEnabled: state.ttsEnabled,
        ttsVoice: state.ttsVoice,
        ttsRate: state.ttsRate,
        ttsPitch: state.ttsPitch,
        modeAPrompt: state.modeAPrompt,
        modeBPrompt: state.modeBPrompt,
        modeCPrompt: state.modeCPrompt,
        modeAStreamOutput: state.modeAStreamOutput,
        modeBStreamOutput: state.modeBStreamOutput,
        translationTarget: state.translationTarget,
        historyEnabled: state.historyEnabled,
        preferenceLearningEnabled: state.preferenceLearningEnabled,
        appProfiles: state.appProfiles,
      }),
    }
  )
);
