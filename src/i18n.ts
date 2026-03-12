import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useAppStore, type AppLanguage } from "./store/useAppStore";
import {
  languageFallbackMap,
  localeLoaders,
  staticLocaleBundles,
  type LocaleBundle,
  type TranslationKey,
} from "./i18n/catalog";

export type { TranslationKey } from "./i18n/catalog";

const localeBundleCache = new Map<AppLanguage, LocaleBundle>(
  Object.entries(staticLocaleBundles) as Array<[AppLanguage, LocaleBundle]>,
);
const localeLoadPromises = new Map<AppLanguage, Promise<void>>();
const localeListeners = new Set<() => void>();
const SUPPORTED_LANGUAGES = new Set<AppLanguage>(Object.keys(languageFallbackMap) as AppLanguage[]);
let localeVersion = 0;

function notifyLocaleListeners() {
  localeVersion += 1;
  for (const listener of localeListeners) {
    listener();
  }
}

function subscribeLocaleChanges(listener: () => void) {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}

function getLocaleVersion() {
  return localeVersion;
}

function getCachedLocaleBundle(language: AppLanguage) {
  return localeBundleCache.get(language);
}

async function ensureLocaleBundle(language: AppLanguage) {
  if (localeBundleCache.has(language)) {
    return;
  }

  const existingLoad = localeLoadPromises.get(language);
  if (existingLoad) {
    return existingLoad;
  }

  const loadPromise = localeLoaders[language]()
    .then((bundle) => {
      localeBundleCache.set(language, bundle);
      notifyLocaleListeners();
    })
    .finally(() => {
      localeLoadPromises.delete(language);
    });

  localeLoadPromises.set(language, loadPromise);
  return loadPromise;
}

export function getPersistedLanguage(): AppLanguage {
  try {
    const persistedSettingsRaw = window.localStorage.getItem("neuropen-settings");
    if (!persistedSettingsRaw) {
      return "zh-TW";
    }

    const persistedSettings = JSON.parse(persistedSettingsRaw) as { state?: { language?: unknown } };
    const persistedLanguage = persistedSettings.state?.language;
    if (typeof persistedLanguage === "string" && SUPPORTED_LANGUAGES.has(persistedLanguage as AppLanguage)) {
      return persistedLanguage as AppLanguage;
    }
  } catch (error) {
    console.warn("Failed to read persisted language, falling back to zh-TW.", error);
  }

  return "zh-TW";
}

export async function initializeI18n(language: AppLanguage) {
  // Preload the selected locale before the first paint so the initial render does not flash back to
  // zh-TW/en-US while the dynamic locale JSON is still loading.
  await Promise.all([ensureLocaleBundle("zh-TW"), ensureLocaleBundle("en-US"), ensureLocaleBundle(language)]);
}

export function translate(
  language: AppLanguage,
  key: TranslationKey,
  params?: Record<string, string>,
): string {
  const resolvedLanguage = languageFallbackMap[language];
  const resolvedBundle = getCachedLocaleBundle(resolvedLanguage);
  const englishBundle = getCachedLocaleBundle("en-US");
  const defaultBundle = getCachedLocaleBundle("zh-TW");
  const template = String(
    getCachedLocaleBundle(language)?.overrides[key] ??
      resolvedBundle?.messages[key] ??
      englishBundle?.messages[key] ??
      defaultBundle?.messages[key] ??
      key,
  );

  if (!params) {
    return template;
  }

  return Object.entries(params).reduce<string>(
    (acc, [paramKey, value]) => acc.replace(new RegExp(`\\{${paramKey}\\}`, "g"), value),
    template,
  );
}

export function useI18n() {
  const language = useAppStore((s) => s.language);
  const loadedLocaleVersion = useSyncExternalStore(subscribeLocaleChanges, getLocaleVersion, getLocaleVersion);

  useEffect(() => {
    // Re-render once the async locale bundle arrives so the synchronous t() calls pick up the newly
    // loaded translations without forcing the rest of the app onto an async translation API.
    void ensureLocaleBundle(language);
  }, [language]);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string>) => translate(language, key, params),
    [language, loadedLocaleVersion],
  );

  return useMemo(() => ({ language, t }), [language, t]);
}
