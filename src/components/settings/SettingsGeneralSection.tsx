import type { KeyboardEvent } from "react";
import type { useI18n } from "../../i18n";
import type { AppLanguage } from "../../store/useAppStore";
import SettingsUpdater from "./SettingsUpdater";

interface SettingsGeneralSectionProps {
  draftLanguage: AppLanguage;
  draftLaunchOnStartup: boolean;
  draftSttEnabled: boolean;
  draftSelectionEnabled: boolean;
  draftScreenshotEnabled: boolean;
  draftHotkey: string;
  draftScreenshotHotkey: string;
  draftWakeWord: string;
  hotkeyStatus: "" | "error";
  hotkeyErrorMessage: string;
  onLanguageChange: (value: AppLanguage) => void;
  onLaunchOnStartupChange: (value: boolean) => void;
  onSttEnabledChange: (value: boolean) => void;
  onSelectionEnabledChange: (value: boolean) => void;
  onScreenshotEnabledChange: (value: boolean) => void;
  onHotkeyChange: (value: string) => void;
  onScreenshotHotkeyChange: (value: string) => void;
  onWakeWordChange: (value: string) => void;
  onClearHotkeyError: () => void;
  t: ReturnType<typeof useI18n>["t"];
}

const HOTKEY_MODIFIERS = ["Control", "Shift", "Alt", "Meta"];

function toHotkeyText(event: KeyboardEvent<HTMLInputElement>): string | null {
  if (HOTKEY_MODIFIERS.includes(event.key)) {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");

  let key = event.key;
  if (event.code === "Backquote" || key === "Dead") key = "Backquote";
  else if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join("+");
}

export default function SettingsGeneralSection({
  draftLanguage,
  draftLaunchOnStartup,
  draftSttEnabled,
  draftSelectionEnabled,
  draftScreenshotEnabled,
  draftHotkey,
  draftScreenshotHotkey,
  draftWakeWord,
  hotkeyStatus,
  hotkeyErrorMessage,
  onLanguageChange,
  onLaunchOnStartupChange,
  onSttEnabledChange,
  onSelectionEnabledChange,
  onScreenshotEnabledChange,
  onHotkeyChange,
  onScreenshotHotkeyChange,
  onWakeWordChange,
  onClearHotkeyError,
  t,
}: SettingsGeneralSectionProps) {
  return (
    <>
      <div className="space-y-1">
        <label className="font-medium">{t("settings.language.label")}</label>
        <select
          className="w-full input-field px-2 py-1"
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
        <p className="text-xs text-gray-400">{t("settings.language.hint")}</p>
      </div>

      <div className="space-y-1">
        <label className="font-medium">{t("settings.launchOnStartup.label")}</label>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={draftLaunchOnStartup}
            onChange={(event) => onLaunchOnStartupChange(event.target.checked)}
          />
          {t("settings.launchOnStartup.hint")}
        </label>
      </div>

      <div className="space-y-2">
        <label className="font-medium">{t("settings.features.title")}</label>
        <p className="text-xs text-gray-500">{t("settings.features.hint")}</p>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={draftSttEnabled}
            onChange={(event) => onSttEnabledChange(event.target.checked)}
          />
          {t("settings.feature.stt")}
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={draftSelectionEnabled}
            onChange={(event) => onSelectionEnabledChange(event.target.checked)}
          />
          {t("settings.feature.selection")}
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={draftScreenshotEnabled}
            onChange={(event) => onScreenshotEnabledChange(event.target.checked)}
          />
          {t("settings.feature.screenshot")}
        </label>
      </div>

      <div className="space-y-1">
        <label className="font-medium">{t("settings.hotkey.label")}</label>
        <input
          className="w-full input-field px-2 py-1"
          value={draftHotkey}
          readOnly
          placeholder={t("settings.hotkey.placeholder")}
          onKeyDown={(event) => {
            event.preventDefault();
            const nextHotkey = toHotkeyText(event);
            if (!nextHotkey) return;
            onHotkeyChange(nextHotkey);
            onClearHotkeyError();
          }}
        />
        <p className="text-xs text-gray-400">{t("settings.hotkey.help")}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onHotkeyChange("Alt+Backquote");
              onClearHotkeyError();
            }}
            className="btn-secondary px-2 py-1 text-xs"
          >
            {t("settings.hotkey.reset")}
          </button>
          <button
            type="button"
            onClick={() => {
              onHotkeyChange("");
              onClearHotkeyError();
            }}
            className="btn-secondary px-2 py-1 text-xs"
          >
            {t("settings.hotkey.clear")}
          </button>
          <span className="text-xs text-gray-400">{t("settings.hotkey.resetHint")}</span>
        </div>
        {!draftHotkey && (
          <p className="text-xs text-amber-700">{t("settings.hotkey.emptyHint")}</p>
        )}
        {hotkeyStatus === "error" && (
          <p className="text-xs text-red-600">
            {hotkeyErrorMessage
              ? t("settings.hotkey.errorWithReason", { reason: hotkeyErrorMessage })
              : t("settings.hotkey.error")}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label className="font-medium">{t("settings.screenshot.label")} Hotkey</label>
        <input
          className="w-full input-field px-2 py-1"
          value={draftScreenshotHotkey}
          readOnly
          onKeyDown={(event) => {
            event.preventDefault();
            const nextHotkey = toHotkeyText(event);
            if (!nextHotkey) return;
            onScreenshotHotkeyChange(nextHotkey);
            onClearHotkeyError();
          }}
        />
        <p className="text-xs text-gray-400">{t("settings.screenshot.hint")}（可自訂）</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onScreenshotHotkeyChange("");
              onClearHotkeyError();
            }}
            className="btn-secondary px-2 py-1 text-xs"
          >
            {t("settings.hotkey.clear")}
          </button>
          {!draftScreenshotHotkey && (
            <span className="text-xs text-amber-700">{t("settings.hotkey.emptyHint")}</span>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className="font-medium">{t("settings.wakeWord.label")}</label>
        <input
          className="w-full input-field px-2 py-1"
          value={draftWakeWord}
          onChange={(event) => onWakeWordChange(event.target.value)}
          placeholder={t("settings.wakeWord.placeholder")}
        />
        <p className="text-xs text-gray-400">{t("settings.wakeWord.hint")}</p>
      </div>

      <SettingsUpdater t={t} />
    </>
  );
}
