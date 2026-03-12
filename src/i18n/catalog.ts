import enUsBundle from "./locales/bundles/en-US.json";
import zhTwBundle from "./locales/bundles/zh-TW.json";
import type { AppLanguage } from "../store/useAppStore";

export type TranslationKey = keyof typeof zhTwBundle.messages;
export type LocaleMessages = Record<TranslationKey, string>;
export type LocaleOverrides = Partial<Record<TranslationKey, string>>;
export interface LocaleBundle {
  messages: LocaleMessages;
  overrides: LocaleOverrides;
}

export const staticLocaleBundles: Partial<Record<AppLanguage, LocaleBundle>> = {
  // Keep the default and English fallback locales in the base bundle so the UI can always render
  // synchronously while the selected locale chunk is still being fetched.
  "zh-TW": zhTwBundle as LocaleBundle,
  "en-US": enUsBundle as LocaleBundle,
};

export const languageFallbackMap: Record<AppLanguage, AppLanguage> = {
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

export const localeLoaders: Record<AppLanguage, () => Promise<LocaleBundle>> = {
  "zh-TW": async () => staticLocaleBundles["zh-TW"] as LocaleBundle,
  "zh-CN": async () => (await import("./locales/bundles/zh-CN.json")).default as LocaleBundle,
  "en-US": async () => staticLocaleBundles["en-US"] as LocaleBundle,
  "ja-JP": async () => (await import("./locales/bundles/ja-JP.json")).default as LocaleBundle,
  "es-ES": async () => (await import("./locales/bundles/es-ES.json")).default as LocaleBundle,
  "ko-KR": async () => (await import("./locales/bundles/ko-KR.json")).default as LocaleBundle,
  "de-DE": async () => (await import("./locales/bundles/de-DE.json")).default as LocaleBundle,
  "fr-FR": async () => (await import("./locales/bundles/fr-FR.json")).default as LocaleBundle,
  "ar-SA": async () => (await import("./locales/bundles/ar-SA.json")).default as LocaleBundle,
  "ru-RU": async () => (await import("./locales/bundles/ru-RU.json")).default as LocaleBundle,
};
