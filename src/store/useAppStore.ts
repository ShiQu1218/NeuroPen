import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OutputMode = "DirectInject" | "PreviewStream";

interface AppState {
  // --- User preferences (persisted) ---
  apiKey: string;
  wakeWord: string;
  sttModelPath: string;
  outputMode: OutputMode;
  incognito: boolean;
  hotkey: string;

  // --- Runtime state (not persisted) ---
  isRecording: boolean;
  selectedText: string;

  // --- Actions ---
  setApiKey: (key: string) => void;
  setWakeWord: (word: string) => void;
  setSttModelPath: (path: string) => void;
  setOutputMode: (mode: OutputMode) => void;
  setIncognito: (on: boolean) => void;
  setHotkey: (hotkey: string) => void;
  setIsRecording: (recording: boolean) => void;
  setSelectedText: (text: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Defaults
      apiKey: "",
      wakeWord: "助理",
      sttModelPath: "",
      outputMode: "PreviewStream",
      incognito: false,
      hotkey: "Alt+Space",

      isRecording: false,
      selectedText: "",

      setApiKey: (key) => set({ apiKey: key }),
      setWakeWord: (word) => set({ wakeWord: word }),
      setSttModelPath: (path) => set({ sttModelPath: path }),
      setOutputMode: (mode) => set({ outputMode: mode }),
      setIncognito: (on) => set({ incognito: on }),
      setHotkey: (hotkey) => set({ hotkey }),
      setIsRecording: (recording) => set({ isRecording: recording }),
      setSelectedText: (text) => set({ selectedText: text }),
    }),
    {
      name: "talkflow-settings",
      // Only persist user preferences, not runtime state
      partialize: (state) => ({
        apiKey: state.apiKey,
        wakeWord: state.wakeWord,
        sttModelPath: state.sttModelPath,
        outputMode: state.outputMode,
        incognito: state.incognito,
        hotkey: state.hotkey,
      }),
    }
  )
);
