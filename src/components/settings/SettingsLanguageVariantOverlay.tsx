import { useCallback, useEffect, useMemo, useState } from "react";
import type { TranslationKey } from "../../i18n";
import type { CustomLanguageVariant, PreferredLanguage } from "../../store/useAppStore";
import {
  createCustomLanguageVariantId,
  getDefaultLanguageVariantPreferences,
  getLanguageVariantGroups,
  getLanguageVariantOptionLabel,
  getLanguageVariantSelectionForLanguage,
  normalizeCustomLanguageVariants,
  normalizePreferredLanguageSelection,
} from "../../utils/languageVariants";

export interface SettingsLanguageVariantOverlayApplyPayload {
  scope: "global" | "profile";
  profileId?: string;
  preferences: PreferredLanguage;
  customVariants: CustomLanguageVariant[];
  useGlobal: boolean;
}

interface SettingsLanguageVariantOverlayProps {
  scope: "global" | "profile";
  profileId?: string;
  preferences: PreferredLanguage;
  globalPreferences: PreferredLanguage;
  customVariants: CustomLanguageVariant[];
  useGlobalByDefault: boolean;
  uiLanguage: string;
  onApply: (payload: SettingsLanguageVariantOverlayApplyPayload) => void | Promise<void>;
  onClose: () => void;
  t: (key: TranslationKey, params?: Record<string, string>) => string;
}

export default function SettingsLanguageVariantOverlay({
  scope,
  profileId,
  preferences,
  globalPreferences,
  customVariants,
  useGlobalByDefault,
  uiLanguage,
  onApply,
  onClose,
  t,
}: SettingsLanguageVariantOverlayProps) {
  const [draftPreferences, setDraftPreferences] = useState<PreferredLanguage>(
    getDefaultLanguageVariantPreferences(),
  );
  const [draftCustomVariants, setDraftCustomVariants] = useState<CustomLanguageVariant[]>([]);
  const [useGlobalSettings, setUseGlobalSettings] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customLanguage, setCustomLanguage] = useState("");
  const [customVariantLabel, setCustomVariantLabel] = useState("");
  const [customPromptInstruction, setCustomPromptInstruction] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const normalizedCustomVariants = normalizeCustomLanguageVariants(customVariants);
    setDraftCustomVariants(normalizedCustomVariants);
    setDraftPreferences(
      normalizePreferredLanguageSelection(preferences, normalizedCustomVariants),
    );
    setUseGlobalSettings(scope === "profile" && useGlobalByDefault);
    setShowCustomForm(false);
    setErrorMessage("");
  }, [customVariants, preferences, scope, useGlobalByDefault]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const languageGroups = useMemo(
    () => getLanguageVariantGroups(draftCustomVariants, uiLanguage),
    [draftCustomVariants, uiLanguage],
  );

  const submit = useCallback(
    async (
      nextPreferences: PreferredLanguage,
      nextCustomVariants: CustomLanguageVariant[],
      nextUseGlobalSettings: boolean,
    ) => {
      const normalizedCustomVariants = normalizeCustomLanguageVariants(nextCustomVariants);
      const normalizedPreferences = normalizePreferredLanguageSelection(
        nextPreferences,
        normalizedCustomVariants,
      );
      await onApply({
        scope,
        profileId,
        preferences: nextUseGlobalSettings ? globalPreferences : normalizedPreferences,
        customVariants: normalizedCustomVariants,
        useGlobal: scope === "profile" && nextUseGlobalSettings,
      });
    },
    [globalPreferences, onApply, profileId, scope],
  );

  const handleVariantChange = useCallback(
    (languageCode: string, variantId: string) => {
      const nextPreferences = {
        ...draftPreferences,
        [languageCode]: variantId,
      };
      const nextUseGlobalSettings = scope === "profile" ? false : useGlobalSettings;
      setDraftPreferences(nextPreferences);
      if (scope === "profile") {
        setUseGlobalSettings(false);
      }
      void submit(nextPreferences, draftCustomVariants, nextUseGlobalSettings);
    },
    [draftCustomVariants, draftPreferences, scope, submit, useGlobalSettings],
  );

  const handleUseGlobal = useCallback(() => {
    setDraftPreferences(globalPreferences);
    setUseGlobalSettings(true);
    void submit(globalPreferences, draftCustomVariants, true);
  }, [draftCustomVariants, globalPreferences, submit]);

  const handleAddCustomVariant = useCallback(() => {
    const nextLanguage = customLanguage.trim();
    const nextVariantLabel = customVariantLabel.trim();
    const nextPromptInstruction = customPromptInstruction.trim();

    if (!nextLanguage || !nextVariantLabel || !nextPromptInstruction) {
      setErrorMessage(t("settings.languageVariant.customRequired"));
      return;
    }

    const normalizedExistingVariants = normalizeCustomLanguageVariants(draftCustomVariants);
    const duplicateVariant = normalizedExistingVariants.some(
      (variant) =>
        variant.language.toLowerCase() === nextLanguage.toLowerCase() &&
        variant.variantLabel.toLowerCase() === nextVariantLabel.toLowerCase(),
    );
    if (duplicateVariant) {
      setErrorMessage(t("settings.languageVariant.customDuplicate"));
      return;
    }

    const nextVariant: CustomLanguageVariant = {
      id: createCustomLanguageVariantId(),
      languageCode: nextLanguage,
      language: nextLanguage,
      variantLabel: nextVariantLabel,
      promptInstruction: nextPromptInstruction,
    };
    const nextCustomVariants = normalizeCustomLanguageVariants([
      ...normalizedExistingVariants,
      nextVariant,
    ]);
    const addedVariant = nextCustomVariants.find((variant) => variant.id === nextVariant.id);
    const nextPreferences = addedVariant
      ? {
          ...draftPreferences,
          [addedVariant.languageCode]: addedVariant.id,
        }
      : draftPreferences;
    const nextUseGlobalSettings = scope === "profile" ? false : useGlobalSettings;

    setDraftCustomVariants(nextCustomVariants);
    setDraftPreferences(nextPreferences);
    setShowCustomForm(false);
    setErrorMessage("");
    setCustomLanguage("");
    setCustomVariantLabel("");
    setCustomPromptInstruction("");
    if (scope === "profile") {
      setUseGlobalSettings(false);
    }
    void submit(nextPreferences, nextCustomVariants, nextUseGlobalSettings);
  }, [
    customLanguage,
    customPromptInstruction,
    customVariantLabel,
    draftCustomVariants,
    draftPreferences,
    scope,
    submit,
    t,
    useGlobalSettings,
  ]);

  const handleDeleteCustomVariant = useCallback(
    (variantId: string) => {
      const nextCustomVariants = normalizeCustomLanguageVariants(
        draftCustomVariants.filter((variant) => variant.id !== variantId),
      );
      const nextGroups = getLanguageVariantGroups(nextCustomVariants, uiLanguage);
      const nextPreferences = { ...draftPreferences };

      for (const [languageCode, selectedVariantId] of Object.entries(nextPreferences)) {
        if (selectedVariantId !== variantId) {
          continue;
        }
        const fallbackGroup = nextGroups.find((group) => group.languageCode === languageCode);
        if (fallbackGroup?.defaultVariantId) {
          nextPreferences[languageCode] = fallbackGroup.defaultVariantId;
        } else {
          delete nextPreferences[languageCode];
        }
      }

      setDraftCustomVariants(nextCustomVariants);
      setDraftPreferences(nextPreferences);
      void submit(nextPreferences, nextCustomVariants, useGlobalSettings);
    },
    [draftCustomVariants, draftPreferences, submit, uiLanguage, useGlobalSettings],
  );

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(17,24,39,0.3)] px-6 py-8 backdrop-blur-sm dark:bg-[rgba(2,6,23,0.55)]">
      <div
        className="absolute inset-0"
        aria-hidden="true"
        onClick={onClose}
      />
      <section className="relative z-10 flex h-full max-h-[860px] w-full max-w-[900px] flex-col overflow-hidden rounded-[28px] border border-white/70 bg-[#f8f5ef] shadow-[0_30px_100px_rgba(15,23,42,0.22)] dark:border-zinc-700 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-4 border-b border-black/5 px-6 py-5">
          <div>
            <h2 className="text-[28px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {t("settings.languageVariant.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/5 bg-white/80 text-xl text-zinc-500 transition hover:bg-white hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label={t("settings.cancel")}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {scope === "profile" && (
            <div className="mb-4 flex items-center justify-between gap-4 rounded-[22px] border border-black/5 bg-white/80 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/80">
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {t("settings.languageVariant.profileScopeTitle")}
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {t("settings.languageVariant.profileScopeHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={handleUseGlobal}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  useGlobalSettings
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-950"
                    : "border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500"
                }`}
              >
                {t("settings.appProfile.useGlobal")}
              </button>
            </div>
          )}

          <div className="space-y-4">
            {languageGroups.map((group) => (
              <div
                key={group.languageCode}
                className="grid gap-3 rounded-[22px] border border-black/5 bg-white/85 px-4 py-3 shadow-[0_10px_26px_rgba(15,23,42,0.05)] sm:grid-cols-[minmax(0,1fr)_280px] dark:border-zinc-700 dark:bg-zinc-900/80"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{group.languageLabel}</p>
                </div>
                <label className="relative block">
                  <select
                    className="input-field h-10 w-full appearance-none rounded-2xl border-black/5 bg-[#fcfbf8] px-3 pr-10 text-sm font-semibold text-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
                    value={getLanguageVariantSelectionForLanguage(
                      draftPreferences,
                      group.languageCode,
                      draftCustomVariants,
                    )}
                    onChange={(event) => handleVariantChange(group.languageCode, event.target.value)}
                  >
                    {group.variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {getLanguageVariantOptionLabel(variant, uiLanguage)}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-lg text-zinc-500 dark:text-zinc-400">
                    ▾
                  </span>
                </label>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-[22px] border border-black/5 bg-white/80 px-4 py-4 shadow-[0_10px_26px_rgba(15,23,42,0.05)] dark:border-zinc-700 dark:bg-zinc-900/80">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {t("settings.languageVariant.customSubtitle")}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCustomForm((current) => !current);
                  setErrorMessage("");
                }}
                className="rounded-full border border-zinc-200 bg-[#faf6ee] px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-[#f4eee2] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
              >
                {t("settings.languageVariant.addCustom")}
              </button>
            </div>

            {showCustomForm && (
              <div className="mt-3 grid gap-3 rounded-[20px] border border-zinc-200 bg-[#faf6ee] p-3">
                <input
                  className="settings-input-compact"
                  value={customLanguage}
                  onChange={(event) => setCustomLanguage(event.target.value)}
                  placeholder={t("settings.languageVariant.customLanguagePlaceholder")}
                />
                <input
                  className="settings-input-compact"
                  value={customVariantLabel}
                  onChange={(event) => setCustomVariantLabel(event.target.value)}
                  placeholder={t("settings.languageVariant.customVariantPlaceholder")}
                />
                <textarea
                  className="input-field min-h-[108px] w-full px-3 py-2 text-sm leading-6"
                  value={customPromptInstruction}
                  onChange={(event) => setCustomPromptInstruction(event.target.value)}
                  placeholder={t("settings.languageVariant.customInstructionPlaceholder")}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomForm(false);
                      setErrorMessage("");
                    }}
                    className="btn-secondary px-4 py-2 text-sm"
                  >
                    {t("settings.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddCustomVariant}
                    className="btn-primary px-4 py-2 text-sm"
                  >
                    {t("settings.languageVariant.customSave")}
                  </button>
                </div>
              </div>
            )}

            {draftCustomVariants.length === 0 ? (
              <div className="mt-3 rounded-[18px] border border-dashed border-zinc-200 px-4 py-5 text-center text-sm text-zinc-500">
                {t("settings.languageVariant.noCustom")}
              </div>
            ) : (
              <div className="mt-3 space-y-2.5">
                {draftCustomVariants.map((variant) => (
                  <div
                    key={variant.id}
                    className="rounded-[18px] border border-zinc-200 bg-[#fcfbf8] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-900">
                          {variant.language} / {variant.variantLabel}
                        </p>
                        <p className="mt-1 text-xs leading-6 text-zinc-500">
                          {variant.promptInstruction}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomVariant(variant.id)}
                        className="rounded-full border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                      >
                        {t("settings.languageVariant.deleteCustom")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {errorMessage && <p className="mt-3 text-xs text-red-600">{errorMessage}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
