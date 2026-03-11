import { invoke } from "@tauri-apps/api/core";

export interface RegisteredHotkeys {
  triggerHotkey: string;
  triggerPersisted: boolean;
  screenshotHotkey: string;
  screenshotPersisted: boolean;
  dialogHotkey: string;
  dialogPersisted: boolean;
}

export interface SelectionState {
  has_selection: boolean;
}

export interface ScreenshotRegion {
  [key: string]: unknown;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScreenshotResponse {
  base64Png?: string;
  base64_png?: string;
}

export interface RouteTranscriptResult {
  mode: string;
  transcript: string;
  selected_text: string | null;
  incognito: boolean;
}

export interface LlmCallPayload {
  [key: string]: unknown;
  selectedText: string;
  instruction: string;
  outputMode: "DirectInject" | "PreviewStream";
  provider: string;
  model: string;
  preferredLanguage: string;
  promptMode: "A" | "B" | "C";
  promptOverride: string;
  streamOutput: boolean;
}

export interface LlmTextCallPayload {
  [key: string]: unknown;
  selectedText: string;
  instruction: string;
  provider: string;
  model: string;
  preferredLanguage: string;
  promptMode: "A" | "B" | "C";
  promptOverride: string;
}

export interface HistorySavePayload {
  [key: string]: unknown;
  mode: string;
  inputText: string;
  instruction: string;
  output: string;
  provider: string;
  model: string;
}

export interface LoadedAttachmentImage {
  kind: "image";
  name: string;
  mimeType: string;
  base64Data: string;
  mime_type?: string;
  base64_data?: string;
}

export interface LoadedAttachmentText {
  kind: "text";
  name: string;
  mimeType: string;
  textContent: string;
  truncated: boolean;
  mime_type?: string;
  text_content?: string;
}

export type LoadedAttachment = LoadedAttachmentImage | LoadedAttachmentText;

export interface LlmImageAttachmentPayload {
  imageBase64: string;
  imageMimeType: string;
}

export interface LlmImagesCallPayload {
  [key: string]: unknown;
  instruction: string;
  images: LlmImageAttachmentPayload[];
  outputMode: "DirectInject" | "PreviewStream";
  provider: string;
  model: string;
  preferredLanguage: string;
  promptMode: string;
  promptOverride: string;
  streamOutput: boolean;
}

export const mainWindowService = {
  getRegisteredHotkeys: () => invoke<RegisteredHotkeys>("get_registered_hotkeys"),
  changeHotkey: (hotkeyStr: string) => invoke<void>("change_hotkey", { hotkeyStr }),
  changeScreenshotHotkey: (hotkeyStr: string) => invoke<void>("change_screenshot_hotkey", { hotkeyStr }),
  changeDialogHotkey: (hotkeyStr: string) => invoke<void>("change_dialog_hotkey", { hotkeyStr }),
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
  getSelection: () => invoke<SelectionState>("get_selection"),
  hasLlmApiKey: () => invoke<boolean>("has_api_key"),
  takeScreenshotRegion: (region: ScreenshotRegion) =>
    invoke<ScreenshotResponse>("take_screenshot_region", region),
  routeTranscript: (transcript: string, selectedText: string | null, wakeWord: string, incognito: boolean) =>
    invoke<RouteTranscriptResult>("route_transcript", {
      transcript,
      selectedText,
      wakeWord,
      incognito,
    }),
  getForegroundWindowTitle: () => invoke<string>("get_foreground_window_title"),
  loadAttachment: (fileName: string, bytes: number[]) =>
    invoke<LoadedAttachment>("load_attachment", { fileName, bytes }),
  pickAttachments: () => invoke<LoadedAttachment[]>("pick_attachments"),
  callLlm: (payload: LlmCallPayload) => invoke<void>("call_llm", payload),
  callLlmWithImages: (payload: LlmImagesCallPayload) =>
    invoke<void>("call_llm_with_images", payload),
  callLlmText: (payload: LlmTextCallPayload) => invoke<string>("call_llm_text", payload),
  verifyFocus: () => invoke<boolean>("verify_focus"),
  restoreFocus: () => invoke<boolean>("restore_focus"),
  restoreClipboard: () => invoke<void>("restore_clipboard"),
  injectText: (text: string, recordForUndo: boolean) =>
    invoke<void>("inject_text", {
      text,
      recordForUndo,
    }),
  historySave: (payload: HistorySavePayload) => invoke<void>("history_save", payload),
};
