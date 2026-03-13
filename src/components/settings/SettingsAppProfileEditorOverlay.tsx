import { useEffect, useState } from "react";
import type { TranslationKey } from "../../i18n";
import type {
  AppProfile,
  AppProfileMode,
  CustomLanguageVariant,
  OutputMode,
} from "../../store/useAppStore";
import { getLanguageVariantSelectionSummary } from "../../utils/languageVariants";
import SettingsToggle from "./SettingsToggle";

const ALL_MODES: AppProfileMode[] = ["A", "B1", "B2", "C"];

const OUTPUT_MODE_OPTIONS: Array<{ value: OutputMode | ""; labelKey: TranslationKey }> = [
  { value: "", labelKey: "settings.appProfile.useGlobal" },
  { value: "PreviewStream", labelKey: "settings.llm.previewStream" },
  { value: "DirectInject", labelKey: "settings.llm.directInject" },
];

interface SettingsAppProfileEditorOverlayProps {
  profile: AppProfile;
  customLanguageVariants: CustomLanguageVariant[];
  promptDraft: { toneHint: string; promptAppendix: string };
  onClose: () => void;
  onDelete: () => void;
  onImmediateChange: (patch: Partial<AppProfile>) => void;
  onPromptDraftChange: (patch: { toneHint?: string; promptAppendix?: string }) => void;
  onSavePromptFields: () => void | Promise<void>;
  onOpenLanguageVariantPicker: () => void;
  t: (key: TranslationKey, params?: Record<string, string>) => string;
}

export default function SettingsAppProfileEditorOverlay({
  profile,
  customLanguageVariants,
  promptDraft,
  onClose,
  onDelete,
  onImmediateChange,
  onPromptDraftChange,
  onSavePromptFields,
  onOpenLanguageVariantPicker,
  t,
}: SettingsAppProfileEditorOverlayProps) {
  const [keywordInput, setKeywordInput] = useState("");

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const languageSummary = getLanguageVariantSelectionSummary(
    profile.preferredLanguage,
    customLanguageVariants,
    {
      emptyLabel: t("settings.appProfile.useGlobal"),
      globalLabel: t("settings.appProfile.useGlobal"),
      countLabel: (count) => t("settings.languageVariant.profileSummary", { count: String(count) }),
    },
  );

  const handleAddKeyword = () => {
    const nextKeyword = keywordInput.trim();
    if (!nextKeyword || profile.keywords.includes(nextKeyword)) {
      return;
    }
    onImmediateChange({ keywords: [...profile.keywords, nextKeyword] });
    setKeywordInput("");
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(17,24,39,0.24)] px-6 py-8 backdrop-blur-sm">
      <div className="absolute inset-0" aria-hidden="true" onClick={onClose} />
      <section className="relative z-10 flex h-full max-h-[840px] w-full max-w-[920px] flex-col overflow-hidden rounded-[28px] border border-white/70 bg-[#fbf8f2] shadow-[0_30px_100px_rgba(15,23,42,0.18)]">
        <div className="flex items-start justify-between gap-4 border-b border-black/5 px-6 py-5">
          <div>
            <h2 className="text-[28px] font-semibold tracking-tight text-zinc-900">
              {profile.name || t("settings.appProfile.namePlaceholder")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/5 bg-white/80 text-xl text-zinc-500 transition hover:bg-white hover:text-zinc-900"
            aria-label={t("settings.cancel")}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(300px,0.92fr)]">
            <div className="space-y-4">
              <section className="rounded-[22px] border border-black/5 bg-white/85 p-4 shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      {t("settings.appProfile.name")}
                    </label>
                    <input
                      className="settings-input-compact mt-1.5"
                      value={profile.name}
                      onChange={(event) => onImmediateChange({ name: event.target.value })}
                      placeholder={t("settings.appProfile.namePlaceholder")}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      {t("settings.appProfile.enabled")}
                    </label>
                    <div className="mt-1.5 flex h-10 items-center justify-between rounded-2xl border border-zinc-200 bg-[#fcfbf8] px-3">
                      <span className="text-sm text-zinc-700">
                        {profile.enabled ? "已啟用" : "已停用"}
                      </span>
                      <SettingsToggle
                        checked={profile.enabled}
                        onChange={(nextValue) => onImmediateChange({ enabled: nextValue })}
                        ariaLabel={t("settings.appProfile.enabled")}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-[22px] border border-black/5 bg-white/85 p-4 shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
                <p className="text-sm font-medium text-zinc-900">{t("settings.appProfile.keywords")}</p>
                <div className="mt-3 flex gap-2">
                  <input
                    className="settings-input-compact flex-1"
                    value={keywordInput}
                    onChange={(event) => setKeywordInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAddKeyword();
                      }
                    }}
                    placeholder={t("settings.appProfile.keywordPlaceholder")}
                  />
                  <button type="button" onClick={handleAddKeyword} className="btn-primary px-4 py-2 text-sm">
                    新增
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {profile.keywords.length === 0 ? (
                    <span className="text-sm text-zinc-400">尚未設定關鍵字</span>
                  ) : (
                    profile.keywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-[#fcfbf8] px-3 py-1.5 text-sm text-zinc-700"
                      >
                        {keyword}
                        <button
                          type="button"
                          onClick={() =>
                            onImmediateChange({
                              keywords: profile.keywords.filter((item) => item !== keyword),
                            })
                          }
                          className="text-zinc-400 transition hover:text-red-500"
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-[22px] border border-black/5 bg-white/85 p-4 shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
                <p className="text-sm font-medium text-zinc-900">
                  {t("settings.appProfile.applyToModes")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {ALL_MODES.map((mode) => {
                    const active = profile.applyToModes.includes(mode);
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() =>
                          onImmediateChange({
                            applyToModes: active
                              ? profile.applyToModes.filter((item) => item !== mode)
                              : [...profile.applyToModes, mode],
                          })
                        }
                        className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                          active
                            ? "bg-zinc-900 text-white"
                            : "border border-zinc-200 bg-[#fcfbf8] text-zinc-700 hover:border-zinc-300"
                        }`}
                      >
                        {mode}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="space-y-4">
              <section className="rounded-[22px] border border-black/5 bg-white/85 p-4 shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      {t("settings.languageVariant.label")}
                    </label>
                    <button
                      type="button"
                      onClick={onOpenLanguageVariantPicker}
                      className="mt-1.5 flex h-10 w-full items-center justify-between rounded-2xl border border-zinc-200 bg-[#fcfbf8] px-3 text-left text-sm font-medium text-zinc-800 transition hover:border-zinc-300 hover:bg-white"
                    >
                      <span className="truncate">{languageSummary}</span>
                      <span className="ml-3 text-zinc-400">▾</span>
                    </button>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      {t("settings.appProfile.outputMode")}
                    </label>
                    <select
                      className="settings-input-compact mt-1.5"
                      value={profile.outputMode}
                      onChange={(event) =>
                        onImmediateChange({ outputMode: event.target.value as OutputMode | "" })
                      }
                    >
                      {OUTPUT_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(option.labelKey)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      {t("settings.appProfile.directPaste")}
                    </label>
                    <select
                      className="settings-input-compact mt-1.5"
                      value={profile.directPaste === null ? "" : profile.directPaste ? "true" : "false"}
                      onChange={(event) => {
                        const value = event.target.value;
                        onImmediateChange({
                          directPaste: value === "" ? null : value === "true",
                        });
                      }}
                    >
                      <option value="">{t("settings.appProfile.useGlobal")}</option>
                      <option value="true">{t("settings.appProfile.directPasteYes")}</option>
                      <option value="false">{t("settings.appProfile.directPasteNo")}</option>
                    </select>
                  </div>
                </div>
              </section>

              <section className="rounded-[22px] border border-black/5 bg-white/85 p-4 shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">Prompt</p>
                  </div>
                  <button type="button" onClick={() => void onSavePromptFields()} className="btn-primary px-4 py-2 text-sm">
                    儲存
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      {t("settings.appProfile.toneHint")}
                    </label>
                    <input
                      className="settings-input-compact mt-1.5"
                      value={promptDraft.toneHint}
                      onChange={(event) => onPromptDraftChange({ toneHint: event.target.value })}
                      placeholder={t("settings.appProfile.toneHintPlaceholder")}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">
                      {t("settings.appProfile.promptAppendix")}
                    </label>
                    <textarea
                      className="input-field mt-1.5 min-h-[120px] w-full px-3 py-2 text-sm leading-6"
                      value={promptDraft.promptAppendix}
                      onChange={(event) =>
                        onPromptDraftChange({ promptAppendix: event.target.value })
                      }
                      placeholder={t("settings.appProfile.promptAppendixPlaceholder")}
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-[22px] border border-red-200 bg-red-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-red-700">危險操作</p>
                    <p className="mt-1 text-xs text-red-600">
                      刪除後會立即從設定清單移除。
                    </p>
                  </div>
                  <button type="button" onClick={onDelete} className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100">
                    {t("settings.appProfile.delete")}
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
