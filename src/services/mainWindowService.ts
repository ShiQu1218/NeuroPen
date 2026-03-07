import { invoke } from "@tauri-apps/api/core";

export interface RegisteredHotkeys {
  triggerHotkey: string;
  triggerPersisted: boolean;
  screenshotHotkey: string;
  screenshotPersisted: boolean;
}

export const mainWindowService = {
  getRegisteredHotkeys: () => invoke<RegisteredHotkeys>("get_registered_hotkeys"),
  changeHotkey: (hotkeyStr: string) => invoke<void>("change_hotkey", { hotkeyStr }),
  changeScreenshotHotkey: (hotkeyStr: string) => invoke<void>("change_screenshot_hotkey", { hotkeyStr }),
  setRuntimeSttConfig: (engine: string, modelPath: string, sttLanguage: string) =>
    invoke<void>("set_runtime_stt_config", { engine, modelPath, sttLanguage }),
  setAudioDevice: (name: string) => invoke<void>("set_audio_device", { name }),
  stopRecording: (engine: string, modelPath: string, sttLanguage: string) =>
    invoke<void>("stop_recording", { engine, modelPath, sttLanguage }),
  triggerHotkey: () => invoke<void>("trigger_hotkey"),
  hasSttApiKey: () => invoke<boolean>("has_stt_api_key"),
  startRecording: () => invoke<void>("start_recording"),
  startStreamingStt: (engine: string, modelPath: string) =>
    invoke<void>("start_streaming_stt", { engine, modelPath }),
  clearConversation: () => invoke<void>("clear_conversation"),
};
