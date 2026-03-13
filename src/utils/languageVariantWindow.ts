import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { CustomLanguageVariant, PreferredLanguage } from "../store/useAppStore";

export type LanguageVariantPickerScope = "global" | "profile";

export interface LanguageVariantPickerOpenPayload {
  scope: LanguageVariantPickerScope;
  profileId?: string;
  preferences: PreferredLanguage;
  globalPreferences: PreferredLanguage;
  customVariants: CustomLanguageVariant[];
  useGlobalByDefault: boolean;
}

export interface LanguageVariantPickerApplyPayload {
  scope: LanguageVariantPickerScope;
  profileId?: string;
  preferences: PreferredLanguage;
  customVariants: CustomLanguageVariant[];
  useGlobal: boolean;
}

export const showLanguageVariantPickerWindow = async (
  payload: LanguageVariantPickerOpenPayload
) => {
  const pickerWindow = await WebviewWindow.getByLabel("language-variant-picker");
  if (!pickerWindow) {
    return null;
  }

  await pickerWindow.show();
  await pickerWindow.setFocus().catch(() => { });
  await new Promise((resolve) => window.setTimeout(resolve, 60));
  await emit("neuropen://language-variant-picker-open", payload);
  return pickerWindow;
};

export const hideLanguageVariantPickerWindow = async () => {
  const pickerWindow = await WebviewWindow.getByLabel("language-variant-picker");
  if (!pickerWindow) {
    return;
  }
  await pickerWindow.hide().catch(() => { });
};
