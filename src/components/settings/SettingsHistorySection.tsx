import { useCallback, useEffect, useState } from "react";
import { mainWindowService } from "../../services/mainWindowService";
import HistoryPanel from "../HistoryPanel";
import type { useI18n } from "../../i18n";
import type { PreferenceSummaryView } from "../../utils/preferenceLearning";

interface SettingsHistorySectionProps {
  draftHistoryEnabled: boolean;
  draftPreferenceLearningEnabled: boolean;
  onToggleHistory: () => void;
  onTogglePreferenceLearning: () => void;
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsHistorySection({
  draftHistoryEnabled,
  draftPreferenceLearningEnabled,
  onToggleHistory,
  onTogglePreferenceLearning,
  t,
}: SettingsHistorySectionProps) {
  const [summaries, setSummaries] = useState<PreferenceSummaryView[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyCategoryKey, setBusyCategoryKey] = useState("");

  const loadSummaries = useCallback(async () => {
    setIsLoading(true);
    try {
      setSummaries(await mainWindowService.preferenceListSummaries());
    } catch (error) {
      console.error("[Settings] preference_list_summaries failed:", error);
      setSummaries([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummaries();
  }, [loadSummaries]);

  const handleClearSummary = async (categoryKey: string) => {
    setBusyCategoryKey(categoryKey);
    try {
      await mainWindowService.preferenceClearSummary(categoryKey);
      await loadSummaries();
    } finally {
      setBusyCategoryKey("");
    }
  };

  const handleClearAll = async () => {
    setBusyCategoryKey("__all__");
    try {
      await mainWindowService.preferenceClearAll();
      await loadSummaries();
    } finally {
      setBusyCategoryKey("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="settings-card space-y-3">
        <div className="flex items-center gap-3">
          <label className="font-medium">{t("settings.history.enable")}</label>
          <button
            onClick={onToggleHistory}
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
      <div className="settings-card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <label className="font-medium">{t("settings.preference.enable")}</label>
            <button
              onClick={onTogglePreferenceLearning}
              className={`relative h-5 w-10 rounded-full transition-colors ${draftPreferenceLearningEnabled ? "bg-blue-500" : "bg-gray-300"}`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${draftPreferenceLearningEnabled ? "translate-x-5" : ""}`}
              />
            </button>
          </div>
          <button
            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={busyCategoryKey === "__all__" || summaries.length === 0}
            onClick={() => void handleClearAll()}
          >
            {t("settings.preference.clearAll")}
          </button>
        </div>
        <p className="text-xs text-zinc-500">{t("settings.preference.hint")}</p>
        {isLoading ? (
          <p className="text-xs text-zinc-400">{t("settings.preference.loading")}</p>
        ) : summaries.length === 0 ? (
          <p className="text-xs text-zinc-400">{t("settings.preference.empty")}</p>
        ) : (
          <div className="space-y-2">
            {summaries.map((summary) => (
              <div
                key={summary.categoryKey}
                className="rounded-xl border border-zinc-200 bg-white/80 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-800 truncate">
                      {summary.categoryLabel}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {t("settings.preference.pendingCount", { count: String(summary.pendingCount) })}
                      {" · "}
                      {summary.updatedAt
                        ? t("settings.preference.updatedAt", {
                            value: new Date(summary.updatedAt * 1000).toLocaleString(),
                          })
                        : t("settings.preference.notAnalyzedYet")}
                    </div>
                  </div>
                  <button
                    className="text-[11px] text-red-500 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={busyCategoryKey === summary.categoryKey}
                    onClick={() => void handleClearSummary(summary.categoryKey)}
                  >
                    {t("settings.preference.clearCategory")}
                  </button>
                </div>
                {summary.summary ? (
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-600">
                    {summary.summary}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-zinc-400">
                    {t("settings.preference.pendingOnly")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <HistoryPanel />
    </div>
  );
}
