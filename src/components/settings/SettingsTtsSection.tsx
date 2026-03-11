import type { useI18n } from "../../i18n";
import type { LocalTtsModel, ModelDownloadProgressEvent } from "./settingsShared";

interface SettingsTtsSectionProps {
  draftTtsPitch: string;
  draftTtsRate: string;
  draftTtsVoice: string;
  localTtsModels: LocalTtsModel[];
  localTtsModelsLoading: boolean;
  ttsModelBusyId: string;
  ttsModelBusyAction: "" | "install" | "delete" | "select";
  ttsModelDownloadProgress: Record<string, ModelDownloadProgressEvent>;
  failedTtsDownloadModelId: string;
  ttsModelStatus: { type: "" | "success" | "error"; message: string };
  formatBytes: (bytes?: number) => string;
  onPitchChange: (value: string) => void;
  onRateChange: (value: string) => void;
  onVoiceChange: (value: string) => void;
  onInstallModel: (modelId: string) => void | Promise<unknown>;
  onCancelDownload: () => void | Promise<unknown>;
  onDeleteModel: (modelId: string) => void | Promise<unknown>;
  onSelectModel: (modelId: string) => void | Promise<unknown>;
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsTtsSection({
  draftTtsPitch,
  draftTtsRate,
  draftTtsVoice,
  localTtsModels,
  localTtsModelsLoading,
  ttsModelBusyId,
  ttsModelBusyAction,
  ttsModelDownloadProgress,
  failedTtsDownloadModelId,
  ttsModelStatus,
  formatBytes,
  onPitchChange,
  onRateChange,
  onVoiceChange,
  onInstallModel,
  onCancelDownload,
  onDeleteModel,
  onSelectModel,
  t,
}: SettingsTtsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="rounded border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{t("settings.tts.modelManager")}</h3>
            <p className="mt-1 text-xs text-gray-500">{t("settings.tts.modelManagerHint")}</p>
          </div>
        </div>

        {ttsModelStatus.message && (
          <div
            className={`mt-3 rounded px-3 py-2 text-xs ${
              ttsModelStatus.type === "error"
                ? "bg-red-50 text-red-600"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {ttsModelStatus.message}
          </div>
        )}

        <div className="mt-3 space-y-3">
          {localTtsModelsLoading && (
            <div className="rounded border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">
              {t("settings.tts.loadingModels")}
            </div>
          )}

          {!localTtsModelsLoading && localTtsModels.map((model) => {
            const isBusy = ttsModelBusyId === model.id;
            const downloadProgress = ttsModelDownloadProgress[model.id];
            const isInstalling = isBusy && ttsModelBusyAction === "install";
            const isDeleting = isBusy && ttsModelBusyAction === "delete";
            const isSelecting = isBusy && ttsModelBusyAction === "select";
            const isDownloadActive =
              downloadProgress?.status === "start" || downloadProgress?.status === "downloading";
            const progressPct = Math.max(0, Math.min(100, Math.round(downloadProgress?.progressPct ?? 0)));
            const isSelected = draftTtsVoice === model.modelPath || (!draftTtsVoice && model.active);

            return (
              <div key={model.id} className="rounded border border-gray-200 bg-gray-50 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-gray-900">{model.name}</h4>
                      {isSelected && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          {t("settings.tts.activeNow")}
                        </span>
                      )}
                      {model.installed && !isSelected && (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                          {t("settings.stt.installed")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{model.description}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-[11px] text-gray-600">
                  <span className="rounded-full bg-white px-2 py-1 border border-gray-200">
                    {t("settings.tts.language")}: {model.language}
                  </span>
                  <span className="rounded-full bg-white px-2 py-1 border border-gray-200">
                    {t("settings.tts.quality")}: {model.quality}
                  </span>
                  <span className="rounded-full bg-white px-2 py-1 border border-gray-200">
                    {t("settings.tts.speakers")}: {model.speakerCount}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {!model.installed ? (
                    <>
                      <button
                        onClick={() => void onInstallModel(model.id)}
                        disabled={!!ttsModelBusyId}
                        className="px-2.5 py-1 rounded text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {isDownloadActive || isInstalling
                          ? `${t("settings.tts.installing")} ${progressPct}%`
                          : failedTtsDownloadModelId === model.id
                            ? t("settings.tts.retry")
                            : t("settings.tts.install")}
                      </button>
                      {(isDownloadActive || isInstalling) && (
                        <button
                          onClick={() => void onCancelDownload()}
                          className="px-2.5 py-1 rounded text-xs font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 transition-colors"
                        >
                          {t("settings.cancel")}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => void onSelectModel(model.id)}
                        disabled={!!ttsModelBusyId || isSelected}
                        className="px-2.5 py-1 rounded text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {isSelected
                          ? t("settings.tts.activeNow")
                          : isSelecting
                            ? t("settings.stt.switching")
                            : t("settings.tts.useModel")}
                      </button>
                      <button
                        onClick={() => void onDeleteModel(model.id)}
                        disabled={!!ttsModelBusyId}
                        className="btn-danger px-2.5 py-1 rounded text-xs"
                      >
                        {isDeleting ? t("settings.tts.deleting") : t("settings.tts.delete")}
                      </button>
                    </>
                  )}
                </div>

                {downloadProgress && (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full overflow-hidden rounded bg-gray-200">
                      <div
                        className={`h-full transition-all ${
                          downloadProgress.status === "error"
                            ? "bg-red-500"
                            : downloadProgress.status === "cancelled"
                              ? "bg-amber-500"
                              : "bg-blue-500"
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-gray-500">
                      <span>{progressPct}%</span>
                      <span>
                        {formatBytes(downloadProgress.downloadedBytes)} / {formatBytes(downloadProgress.totalBytes)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium">{t("settings.tts.manualModel")}</label>
        <input
          className="w-full input-field px-2.5 py-1.5 text-sm mt-1"
          placeholder="C:\\Users\\you\\.neuropen\\piper\\models\\en-us-lessac-medium\\en_US-lessac-medium.onnx"
          value={draftTtsVoice}
          onChange={(event) => onVoiceChange(event.target.value)}
        />
        <p className="text-[11px] text-zinc-500 mt-0.5">{t("settings.tts.manualModelHint")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium">{t("settings.tts.rate")}</label>
          <input
            className="w-full input-field px-2.5 py-1.5 text-sm mt-1"
            placeholder="+0%"
            value={draftTtsRate}
            onChange={(event) => onRateChange(event.target.value)}
          />
          <p className="text-[11px] text-zinc-500 mt-0.5">{t("settings.tts.rateHint")}</p>
        </div>
        <div>
          <label className="text-xs font-medium">{t("settings.tts.speaker")}</label>
          <input
            className="w-full input-field px-2.5 py-1.5 text-sm mt-1"
            placeholder="0"
            value={draftTtsPitch}
            onChange={(event) => onPitchChange(event.target.value)}
          />
          <p className="text-[11px] text-zinc-500 mt-0.5">{t("settings.tts.speakerHint")}</p>
        </div>
      </div>
    </div>
  );
}
