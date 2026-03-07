import { useCallback, useMemo } from "react";
import { useAppStore, type AppLanguage } from "./store/useAppStore";
import { languageFallbackMap, localeOverrides, messages, type TranslationKey } from "./i18n/catalog";

export type { TranslationKey } from "./i18n/catalog";

export function translate(
  language: AppLanguage,
  key: TranslationKey,
  params?: Record<string, string>
): string {
  const resolvedLanguage = languageFallbackMap[language];
  const override = localeOverrides[language]?.[key];
  const resolvedMessages = messages[resolvedLanguage] as Partial<Record<TranslationKey, string>>;
  const englishMessages = messages["en-US"] as Partial<Record<TranslationKey, string>>;
  const defaultMessages = messages["zh-TW"] as Record<TranslationKey, string>;
  const template = String(override ?? resolvedMessages[key] ?? englishMessages[key] ?? defaultMessages[key]);
  if (!params) return template;
  return Object.entries(params).reduce<string>(
    (acc, [paramKey, value]) => acc.replace(new RegExp(`\\{${paramKey}\\}`, "g"), value),
    template
  );
}

export function useI18n() {
  const language = useAppStore((s) => s.language);
  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string>) => translate(language, key, params),
    [language]
  );
  return useMemo(() => ({ language, t }), [language, t]);
}
