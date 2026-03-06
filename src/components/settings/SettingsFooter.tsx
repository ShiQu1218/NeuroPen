import type { useI18n } from "../../i18n";

interface SettingsFooterProps {
  hasSettingsChanges: boolean;
  onCancel: () => void;
  onSave: () => void;
  settingsSaveStatus: "" | "saved" | "error";
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsFooter({
  hasSettingsChanges,
  onCancel,
  onSave,
  settingsSaveStatus,
  t,
}: SettingsFooterProps) {
  return (
    <div className="pt-3 mt-3 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
      {settingsSaveStatus === "saved" && (
        <p className="text-xs text-green-600">{t("settings.saveApplied")}</p>
      )}
      {settingsSaveStatus === "error" && (
        <p className="text-xs text-red-600">{t("settings.saveError")}</p>
      )}
      <button
        onClick={onCancel}
        disabled={!hasSettingsChanges}
        className="btn-secondary px-3.5 py-1.5 text-xs"
      >
        {t("settings.cancel")}
      </button>
      <button
        onClick={onSave}
        disabled={!hasSettingsChanges}
        className="btn-primary px-3.5 py-1.5 text-xs"
      >
        {t("settings.save")}
      </button>
    </div>
  );
}
