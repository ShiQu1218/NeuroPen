import HistoryPanel from "../HistoryPanel";
import type { useI18n } from "../../i18n";

interface SettingsHistorySectionProps {
  draftHistoryEnabled: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsHistorySection({
  draftHistoryEnabled,
  onToggle,
  t,
}: SettingsHistorySectionProps) {
  return (
    <div className="space-y-4">
      <div className="settings-card space-y-3">
        <div className="flex items-center gap-3">
          <label className="font-medium">{t("settings.history.enable")}</label>
          <button
            onClick={onToggle}
            className={`relative h-5 w-10 rounded-full transition-colors ${draftHistoryEnabled ? "bg-blue-500" : "bg-gray-300"}`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${draftHistoryEnabled ? "translate-x-5" : ""}`}
            />
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          {t("settings.history.hint")}
        </p>
      </div>
      <HistoryPanel />
    </div>
  );
}
