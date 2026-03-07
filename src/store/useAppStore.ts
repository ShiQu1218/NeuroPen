import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OutputMode = "DirectInject" | "PreviewStream";
export type LlmProvider = "openAi" | "gemini" | "claude" | "grok" | "ollama" | "qwen" | "doubao" | "deepseek";
export type SttOutputStrategy = "raw" | "llmRefine";
export type PunctuationMode = "off" | "balanced" | "aggressive";
export type AppLanguage =
  | "zh-TW"
  | "en-US"
  | "ja-JP"
  | "es-ES"
  | "ko-KR"
  | "zh-CN"
  | "de-DE"
  | "fr-FR"
  | "ar-SA"
  | "ru-RU";

export type SttEngine = "openAi" | "localWhisper";
export type SttLanguage = "auto" | "zh" | "en" | "ja" | "ko" | "de" | "fr" | "es" | "ru" | "ar";
export type PreferredLanguage = "auto" | AppLanguage;

export type AppMode = "A" | "B1" | "B2" | "C" | null;
export type TranslationTarget = "off" | AppLanguage;
export interface QuickActionCommand {
  id: string;
  label: string;
  instruction: string;
}

export const DEFAULT_MODE_A_PROMPT =
  "Rewrite the transcript into a clean final text. Preserve the original meaning and order, improve readability, and use natural paragraphs only when they help. Avoid over-formatting, avoid unnecessary headings, and output only the final text. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.";

export const DEFAULT_MODE_B_PROMPT =
  "You are handling selected-text commands for Mode B. If the instruction is a transformation request, output only the transformed text. If the instruction is asking about the selected text, answer directly in clean Markdown with short paragraphs and bullets only when they help. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.";

export const DEFAULT_MODE_C_PROMPT =
  "You are handling spoken assistant queries for Mode C. Reply in clean Markdown like a polished Typeless-style response: short paragraphs, meaningful bullet lists when useful, no filler opening lines, and no unnecessary headings for simple answers. If mathematical expressions are present, format them with LaTeX delimiters: inline `$...$`, block `$$...$$`. Never leave equations as plain text without LaTeX delimiters.";

export const normalizeLlmModelOptions = (models: string[], activeModel?: string) =>
  Array.from(
    new Set(
      [...models, activeModel ?? ""]
        .map((model) => model.trim())
        .filter(Boolean)
    )
  );

const DEFAULT_QUICK_ACTION_COMMANDS: QuickActionCommand[] = [
  { id: "translate", label: "翻譯成英文", instruction: "Translate the selected text to English." },
  { id: "summarize", label: "摘要", instruction: "Summarize the selected text concisely." },
  { id: "grammar", label: "修正語法", instruction: "Fix grammar and spelling errors in the selected text." },
  { id: "formalize", label: "正式化", instruction: "Rewrite the selected text in a formal tone." },
];
const DEFAULT_LLM_MODEL_OPTIONS = [
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "claude-3-5-sonnet-latest",
  "gemini-2.5-flash",
  "deepseek-chat",
  "qwen-plus",
  "llama3.2",
];

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
  sttEngine: SttEngine;
  sttLanguage: SttLanguage;
  sttOutputStrategy: SttOutputStrategy;
  punctuationMode: PunctuationMode;
  contextAwareTone: boolean;
  preferredLanguage: PreferredLanguage;
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
  setSttEngine: (engine: SttEngine) => void;
  setSttLanguage: (language: SttLanguage) => void;
  setSttOutputStrategy: (strategy: SttOutputStrategy) => void;
  setPunctuationMode: (mode: PunctuationMode) => void;
  setContextAwareTone: (enabled: boolean) => void;
  setPreferredLanguage: (language: PreferredLanguage) => void;
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
  setIsTtsPlaying: (playing: boolean) => void;
  setPartialTranscript: (text: string) => void;
  setSttDurationMs: (ms: number) => void;
  setLlmDurationMs: (ms: number) => void;
  setPendingScreenshot: (base64: string) => void;
  resetSession: () => void;
}

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
      sttEngine: "openAi",
      sttLanguage: "auto",
      sttOutputStrategy: "raw",
      punctuationMode: "balanced",
      contextAwareTone: true,
      preferredLanguage: "auto",
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
      setSttEngine: (engine) => set({ sttEngine: engine }),
      setSttLanguage: (sttLanguage) => set({ sttLanguage }),
      setSttOutputStrategy: (strategy) => set({ sttOutputStrategy: strategy }),
      setPunctuationMode: (mode) => set({ punctuationMode: mode }),
      setContextAwareTone: (enabled) => set({ contextAwareTone: enabled }),
      setPreferredLanguage: (preferredLanguage) => set({ preferredLanguage }),
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
      setIsTtsPlaying: (playing) => set({ isTtsPlaying: playing }),
      setPartialTranscript: (text) => set({ partialTranscript: text }),
      setSttDurationMs: (ms) => set({ sttDurationMs: ms }),
      setLlmDurationMs: (ms) => set({ llmDurationMs: ms }),
      setPendingScreenshot: (base64) => set({ pendingScreenshot: base64 }),
      resetSession: () =>
        set({
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
          pendingScreenshot: "",
        }),
    }),
    {
      name: "talkflow-settings",
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<AppState> | undefined) ?? {};
        const nextModel =
          typeof persisted.llmModel === "string" && persisted.llmModel.trim()
            ? persisted.llmModel.trim()
            : currentState.llmModel;
        return {
          ...currentState,
          ...persisted,
          llmModel: nextModel,
          llmModelOptions: normalizeLlmModelOptions(
            Array.isArray(persisted.llmModelOptions) ? persisted.llmModelOptions : currentState.llmModelOptions,
            nextModel,
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
        sttEngine: state.sttEngine,
        sttLanguage: state.sttLanguage,
        sttOutputStrategy: state.sttOutputStrategy,
        punctuationMode: state.punctuationMode,
        contextAwareTone: state.contextAwareTone,
        preferredLanguage: state.preferredLanguage,
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
      }),
    }
  )
);
