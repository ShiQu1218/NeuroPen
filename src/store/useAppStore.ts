import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OutputMode = "DirectInject" | "PreviewStream";
export type LlmProvider = "openAi" | "gemini" | "claude" | "grok" | "ollama";
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

export type AppMode = "A" | "B1" | "B2" | "C" | null;
export interface QuickActionCommand {
  id: string;
  label: string;
  instruction: string;
}

const DEFAULT_QUICK_ACTION_COMMANDS: QuickActionCommand[] = [
  { id: "translate", label: "翻譯成英文", instruction: "Translate the selected text to English." },
  { id: "summarize", label: "摘要", instruction: "Summarize the selected text concisely." },
  { id: "grammar", label: "修正語法", instruction: "Fix grammar and spelling errors in the selected text." },
  { id: "formalize", label: "正式化", instruction: "Rewrite the selected text in a formal tone." },
];

interface AppState {
  // --- User preferences (persisted) ---
  wakeWord: string;
  sttModelPath: string;
  outputMode: OutputMode;
  llmProvider: LlmProvider;
  llmModel: string;
  incognito: boolean;
  hotkey: string;
  sttEngine: SttEngine;
  sttOutputStrategy: SttOutputStrategy;
  punctuationMode: PunctuationMode;
  contextAwareTone: boolean;
  quickActionCommands: QuickActionCommand[];
  language: AppLanguage;
  vocabularyTerms: string[];

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

  // --- Actions ---
  setWakeWord: (word: string) => void;
  setSttModelPath: (path: string) => void;
  setOutputMode: (mode: OutputMode) => void;
  setLlmProvider: (provider: LlmProvider) => void;
  setLlmModel: (model: string) => void;
  setIncognito: (on: boolean) => void;
  setHotkey: (hotkey: string) => void;
  setSttEngine: (engine: SttEngine) => void;
  setSttOutputStrategy: (strategy: SttOutputStrategy) => void;
  setPunctuationMode: (mode: PunctuationMode) => void;
  setContextAwareTone: (enabled: boolean) => void;
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
      incognito: false,
      hotkey: "Alt+`",
      sttEngine: "openAi",
      sttOutputStrategy: "raw",
      punctuationMode: "balanced",
      contextAwareTone: true,
      quickActionCommands: DEFAULT_QUICK_ACTION_COMMANDS,
      language: "zh-TW",
      vocabularyTerms: [],

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

      setWakeWord: (word) => set({ wakeWord: word }),
      setSttModelPath: (path) => set({ sttModelPath: path }),
      setOutputMode: (mode) => set({ outputMode: mode }),
      setLlmProvider: (provider) => set({ llmProvider: provider }),
      setLlmModel: (model) => set({ llmModel: model }),
      setIncognito: (on) => set({ incognito: on }),
      setHotkey: (hotkey) => set({ hotkey }),
      setSttEngine: (engine) => set({ sttEngine: engine }),
      setSttOutputStrategy: (strategy) => set({ sttOutputStrategy: strategy }),
      setPunctuationMode: (mode) => set({ punctuationMode: mode }),
      setContextAwareTone: (enabled) => set({ contextAwareTone: enabled }),
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
        }),
    }),
    {
      name: "talkflow-settings",
      // Only persist user preferences, not runtime state
      partialize: (state) => ({
        wakeWord: state.wakeWord,
        sttModelPath: state.sttModelPath,
        outputMode: state.outputMode,
        llmProvider: state.llmProvider,
        llmModel: state.llmModel,
        incognito: state.incognito,
        hotkey: state.hotkey,
        sttEngine: state.sttEngine,
        sttOutputStrategy: state.sttOutputStrategy,
        punctuationMode: state.punctuationMode,
        contextAwareTone: state.contextAwareTone,
        quickActionCommands: state.quickActionCommands,
        language: state.language,
        vocabularyTerms: state.vocabularyTerms,
      }),
    }
  )
);
