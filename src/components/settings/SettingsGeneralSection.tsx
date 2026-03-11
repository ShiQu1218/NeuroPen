import type { useI18n } from "../../i18n";
import type { AppLanguage } from "../../store/useAppStore";
import SettingsUpdater from "./SettingsUpdater";

interface SettingsGeneralSectionProps {
  draftLanguage: AppLanguage;
  draftLaunchOnStartup: boolean;
  draftSttEnabled: boolean;
  draftSelectionEnabled: boolean;
  draftScreenshotEnabled: boolean;
  onLanguageChange: (value: AppLanguage) => void;
  onLaunchOnStartupChange: (value: boolean) => void;
  onSttEnabledChange: (value: boolean) => void;
  onSelectionEnabledChange: (value: boolean) => void;
  onScreenshotEnabledChange: (value: boolean) => void;
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsGeneralSection({
  draftLanguage,
  draftLaunchOnStartup,
  draftSttEnabled,
  draftSelectionEnabled,
  draftScreenshotEnabled,
  onLanguageChange,
  onLaunchOnStartupChange,
  onSttEnabledChange,
  onSelectionEnabledChange,
  onScreenshotEnabledChange,
  t,
}: SettingsGeneralSectionProps) {
  return (
    <div className="space-y-4">
      <div className="settings-card space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1">
            <label className="font-medium">{t("settings.language.label")}</label>
            <select
              className="w-full input-field px-3 py-2"
              value={draftLanguage}
              onChange={(event) => onLanguageChange(event.target.value as AppLanguage)}
            >
              <option value="zh-TW">{t("settings.language.zh-TW")}</option>
              <option value="zh-CN">{t("settings.language.zh-CN")}</option>
              <option value="en-US">{t("settings.language.en-US")}</option>
              <option value="ja-JP">{t("settings.language.ja-JP")}</option>
              <option value="es-ES">{t("settings.language.es-ES")}</option>
              <option value="ko-KR">{t("settings.language.ko-KR")}</option>
              <option value="de-DE">{t("settings.language.de-DE")}</option>
              <option value="fr-FR">{t("settings.language.fr-FR")}</option>
              <option value="ar-SA">{t("settings.language.ar-SA")}</option>
              <option value="ru-RU">{t("settings.language.ru-RU")}</option>
            </select>
            <p className="text-xs text-zinc-500">{t("settings.language.hint")}</p>
          </div>

          <div className="space-y-1">
            <label className="font-medium">{t("settings.launchOnStartup.label")}</label>
            <label className="flex min-h-[42px] items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={draftLaunchOnStartup}
                onChange={(event) => onLaunchOnStartupChange(event.target.checked)}
              />
              {t("settings.launchOnStartup.hint")}
            </label>
          </div>
        </div>
      </div>

      <div className="settings-card space-y-3">
        <div>
          <label className="font-medium">{t("settings.features.title")}</label>
          <p className="mt-1 text-xs text-zinc-500">{t("settings.features.hint")}</p>
        </div>
        <div className="grid gap-2 lg:grid-cols-3">
          <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={draftSttEnabled}
              onChange={(event) => onSttEnabledChange(event.target.checked)}
            />
            {t("settings.feature.stt")}
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={draftSelectionEnabled}
              onChange={(event) => onSelectionEnabledChange(event.target.checked)}
            />
            {t("settings.feature.selection")}
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={draftScreenshotEnabled}
              onChange={(event) => onScreenshotEnabledChange(event.target.checked)}
            />
            {t("settings.feature.screenshot")}
          </label>
        </div>
      </div>
      <div className="settings-card">
        <SettingsUpdater t={t} />
      </div>
    </div>
  );
}
