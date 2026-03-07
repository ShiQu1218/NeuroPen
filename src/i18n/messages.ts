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
} as const;

export type TranslationKey = keyof typeof messages["zh-TW"];
