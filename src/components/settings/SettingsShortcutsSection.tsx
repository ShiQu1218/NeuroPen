import type { KeyboardEvent } from "react";
import type { useI18n } from "../../i18n";

interface SettingsShortcutsSectionProps {
  draftHotkey: string;
  draftScreenshotHotkey: string;
  draftDialogHotkey: string;
  hotkeyStatus: "" | "error";
  hotkeyErrorMessage: string;
  onHotkeyChange: (value: string) => void;
  onScreenshotHotkeyChange: (value: string) => void;
  onDialogHotkeyChange: (value: string) => void;
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

export default function SettingsShortcutsSection({
  draftHotkey,
  draftScreenshotHotkey,
  draftDialogHotkey,
  hotkeyStatus,
  hotkeyErrorMessage,
  onHotkeyChange,
  onScreenshotHotkeyChange,
  onDialogHotkeyChange,
  onClearHotkeyError,
  t,
}: SettingsShortcutsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="settings-card space-y-4">
        <div className="space-y-1">
          <label className="font-medium">{t("settings.hotkey.label")}</label>
          <input
            className="w-full input-field px-3 py-2"
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
          <p className="text-xs text-zinc-500">{t("settings.hotkey.help")}</p>
          <div className="flex flex-wrap items-center gap-2">
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
            <span className="text-xs text-zinc-500">{t("settings.hotkey.resetHint")}</span>
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
      </div>

      <div className="settings-card space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1">
            <label className="font-medium">{t("settings.screenshot.hotkeyLabel")}</label>
            <input
              className="w-full input-field px-3 py-2"
              value={draftScreenshotHotkey}
              readOnly
              placeholder={t("settings.hotkey.placeholder")}
              onKeyDown={(event) => {
                event.preventDefault();
                const nextHotkey = toHotkeyText(event);
                if (!nextHotkey) return;
                onScreenshotHotkeyChange(nextHotkey);
                onClearHotkeyError();
              }}
            />
            <p className="text-xs text-zinc-500">{t("settings.screenshot.hint")}</p>
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
            <label className="font-medium">{t("settings.dialog.hotkeyLabel")}</label>
            <input
              className="w-full input-field px-3 py-2"
              value={draftDialogHotkey}
              readOnly
              placeholder={t("settings.hotkey.placeholder")}
              onKeyDown={(event) => {
                event.preventDefault();
                const nextHotkey = toHotkeyText(event);
                if (!nextHotkey) return;
                onDialogHotkeyChange(nextHotkey);
                onClearHotkeyError();
              }}
            />
            <p className="text-xs text-zinc-500">{t("settings.dialog.hint")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onDialogHotkeyChange("Alt+Shift+D");
                  onClearHotkeyError();
                }}
                className="btn-secondary px-2 py-1 text-xs"
              >
                {t("settings.dialog.reset")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDialogHotkeyChange("");
                  onClearHotkeyError();
                }}
                className="btn-secondary px-2 py-1 text-xs"
              >
                {t("settings.hotkey.clear")}
              </button>
              {!draftDialogHotkey && (
                <span className="text-xs text-amber-700">{t("settings.hotkey.emptyHint")}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
