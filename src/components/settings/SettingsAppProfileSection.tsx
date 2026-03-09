import { useState, useCallback } from "react";
import type { useI18n, TranslationKey } from "../../i18n";
import type { AppProfile, AppProfileMode, OutputMode, PreferredLanguage } from "../../store/useAppStore";
import { DEFAULT_APP_PROFILES } from "../../store/appStoreDefaults";

const ALL_MODES: AppProfileMode[] = ["A", "B1", "B2", "C"];

const LANGUAGE_OPTIONS: Array<{ value: PreferredLanguage | ""; label: string }> = [
  { value: "", label: "" }, // placeholder — will display useGlobal text
  { value: "auto", label: "Auto" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en-US", label: "English" },
  { value: "ja-JP", label: "日本語" },
  { value: "es-ES", label: "Español" },
  { value: "ko-KR", label: "한국어" },
  { value: "zh-CN", label: "简体中文" },
  { value: "de-DE", label: "Deutsch" },
  { value: "fr-FR", label: "Français" },
  { value: "ar-SA", label: "العربية" },
  { value: "ru-RU", label: "Русский" },
];

const OUTPUT_MODE_OPTIONS: Array<{ value: OutputMode | ""; labelKey: TranslationKey }> = [
  { value: "", labelKey: "settings.appProfile.useGlobal" },
  { value: "PreviewStream", labelKey: "settings.llm.previewStream" },
  { value: "DirectInject", labelKey: "settings.llm.directInject" },
];

interface SettingsAppProfileSectionProps {
  profiles: AppProfile[];
  onChange: (profiles: AppProfile[]) => void;
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsAppProfileSection({
  profiles,
  onChange,
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

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">{t("settings.appProfile.title")}</h3>
        <p className="text-xs text-zinc-500 mt-1">
          {t("settings.appProfile.description")}
        </p>
      </div>

      <div className="flex items-center gap-2">
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

      <div className="space-y-2">
        {profiles.map((profile, index) => (
          <div
            key={profile.id}
            className="border border-zinc-200 rounded-xl bg-white/80 overflow-hidden"
          >
            {/* Header row */}
            <div className="flex items-center gap-2 px-3 py-2">
              {/* Reorder buttons */}
              <div className="flex flex-col gap-0.5">
                <button
                  className="text-zinc-400 hover:text-zinc-700 text-[10px] leading-none disabled:opacity-30"
                  disabled={index === 0}
                  onClick={() => handleMoveProfile(profile.id, "up")}
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  className="text-zinc-400 hover:text-zinc-700 text-[10px] leading-none disabled:opacity-30"
                  disabled={index === profiles.length - 1}
                  onClick={() => handleMoveProfile(profile.id, "down")}
                  title="Move down"
                >
                  ▼
                </button>
              </div>

              {/* Name */}
              <button
                className="flex-1 text-left text-sm font-medium text-zinc-800 hover:text-zinc-600 truncate"
                onClick={() => toggleExpand(profile.id)}
              >
                {profile.name || t("settings.appProfile.namePlaceholder")}
              </button>

              {/* Toggle */}
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

              {/* Expand chevron */}
              <button
                className="text-zinc-400 hover:text-zinc-700 text-xs px-1"
                onClick={() => toggleExpand(profile.id)}
              >
                {expandedId === profile.id ? "▾" : "▸"}
              </button>
            </div>

            {/* Expanded content */}
            {expandedId === profile.id && (
              <div className="px-3 pb-3 space-y-3 border-t border-zinc-100 pt-3">
                {/* Name */}
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

                {/* Keywords */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-600">
                    {t("settings.appProfile.keywords")}
                  </label>
                  <div className="flex flex-wrap gap-1 mb-1">
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

                {/* Apply to Modes */}
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

                {/* Tone Hint */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-600">
                    {t("settings.appProfile.toneHint")}
                  </label>
                  <textarea
                    className="w-full input-field px-2 py-1 text-xs resize-none"
                    rows={2}
                    placeholder={t("settings.appProfile.toneHintPlaceholder")}
                    value={profile.toneHint}
                    onChange={(e) => updateProfile(profile.id, { toneHint: e.target.value })}
                  />
                </div>

                {/* Prompt Appendix */}
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

                {/* Preferred Language */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-600">
                    {t("settings.appProfile.preferredLanguage")}
                  </label>
                  <select
                    className="w-full input-field px-2 py-1 text-xs"
                    value={profile.preferredLanguage}
                    onChange={(e) =>
                      updateProfile(profile.id, {
                        preferredLanguage: e.target.value as PreferredLanguage | "",
                      })
                    }
                  >
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.value === "" ? t("settings.appProfile.useGlobal") : opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Output Mode */}
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

                {/* Direct Paste */}
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

                {/* Delete button */}
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
  );
}
