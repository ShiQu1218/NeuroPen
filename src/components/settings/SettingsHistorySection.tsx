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
      <div className="flex items-center gap-3">
        <label className="font-medium">{t("settings.history.enable")}</label>
        <button
          onClick={onToggle}
          className={`relative w-10 h-5 rounded-full transition-colors ${draftHistoryEnabled ? "bg-blue-500" : "bg-gray-300"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${draftHistoryEnabled ? "translate-x-5" : ""}`}
          />
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        {t("settings.history.hint")}
      </p>
      <HistoryPanel />
    </div>
  );
}
