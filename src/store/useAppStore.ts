import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OutputMode = "DirectInject" | "PreviewStream";
export type LlmProvider = "openAi" | "gemini" | "claude" | "grok" | "ollama";

export type SttEngine = "openAi" | "local";

export type AppMode = "A" | "B1" | "B2" | "C" | null;

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
      }),
    }
  )
);
