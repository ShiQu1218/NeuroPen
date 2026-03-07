import type { AppLanguage } from "../store/useAppStore";
import { messages, type TranslationKey } from "./messages";
import { localeOverrides } from "./localeOverrides";

export { messages, localeOverrides };
export type { TranslationKey };

export const languageFallbackMap: Record<AppLanguage, keyof typeof messages> = {
  "zh-TW": "zh-TW",
  "en-US": "en-US",
  "ja-JP": "ja-JP",
  "es-ES": "en-US",
  "ko-KR": "en-US",
  "zh-CN": "zh-TW",
  "de-DE": "en-US",
  "fr-FR": "en-US",
  "ar-SA": "en-US",
  "ru-RU": "en-US",
};
