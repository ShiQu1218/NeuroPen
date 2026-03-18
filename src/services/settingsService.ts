import { invoke } from "@tauri-apps/api/core";
import type { LocalSttModel, LocalTtsModel, RegisteredHotkeys } from "../components/settings/settingsShared";
import type { LlmProvider, SttLanguage } from "../store/useAppStore";

export interface SttCapabilities {
  openAiAvailable: boolean;
  localAvailable: boolean;
  sensevoiceAvailable: boolean;
  moonshineAvailable: boolean;
}

export interface RuntimeSttConfig {
  engine: "openAi" | "localWhisper" | "senseVoice" | "moonshine";
  modelPath: string;
  sttLanguage: SttLanguage;
}

const SETTINGS_COMMANDS = {
  getSttCapabilities: "get_stt_capabilities",
  hasApiKey: "has_api_key",
  hasSttApiKey: "has_stt_api_key",
  listAudioDevices: "list_audio_devices",
  getLaunchOnStartup: "get_launch_on_startup",
  getRegisteredHotkeys: "get_registered_hotkeys",
  setApiKey: "set_api_key",
  setSttApiKey: "set_stt_api_key",
  changeHotkey: "change_hotkey",
  changeScreenshotHotkey: "change_screenshot_hotkey",
  changeDialogHotkey: "change_dialog_hotkey",
  setLaunchOnStartup: "set_launch_on_startup",
  setAudioDevice: "set_audio_device",
  setRuntimeSttConfig: "set_runtime_stt_config",
  listLocalSttModels: "list_local_stt_models",
  installLocalSttModel: "install_local_stt_model",
  cancelLocalSttDownload: "cancel_local_stt_download",
  deleteLocalSttModel: "delete_local_stt_model",
  selectLocalSttModel: "select_local_stt_model",
  listLocalTtsModels: "list_local_tts_models",
  installLocalTtsModel: "install_local_tts_model",
  cancelLocalTtsDownload: "cancel_local_tts_download",
  deleteLocalTtsModel: "delete_local_tts_model",
  selectLocalTtsModel: "select_local_tts_model",
  listAvailableLlmModels: "list_available_llm_models",
} as const;

export const settingsService = {
  getSttCapabilities: () => invoke<SttCapabilities>(SETTINGS_COMMANDS.getSttCapabilities),
  hasApiKey: () => invoke<boolean>(SETTINGS_COMMANDS.hasApiKey),
  hasSttApiKey: () => invoke<boolean>(SETTINGS_COMMANDS.hasSttApiKey),
  listAudioDevices: () => invoke<string[]>(SETTINGS_COMMANDS.listAudioDevices),
  getLaunchOnStartup: () => invoke<boolean>(SETTINGS_COMMANDS.getLaunchOnStartup),
  getRegisteredHotkeys: () => invoke<RegisteredHotkeys>(SETTINGS_COMMANDS.getRegisteredHotkeys),
  setApiKey: (key: string) => invoke<void>(SETTINGS_COMMANDS.setApiKey, { key }),
  setSttApiKey: (key: string) => invoke<void>(SETTINGS_COMMANDS.setSttApiKey, { key }),
  changeHotkey: (hotkeyStr: string) => invoke<void>(SETTINGS_COMMANDS.changeHotkey, { hotkeyStr }),
  changeScreenshotHotkey: (hotkeyStr: string) =>
    invoke<void>(SETTINGS_COMMANDS.changeScreenshotHotkey, { hotkeyStr }),
  changeDialogHotkey: (hotkeyStr: string) =>
    invoke<void>(SETTINGS_COMMANDS.changeDialogHotkey, { hotkeyStr }),
  setLaunchOnStartup: (enabled: boolean) => invoke<void>(SETTINGS_COMMANDS.setLaunchOnStartup, { enabled }),
  setAudioDevice: (name: string) => invoke<void>(SETTINGS_COMMANDS.setAudioDevice, { name }),
  setRuntimeSttConfig: (config: RuntimeSttConfig) =>
    invoke<void>(SETTINGS_COMMANDS.setRuntimeSttConfig, {
      engine: config.engine,
      modelPath: config.modelPath,
      sttLanguage: config.sttLanguage,
    }),
  listLocalSttModels: () => invoke<LocalSttModel[]>(SETTINGS_COMMANDS.listLocalSttModels),
  installLocalSttModel: (modelId: string) => invoke<void>(SETTINGS_COMMANDS.installLocalSttModel, { modelId }),
  cancelLocalSttDownload: () => invoke<void>(SETTINGS_COMMANDS.cancelLocalSttDownload),
  deleteLocalSttModel: (modelId: string) => invoke<void>(SETTINGS_COMMANDS.deleteLocalSttModel, { modelId }),
  selectLocalSttModel: (modelId: string) => invoke<string>(SETTINGS_COMMANDS.selectLocalSttModel, { modelId }),
  listLocalTtsModels: () => invoke<LocalTtsModel[]>(SETTINGS_COMMANDS.listLocalTtsModels),
  installLocalTtsModel: (modelId: string) => invoke<void>(SETTINGS_COMMANDS.installLocalTtsModel, { modelId }),
  cancelLocalTtsDownload: () => invoke<void>(SETTINGS_COMMANDS.cancelLocalTtsDownload),
  deleteLocalTtsModel: (modelId: string) => invoke<void>(SETTINGS_COMMANDS.deleteLocalTtsModel, { modelId }),
  selectLocalTtsModel: (modelId: string) => invoke<string>(SETTINGS_COMMANDS.selectLocalTtsModel, { modelId }),
  listAvailableLlmModels: (provider: LlmProvider) =>
    invoke<string[]>(SETTINGS_COMMANDS.listAvailableLlmModels, { provider }),
};
