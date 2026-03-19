import type { ThemePreference } from "./store/appStoreTypes";

export type EffectiveTheme = "light" | "dark";

const SETTINGS_STORAGE_KEY = "neuropen-settings";
const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";
const SYSTEM_THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function getPersistedThemePreference(): ThemePreference {
  try {
    const persistedSettingsRaw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!persistedSettingsRaw) {
      return DEFAULT_THEME_PREFERENCE;
    }

    const persistedSettings = JSON.parse(persistedSettingsRaw) as {
      state?: { themePreference?: unknown };
    };
    if (isThemePreference(persistedSettings.state?.themePreference)) {
      return persistedSettings.state.themePreference;
    }
  } catch (error) {
    console.warn("Failed to read persisted theme preference, falling back to light.", error);
  }

  return DEFAULT_THEME_PREFERENCE;
}

export function getSystemTheme(): EffectiveTheme {
  return window.matchMedia(SYSTEM_THEME_MEDIA_QUERY).matches ? "dark" : "light";
}

export function resolveThemePreference(themePreference: ThemePreference): EffectiveTheme {
  return themePreference === "system" ? getSystemTheme() : themePreference;
}

export function applyResolvedTheme(theme: EffectiveTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function applyThemePreference(themePreference: ThemePreference) {
  const effectiveTheme = resolveThemePreference(themePreference);
  applyResolvedTheme(effectiveTheme);
  return effectiveTheme;
}

export function subscribeSystemThemeChanges(onChange: () => void) {
  const mediaQuery = window.matchMedia(SYSTEM_THEME_MEDIA_QUERY);
  const handler = () => onChange();

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }

  mediaQuery.addListener(handler);
  return () => mediaQuery.removeListener(handler);
}
