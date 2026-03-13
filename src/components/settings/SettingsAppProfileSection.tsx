import { useState, useCallback } from "react";
import type { useI18n, TranslationKey } from "../../i18n";
import type { AppProfile, AppProfileMode, CustomLanguageVariant, OutputMode, PreferredLanguage } from "../../store/useAppStore";
import { DEFAULT_APP_PROFILES } from "../../store/appStoreDefaults";
import { getLanguageVariantSelectionSummary } from "../../utils/languageVariants";

const ALL_MODES: AppProfileMode[] = ["A", "B1", "B2", "C"];

const OUTPUT_MODE_OPTIONS: Array<{ value: OutputMode | ""; labelKey: TranslationKey }> = [
  { value: "", labelKey: "settings.appProfile.useGlobal" },
  { value: "PreviewStream", labelKey: "settings.llm.previewStream" },
  { value: "DirectInject", labelKey: "settings.llm.directInject" },
];

interface SettingsAppProfileSectionProps {
  profiles: AppProfile[];
  customLanguageVariants: CustomLanguageVariant[];
  onChange: (profiles: AppProfile[]) => void;
  onOpenLanguageVariantPicker: (profileId: string) => void;
  contextAwareTone: boolean;
  onContextAwareToneChange: (enabled: boolean) => void;
  globalOutputMode: OutputMode;
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsAppProfileSection({
  profiles,
  customLanguageVariants,
  onChange,
  onOpenLanguageVariantPicker,
  contextAwareTone,
  onContextAwareToneChange,
  globalOutputMode,
  t,
}: SettingsAppProfileSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [keywordInputs, setKeywordInputs] = useState<Record<string, string>>({});

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const updateProfile = useCallback(
    (id: string, patch: Partial<AppProfile>) => {
      onChange(profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    },
    [profiles, onChange],
  );

  const handleAddProfile = useCallback(() => {
    const newProfile: AppProfile = {
      id: `custom-${Date.now()}`,
      name: "",
      keywords: [],
      enabled: true,
      applyToModes: ["A", "B1", "B2", "C"],
      toneHint: "",
      promptAppendix: "",
      preferredLanguage: "",
      outputMode: "",
      directPaste: null,
    };
    onChange([...profiles, newProfile]);
    setExpandedId(newProfile.id);
  }, [profiles, onChange]);

  const handleDeleteProfile = useCallback(
    (id: string) => {
      onChange(profiles.filter((p) => p.id !== id));
      if (expandedId === id) setExpandedId(null);
    },
    [profiles, onChange, expandedId],
  );

  const handleResetDefaults = useCallback(() => {
    onChange([...DEFAULT_APP_PROFILES]);
    setExpandedId(null);
  }, [onChange]);

  const handleMoveProfile = useCallback(
    (id: string, direction: "up" | "down") => {
      const idx = profiles.findIndex((p) => p.id === id);
      if (idx < 0) return;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= profiles.length) return;
      const next = [...profiles];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      onChange(next);
    },
    [profiles, onChange],
  );

  const handleToggleMode = useCallback(
    (profileId: string, mode: AppProfileMode) => {
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return;
      const modes = profile.applyToModes.includes(mode)
        ? profile.applyToModes.filter((m) => m !== mode)
        : [...profile.applyToModes, mode];
      updateProfile(profileId, { applyToModes: modes });
    },
    [profiles, updateProfile],
  );

  const handleAddKeyword = useCallback(
    (profileId: string) => {
      const input = (keywordInputs[profileId] ?? "").trim();
      if (!input) return;
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile || profile.keywords.includes(input)) return;
      updateProfile(profileId, { keywords: [...profile.keywords, input] });
      setKeywordInputs((prev) => ({ ...prev, [profileId]: "" }));
    },
    [profiles, keywordInputs, updateProfile],
  );

  const handleRemoveKeyword = useCallback(
    (profileId: string, keyword: string) => {
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return;
      updateProfile(profileId, { keywords: profile.keywords.filter((k) => k !== keyword) });
    },
    [profiles, updateProfile],
  );

  const getProfileLanguageLabel = useCallback(
    (selection: PreferredLanguage | "") =>
      getLanguageVariantSelectionSummary(selection, customLanguageVariants, {
        emptyLabel: t("settings.appProfile.useGlobal"),
        globalLabel: t("settings.appProfile.useGlobal"),
        countLabel: (count) => t("settings.languageVariant.profileSummary", { count: String(count) }),
      }),
    [customLanguageVariants, t]
  );

  return (
    <div className="space-y-4">
      {/* ── Master toggle ── */}
      <div className="rounded-xl border border-zinc-200 bg-white/80 p-3 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-sm">{t("settings.appProfile.title")}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {t("settings.appProfile.description")}
            </p>
          </div>
          <button
            onClick={() => onContextAwareToneChange(!contextAwareTone)}
            className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ml-4 ${
              contextAwareTone ? "bg-blue-500" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                contextAwareTone ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>
      </div>

      {/* ── Disabled overlay message ── */}
      {!contextAwareTone && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("settings.appProfile.disabledHint")}
        </div>
      )}

      {/* ── Profile list (dimmed when master toggle is off) ── */}
      <div className={contextAwareTone ? "" : "opacity-40 pointer-events-none"}>
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-3">
          <button className="btn-primary px-3 py-1 text-xs" onClick={handleAddProfile}>
            + {t("settings.appProfile.add")}
          </button>
          <button
            className="px-3 py-1 text-xs rounded border border-zinc-300 hover:bg-zinc-100 transition-colors"
            onClick={handleResetDefaults}
          >
            {t("settings.appProfile.resetDefaults")}
          </button>
        </div>

        {profiles.length === 0 && (
          <p className="text-xs text-zinc-400 italic px-2 py-4">
            {t("settings.appProfile.noProfiles")}
          </p>
        )}

        {/* Profile cards */}
        <div className="space-y-2">
          {profiles.map((profile, index) => (
            <div
              key={profile.id}
              className="border border-zinc-200 rounded-xl bg-white/80 overflow-hidden"
            >
              {/* ── Card header ── */}
              <div className="flex items-center gap-2 px-3 py-2">
                {/* Reorder */}
                <div className="flex flex-col gap-0.5">
                  <button
                    className="text-zinc-400 hover:text-zinc-700 text-[10px] leading-none disabled:opacity-30"
                    disabled={index === 0}
                    onClick={() => handleMoveProfile(profile.id, "up")}
                  >
                    ▲
                  </button>
                  <button
                    className="text-zinc-400 hover:text-zinc-700 text-[10px] leading-none disabled:opacity-30"
                    disabled={index === profiles.length - 1}
                    onClick={() => handleMoveProfile(profile.id, "down")}
                  >
                    ▼
                  </button>
                </div>

                {/* Name + keywords summary */}
                <button
                  className="flex-1 text-left truncate min-w-0"
                  onClick={() => toggleExpand(profile.id)}
                >
                  <span className="text-sm font-medium text-zinc-800">
                    {profile.name || t("settings.appProfile.namePlaceholder")}
                  </span>
                  {profile.keywords.length > 0 && (
                    <span className="ml-2 text-[11px] text-zinc-400">
                      {profile.keywords.join(", ")}
                    </span>
                  )}
                </button>

                {/* Per-profile toggle */}
                <button
                  onClick={() => updateProfile(profile.id, { enabled: !profile.enabled })}
                  className={`relative w-9 h-[18px] rounded-full transition-colors shrink-0 ${
                    profile.enabled ? "bg-blue-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] bg-white rounded-full shadow transition-transform ${
                      profile.enabled ? "translate-x-[18px]" : ""
                    }`}
                  />
                </button>

                {/* Chevron */}
                <button
                  className="text-zinc-400 hover:text-zinc-700 text-xs px-1"
                  onClick={() => toggleExpand(profile.id)}
                >
                  {expandedId === profile.id ? "▾" : "▸"}
                </button>
              </div>

              {/* ── Card body (expanded) ── */}
              {expandedId === profile.id && (
                <div className="px-3 pb-3 space-y-3 border-t border-zinc-100 pt-3">
                  {/* Row 1: Name */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-600">
                      {t("settings.appProfile.name")}
                    </label>
                    <input
                      className="w-full input-field px-2 py-1 text-xs"
                      placeholder={t("settings.appProfile.namePlaceholder")}
                      value={profile.name}
                      onChange={(e) => updateProfile(profile.id, { name: e.target.value })}
                    />
                  </div>

                  {/* Row 2: Keywords */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-600">
                      {t("settings.appProfile.keywords")}
                    </label>
                    {profile.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {profile.keywords.map((kw) => (
                          <span
                            key={kw}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-zinc-100 rounded-full text-zinc-700"
                          >
                            {kw}
                            <button
                              className="text-zinc-400 hover:text-red-500 text-[10px]"
                              onClick={() => handleRemoveKeyword(profile.id, kw)}
                            >
                              x
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-1">
                      <input
                        className="flex-1 input-field px-2 py-1 text-xs"
                        placeholder={t("settings.appProfile.keywordPlaceholder")}
                        value={keywordInputs[profile.id] ?? ""}
                        onChange={(e) =>
                          setKeywordInputs((prev) => ({ ...prev, [profile.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddKeyword(profile.id);
                          }
                        }}
                      />
                      <button
                        className="btn-primary px-2 py-1 text-xs"
                        onClick={() => handleAddKeyword(profile.id)}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Row 3: Modes + Tone Hint (side by side) */}
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-600">
                        {t("settings.appProfile.applyToModes")}
                      </label>
                      <div className="flex gap-2">
                        {ALL_MODES.map((mode) => (
                          <label key={mode} className="flex items-center gap-1 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={profile.applyToModes.includes(mode)}
                              onChange={() => handleToggleMode(profile.id, mode)}
                              className="rounded border-zinc-300"
                            />
                            {mode}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-600">
                        {t("settings.appProfile.toneHint")}
                      </label>
                      <input
                        className="w-full input-field px-2 py-1 text-xs"
                        placeholder={t("settings.appProfile.toneHintPlaceholder")}
                        value={profile.toneHint}
                        onChange={(e) => updateProfile(profile.id, { toneHint: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Row 4: Prompt appendix */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-600">
                      {t("settings.appProfile.promptAppendix")}
                    </label>
                    <textarea
                      className="w-full input-field px-2 py-1 text-xs resize-none"
                      rows={2}
                      placeholder={t("settings.appProfile.promptAppendixPlaceholder")}
                      value={profile.promptAppendix}
                      onChange={(e) => updateProfile(profile.id, { promptAppendix: e.target.value })}
                    />
                  </div>

                  {/* Row 5: Language / Output Mode / Direct Paste (3-col grid) */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-600">
                        {t("settings.languageVariant.label")}
                      </label>
                      <button
                        type="button"
                        className="flex min-h-[38px] w-full items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs font-medium text-zinc-800 transition-colors hover:border-zinc-300 hover:bg-white"
                        onClick={() => onOpenLanguageVariantPicker(profile.id)}
                      >
                        <span className="truncate">{getProfileLanguageLabel(profile.preferredLanguage)}</span>
                        <span className="ml-3 text-zinc-400">▾</span>
                      </button>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-600">
                        {t("settings.appProfile.outputMode")}
                      </label>
                      <select
                        className="w-full input-field px-2 py-1 text-xs"
                        value={profile.outputMode}
                        onChange={(e) =>
                          updateProfile(profile.id, {
                            outputMode: e.target.value as OutputMode | "",
                          })
                        }
                      >
                        {OUTPUT_MODE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {(profile.outputMode || globalOutputMode) === "PreviewStream" ? (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-600">
                          {t("settings.appProfile.directPaste")}
                        </label>
                        <select
                          className="w-full input-field px-2 py-1 text-xs"
                          value={profile.directPaste === null ? "" : profile.directPaste ? "true" : "false"}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateProfile(profile.id, {
                              directPaste: val === "" ? null : val === "true",
                            });
                          }}
                        >
                          <option value="">{t("settings.appProfile.useGlobal")}</option>
                          <option value="true">{t("settings.appProfile.directPasteYes")}</option>
                          <option value="false">{t("settings.appProfile.directPasteNo")}</option>
                        </select>
                      </div>
                    ) : null}
                  </div>

                  {/* Delete */}
                  <div className="flex justify-end pt-1">
                    <button
                      className="px-3 py-1 text-xs text-red-600 hover:bg-red-50 rounded border border-red-200 transition-colors"
                      onClick={() => handleDeleteProfile(profile.id)}
                    >
                      {t("settings.appProfile.delete")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
