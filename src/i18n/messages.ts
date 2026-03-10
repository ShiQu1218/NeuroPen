import { commonMessages } from "./messages/common";
import { historyMessages } from "./messages/history";
import { previewMessages } from "./messages/preview";
import { settingsMessages } from "./messages/settings";

export const messages = {
  "zh-TW": {
    ...settingsMessages["zh-TW"],
    ...previewMessages["zh-TW"],
    ...historyMessages["zh-TW"],
    ...commonMessages["zh-TW"],
  },
  "en-US": {
    ...settingsMessages["en-US"],
    ...previewMessages["en-US"],
    ...historyMessages["en-US"],
    ...commonMessages["en-US"],
  },
  "ja-JP": {
    ...settingsMessages["ja-JP"],
    ...previewMessages["ja-JP"],
    ...historyMessages["ja-JP"],
    ...commonMessages["ja-JP"],
  },
  "zh-CN": {
    ...settingsMessages["zh-CN"],
    ...previewMessages["zh-CN"],
    ...historyMessages["zh-CN"],
    ...commonMessages["zh-CN"],
  },
  "es-ES": {
    ...settingsMessages["es-ES"],
    ...previewMessages["es-ES"],
    ...historyMessages["es-ES"],
    ...commonMessages["es-ES"],
  },
  "ko-KR": {
    ...settingsMessages["ko-KR"],
    ...previewMessages["ko-KR"],
    ...historyMessages["ko-KR"],
    ...commonMessages["ko-KR"],
  },
  "de-DE": {
    ...settingsMessages["de-DE"],
    ...previewMessages["de-DE"],
    ...historyMessages["de-DE"],
    ...commonMessages["de-DE"],
  },
  "fr-FR": {
    ...settingsMessages["fr-FR"],
    ...previewMessages["fr-FR"],
    ...historyMessages["fr-FR"],
    ...commonMessages["fr-FR"],
  },
  "ar-SA": {
    ...settingsMessages["ar-SA"],
    ...previewMessages["ar-SA"],
    ...historyMessages["ar-SA"],
    ...commonMessages["ar-SA"],
  },
  "ru-RU": {
    ...settingsMessages["ru-RU"],
    ...previewMessages["ru-RU"],
    ...historyMessages["ru-RU"],
    ...commonMessages["ru-RU"],
  },
} as const;

export type TranslationKey = keyof typeof messages["zh-TW"];
