import type { AppLanguage } from "../store/useAppStore";
import { messages, type TranslationKey } from "./messages";
import { localeOverrides } from "./localeOverrides";

export { messages, localeOverrides };
export type { TranslationKey };

export const languageFallbackMap: Record<AppLanguage, keyof typeof messages> = {
  "zh-TW": "zh-TW",
  "zh-CN": "zh-CN",
  "en-US": "en-US",
  "ja-JP": "ja-JP",
  "es-ES": "es-ES",
  "ko-KR": "ko-KR",
  "de-DE": "de-DE",
  "fr-FR": "fr-FR",
  "ar-SA": "ar-SA",
  "ru-RU": "ru-RU",
};
