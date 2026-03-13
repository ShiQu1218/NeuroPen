import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useI18n } from "../i18n";
import { useAppStore, type CustomLanguageVariant, type PreferredLanguage } from "../store/useAppStore";
import {
  createCustomLanguageVariantId,
  getDefaultLanguageVariantPreferences,
  getLanguageVariantGroups,
  getLanguageVariantOptionLabel,
  getLanguageVariantSelectionForLanguage,
  normalizeCustomLanguageVariants,
  normalizePreferredLanguageSelection,
} from "../utils/languageVariants";
import {
  type LanguageVariantPickerApplyPayload,
  type LanguageVariantPickerOpenPayload,
} from "../utils/languageVariantWindow";

export default function LanguageVariantPickerWindow() {
  const { t } = useI18n();
  const appLanguage = useAppStore((state) => state.language);
  const [scope, setScope] = useState<"global" | "profile">("global");
  const [profileId, setProfileId] = useState("");
  const [globalPreferences, setGlobalPreferences] = useState<PreferredLanguage>(
    getDefaultLanguageVariantPreferences()
  );
  const [draftPreferences, setDraftPreferences] = useState<PreferredLanguage>(
    getDefaultLanguageVariantPreferences()
  );
  const [draftCustomVariants, setDraftCustomVariants] = useState<CustomLanguageVariant[]>([]);
  const [useGlobalSettings, setUseGlobalSettings] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customLanguage, setCustomLanguage] = useState("");
  const [customVariantLabel, setCustomVariantLabel] = useState("");
  const [customPromptInstruction, setCustomPromptInstruction] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const languageGroups = useMemo(
    () => getLanguageVariantGroups(draftCustomVariants, appLanguage),
    [appLanguage, draftCustomVariants]
  );

  const closeWindow = useCallback(async () => {
    setErrorMessage("");
    setShowCustomForm(false);
    const currentWindow = getCurrentWindow();
    await currentWindow.close().catch(async () => {
      await currentWindow.hide().catch(() => { });
    });
  }, []);

  const handleStartDragging = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    void getCurrentWindow().startDragging().catch(() => { });
  }, []);

  const resetCustomForm = useCallback(() => {
    setCustomLanguage("");
    setCustomVariantLabel("");
    setCustomPromptInstruction("");
    setErrorMessage("");
    setShowCustomForm(false);
  }, []);

  const persistSelectionChange = useCallback(async (
    nextPreferences: PreferredLanguage,
    nextCustomVariants: CustomLanguageVariant[],
    nextUseGlobalSettings: boolean
  ) => {
    const normalizedCustomVariants = normalizeCustomLanguageVariants(nextCustomVariants);
    const normalizedPreferences = normalizePreferredLanguageSelection(
      nextPreferences,
      normalizedCustomVariants
    );
    const payload: LanguageVariantPickerApplyPayload = {
      scope,
      profileId: profileId || undefined,
      preferences: nextUseGlobalSettings ? globalPreferences : normalizedPreferences,
      customVariants: normalizedCustomVariants,
      useGlobal: scope === "profile" && nextUseGlobalSettings,
    };
    await emit("neuropen://language-variant-picker-apply", payload);
  }, [globalPreferences, profileId, scope]);

  const hydrateFromPayload = useCallback((payload: LanguageVariantPickerOpenPayload) => {
    const normalizedCustomVariants = normalizeCustomLanguageVariants(payload.customVariants);
    setScope(payload.scope);
    setProfileId(payload.profileId ?? "");
    setGlobalPreferences(
      normalizePreferredLanguageSelection(payload.globalPreferences, normalizedCustomVariants)
    );
    setDraftPreferences(
      normalizePreferredLanguageSelection(payload.preferences, normalizedCustomVariants)
    );
    setDraftCustomVariants(normalizedCustomVariants);
    setUseGlobalSettings(payload.scope === "profile" && payload.useGlobalByDefault);
    resetCustomForm();
  }, [resetCustomForm]);

  useEffect(() => {
    let cancelled = false;
    let unlistenOpen: (() => void) | null = null;

    void (async () => {
      const dispose = await listen<LanguageVariantPickerOpenPayload>(
        "neuropen://language-variant-picker-open",
        (event) => {
          hydrateFromPayload(event.payload);
        }
      );

      if (cancelled) {
        dispose();
        return;
      }

      unlistenOpen = dispose;
    })();

    return () => {
      cancelled = true;
      unlistenOpen?.();
    };
  }, [hydrateFromPayload]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void closeWindow();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeWindow]);

  const handleChangeLanguageVariant = useCallback((languageCode: string, variantId: string) => {
    const nextPreferences = {
      ...draftPreferences,
      [languageCode]: variantId,
    };
    const nextUseGlobalSettings = scope === "profile" ? false : useGlobalSettings;
    setDraftPreferences(nextPreferences);
    if (scope === "profile") {
      setUseGlobalSettings(false);
    }
    void persistSelectionChange(nextPreferences, draftCustomVariants, nextUseGlobalSettings);
  }, [draftCustomVariants, draftPreferences, persistSelectionChange, scope, useGlobalSettings]);

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
        variant.variantLabel.toLowerCase() === nextVariantLabel.toLowerCase()
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
    if (scope === "profile") {
      setUseGlobalSettings(false);
    }
    resetCustomForm();
    void persistSelectionChange(nextPreferences, nextCustomVariants, nextUseGlobalSettings);
  }, [
    customLanguage,
    customPromptInstruction,
    customVariantLabel,
    draftCustomVariants,
    draftPreferences,
    persistSelectionChange,
    resetCustomForm,
    scope,
    t,
    useGlobalSettings,
  ]);

  const handleDeleteCustomVariant = useCallback((variantId: string) => {
    const nextCustomVariants = normalizeCustomLanguageVariants(
      draftCustomVariants.filter((variant) => variant.id !== variantId)
    );
    const nextGroups = getLanguageVariantGroups(nextCustomVariants, appLanguage);
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
    void persistSelectionChange(nextPreferences, nextCustomVariants, useGlobalSettings);
  }, [
    appLanguage,
    draftCustomVariants,
    draftPreferences,
    persistSelectionChange,
    useGlobalSettings,
  ]);

  const handleUseGlobalSettings = useCallback(() => {
    setDraftPreferences(globalPreferences);
    setUseGlobalSettings(true);
    void persistSelectionChange(globalPreferences, draftCustomVariants, true);
  }, [draftCustomVariants, globalPreferences, persistSelectionChange]);

  const handleApply = useCallback(async () => {
    await closeWindow();
  }, [closeWindow]);

  return (
    <div className="min-h-screen bg-[#f4f4f2] text-zinc-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[820px] flex-col px-5 py-5">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-5">
          <div className="space-y-2 select-none" onMouseDown={handleStartDragging}>
            <h1 className="text-[22px] font-semibold tracking-tight">
              {t("settings.languageVariant.title")}
            </h1>
            <p className="max-w-[680px] text-sm leading-7 text-zinc-600">
              {t("settings.languageVariant.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void closeWindow();
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            className="relative z-20 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900"
            aria-label={t("settings.cancel")}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-6">
          {scope === "profile" && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-zinc-200 bg-white px-4 py-4">
              <div>
                <p className="text-sm font-semibold text-zinc-900">
                  {t("settings.languageVariant.profileScopeTitle")}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {t("settings.languageVariant.profileScopeHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={handleUseGlobalSettings}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  useGlobalSettings
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
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
                className="grid gap-3 rounded-[26px] border border-zinc-200 bg-white px-6 py-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)] sm:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-zinc-900">
                    {group.languageLabel}
                  </p>
                </div>
                <label className="relative block">
                  <select
                    className="input-field w-full appearance-none rounded-2xl border-zinc-200 bg-[#fbfbfa] px-4 py-3 pr-11 text-sm font-semibold text-zinc-800"
                    value={getLanguageVariantSelectionForLanguage(
                      draftPreferences,
                      group.languageCode,
                      draftCustomVariants
                    )}
                    onChange={(event) =>
                      handleChangeLanguageVariant(group.languageCode, event.target.value)
                    }
                  >
                    {group.variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {getLanguageVariantOptionLabel(variant, appLanguage)}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-lg text-zinc-500">
                    ▾
                  </span>
                </label>
              </div>
            ))}
          </div>

          <div className="mt-6 space-y-4 rounded-[28px] border border-zinc-200 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">
                  {t("settings.languageVariant.customSubtitle")}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {t("settings.languageVariant.customHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCustomForm((current) => !current);
                  setErrorMessage("");
                }}
                className="rounded-full border border-zinc-200 bg-[#faf8f3] px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-[#f4efe6]"
              >
                {t("settings.languageVariant.addCustom")}
              </button>
            </div>

            {showCustomForm && (
              <div className="grid gap-3 rounded-[24px] border border-zinc-200 bg-[#faf8f3] p-4">
                <input
                  className="input-field w-full px-3 py-2 text-sm"
                  value={customLanguage}
                  onChange={(event) => setCustomLanguage(event.target.value)}
                  placeholder={t("settings.languageVariant.customLanguagePlaceholder")}
                />
                <input
                  className="input-field w-full px-3 py-2 text-sm"
                  value={customVariantLabel}
                  onChange={(event) => setCustomVariantLabel(event.target.value)}
                  placeholder={t("settings.languageVariant.customVariantPlaceholder")}
                />
                <textarea
                  className="input-field min-h-[120px] w-full px-3 py-2 text-sm leading-6"
                  value={customPromptInstruction}
                  onChange={(event) => setCustomPromptInstruction(event.target.value)}
                  placeholder={t("settings.languageVariant.customInstructionPlaceholder")}
                />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetCustomForm}
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
              <div className="rounded-[22px] border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500">
                {t("settings.languageVariant.noCustom")}
              </div>
            ) : (
              <div className="space-y-3">
                {draftCustomVariants.map((variant) => (
                  <div
                    key={variant.id}
                    className="rounded-[22px] border border-zinc-200 bg-[#fbfbfa] px-4 py-4"
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
                        className="rounded-full border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                      >
                        {t("settings.languageVariant.deleteCustom")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {errorMessage && (
              <p className="text-xs text-red-600">{errorMessage}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 pt-5">
          <button
            type="button"
            onClick={() => {
              void closeWindow();
            }}
            className="btn-secondary px-5 py-2.5 text-sm"
          >
            {t("settings.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              void handleApply();
            }}
            className="btn-primary px-5 py-2.5 text-sm"
          >
            {t("settings.languageVariant.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
