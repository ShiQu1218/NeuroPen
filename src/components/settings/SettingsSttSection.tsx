import type { useI18n } from "../../i18n";
import type {
  PunctuationMode,
  SttLanguage,
  SttOutputStrategy,
  TranslationTarget,
} from "../../store/useAppStore";
import {
  OPENAI_STT_MODEL,
  RATING_INDICES,
  type LocalSttModel,
  type ModelDownloadProgressEvent,
} from "./settingsShared";

interface SettingsSttSectionProps {
  draftWakeWord: string;
  draftSttEnabled: boolean;
  draftSttModelChoice: string;
  draftSttLanguage: SttLanguage;
  draftMicrophoneSource: string;
  draftTranslationTarget: TranslationTarget;
  draftSttOutputStrategy: SttOutputStrategy;
  draftPunctuationMode: PunctuationMode;
  draftVocabularyTerms: string;
  audioDevices: string[];
  audioDevicesLoading: boolean;
  localSttAvailable: boolean;
  localModels: LocalSttModel[];
  localModelsLoading: boolean;
  localModelBusyId: string;
  localModelBusyAction: "" | "install" | "delete";
  localModelDownloadProgress: Record<string, ModelDownloadProgressEvent>;
  failedDownloadModelId: string;
  localModelStatus: { type: "" | "success" | "error"; message: string };
  sttApiKeyInput: string;
  sttApiKeySet: boolean;
  sttApiKeySaveStatus: "" | "saving" | "saved" | "error";
  formatBytes: (bytes?: number) => string;
  getLocalizedModelName: (model: LocalSttModel) => string;
  getLocalizedModelDescription: (model: LocalSttModel) => string;
  onWakeWordChange: (value: string) => void;
  onSttModelChoiceChange: (value: string) => void;
  onSttLanguageChange: (value: SttLanguage) => void;
  onMicrophoneSourceChange: (value: string) => void;
  onSttApiKeyInputChange: (value: string) => void;
  onSaveSttApiKey: () => void;
  onSttOutputStrategyChange: (value: SttOutputStrategy) => void;
  onTranslationTargetChange: (value: TranslationTarget) => void;
  onPunctuationModeChange: (value: PunctuationMode) => void;
  onVocabularyTermsChange: (value: string) => void;
  onImportVocabularyFile: (file: File | null) => void | Promise<unknown>;
  onInstallLocalModel: (modelId: string) => void | Promise<unknown>;
  onCancelLocalModelDownload: () => void | Promise<unknown>;
  onDeleteLocalModel: (modelId: string) => void | Promise<unknown>;
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsSttSection({
  draftWakeWord,
  draftSttEnabled,
  draftSttModelChoice,
  draftSttLanguage,
  draftMicrophoneSource,
  draftTranslationTarget,
  draftSttOutputStrategy,
  draftPunctuationMode,
  draftVocabularyTerms,
  audioDevices,
  audioDevicesLoading,
  localSttAvailable,
  localModels,
  localModelsLoading,
  localModelBusyId,
  localModelBusyAction,
  localModelDownloadProgress,
  failedDownloadModelId,
  localModelStatus,
  sttApiKeyInput,
  sttApiKeySet,
  sttApiKeySaveStatus,
  formatBytes,
  getLocalizedModelName,
  getLocalizedModelDescription,
  onWakeWordChange,
  onSttModelChoiceChange,
  onSttLanguageChange,
  onMicrophoneSourceChange,
  onSttApiKeyInputChange,
  onSaveSttApiKey,
  onSttOutputStrategyChange,
  onTranslationTargetChange,
  onPunctuationModeChange,
  onVocabularyTermsChange,
  onImportVocabularyFile,
  onInstallLocalModel,
  onCancelLocalModelDownload,
  onDeleteLocalModel,
  t,
}: SettingsSttSectionProps) {
  return (
    <div className="space-y-4">
      {!draftSttEnabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("settings.stt.disabledHint")}
        </div>
      )}

      <div className="settings-card space-y-4">
        <div className="space-y-1">
          <label className="font-medium">{t("settings.wakeWord.label")}</label>
          <input
            className="w-full input-field px-3 py-2"
            value={draftWakeWord}
            onChange={(event) => onWakeWordChange(event.target.value)}
            placeholder={t("settings.wakeWord.placeholder")}
          />
          <p className="text-xs text-zinc-500">{t("settings.wakeWord.hint")}</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1">
            <label className="font-medium">{t("settings.stt.modelLabel")}</label>
            <select
              className="w-full input-field px-3 py-2"
              value={draftSttModelChoice}
              onChange={(event) => onSttModelChoiceChange(event.target.value)}
            >
              <option value={OPENAI_STT_MODEL}>OpenAI Whisper API{t("settings.stt.modelCloud")}</option>
              {localModels.filter((model) => model.installed).map((model) => (
                <option key={model.id} value={model.id}>
                  {getLocalizedModelName(model)}
                  {t("settings.stt.modelLocal")}
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500">{t("settings.stt.modelHint")}</p>
          </div>

          <div className="space-y-1">
            <label className="font-medium">{t("settings.stt.language.label")}</label>
            <select
              className="w-full input-field px-3 py-2"
              value={draftSttLanguage}
              onChange={(event) => onSttLanguageChange(event.target.value as SttLanguage)}
            >
              <option value="auto">{t("settings.stt.language.auto")}</option>
              <option value="en">English</option>
              <option value="zh">中文</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="de">Deutsch</option>
              <option value="fr">Français</option>
              <option value="es">Español</option>
              <option value="ru">Русский</option>
              <option value="ar">العربية</option>
            </select>
            <p className="text-xs text-zinc-500">{t("settings.stt.language.hint")}</p>
          </div>
        </div>

        <div className="space-y-1">
          <label className="font-medium">{t("settings.stt.microphoneSource")}</label>
          <select
            className="w-full input-field px-3 py-2"
            value={draftMicrophoneSource}
            onChange={(event) => onMicrophoneSourceChange(event.target.value)}
            disabled={audioDevicesLoading}
          >
            <option value="">{t("settings.stt.defaultMicrophone")}</option>
            {audioDevices.map((device) => (
              <option key={device} value={device}>
                {device}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500">{t("settings.stt.microphoneHint")}</p>
        </div>

        {draftSttModelChoice === OPENAI_STT_MODEL && (
          <div className="space-y-1">
            <label className="font-medium">{t("settings.stt.sttApiKeyLabel")}</label>
            {sttApiKeySet && (
              <p className="text-xs text-green-600">{t("settings.stt.sttApiKeySet")}</p>
            )}
            <div className="flex gap-2">
              <input
                type="password"
                className="flex-1 input-field px-3 py-2 font-mono text-xs"
                value={sttApiKeyInput}
                onChange={(event) => onSttApiKeyInputChange(event.target.value)}
                placeholder={sttApiKeySet ? "••••••••" : t("settings.stt.sttApiKeyPlaceholder")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && sttApiKeyInput) onSaveSttApiKey();
                }}
              />
              <button
                onClick={onSaveSttApiKey}
                disabled={!sttApiKeyInput || sttApiKeySaveStatus === "saving"}
                className="btn-primary px-3 py-2 text-xs"
              >
                {sttApiKeySaveStatus === "saving" ? t("settings.llm.saving") : t("settings.llm.save")}
              </button>
            </div>
            {sttApiKeySaveStatus === "saved" && (
              <p className="text-xs text-green-600">{t("settings.stt.sttApiKeySaved")}</p>
            )}
            {sttApiKeySaveStatus === "error" && (
              <p className="text-xs text-red-600">{t("settings.stt.sttApiKeySaveFailed")}</p>
            )}
          </div>
        )}
      </div>

      <div className="settings-card space-y-4">
        <div className="space-y-1">
          <label className="font-medium">{t("settings.stt.outputStrategy")}</label>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="sttOutputStrategy"
                value="raw"
                checked={draftSttOutputStrategy === "raw"}
                onChange={() => {
                  onSttOutputStrategyChange("raw");
                  onTranslationTargetChange("off");
                }}
              />
              {t("settings.stt.outputRaw")}
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="sttOutputStrategy"
                value="llmRefine"
                checked={draftSttOutputStrategy === "llmRefine"}
                onChange={() => onSttOutputStrategyChange("llmRefine")}
              />
              {t("settings.stt.outputLlmRefine")}
            </label>
          </div>
        </div>

        <div className="space-y-1">
          <label className="font-medium">{t("settings.translation.label")}</label>
          <select
            className="w-full input-field px-3 py-2"
            value={draftTranslationTarget}
            onChange={(event) => onTranslationTargetChange(event.target.value as TranslationTarget)}
            disabled={draftSttOutputStrategy !== "llmRefine"}
          >
            <option value="off">{t("settings.translation.off")}</option>
            <option value="en-US">{t("settings.language.en-US")}</option>
            <option value="zh-TW">{t("settings.language.zh-TW")}</option>
            <option value="zh-CN">{t("settings.language.zh-CN")}</option>
            <option value="ja-JP">{t("settings.language.ja-JP")}</option>
            <option value="ko-KR">{t("settings.language.ko-KR")}</option>
            <option value="es-ES">{t("settings.language.es-ES")}</option>
            <option value="de-DE">{t("settings.language.de-DE")}</option>
            <option value="fr-FR">{t("settings.language.fr-FR")}</option>
            <option value="ru-RU">{t("settings.language.ru-RU")}</option>
            <option value="ar-SA">{t("settings.language.ar-SA")}</option>
          </select>
          <p className="text-xs text-zinc-500">{t("settings.translation.hint")}</p>
          {draftSttOutputStrategy !== "llmRefine" && (
            <p className="text-xs text-amber-700">{t("settings.stt.translationRequiresRefine")}</p>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1">
            <label className="font-medium">{t("settings.stt.punctuation")}</label>
            <select
              className="w-full input-field px-3 py-2"
              value={draftPunctuationMode}
              onChange={(event) => onPunctuationModeChange(event.target.value as PunctuationMode)}
            >
              <option value="off">{t("settings.stt.punctuationOff")}</option>
              <option value="balanced">{t("settings.stt.punctuationBalanced")}</option>
              <option value="aggressive">{t("settings.stt.punctuationAggressive")}</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="font-medium">{t("settings.stt.vocabulary")}</label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".txt,.csv"
                onChange={(event) => void onImportVocabularyFile(event.target.files?.[0] ?? null)}
                className="text-xs"
              />
              <span className="text-xs text-zinc-500">{t("settings.stt.vocabularyFileHint")}</span>
            </div>
          </div>
        </div>

        <textarea
          className="w-full min-h-[112px] input-field px-3 py-2 text-xs font-mono"
          value={draftVocabularyTerms}
          onChange={(event) => onVocabularyTermsChange(event.target.value)}
          placeholder={t("settings.stt.vocabularyPlaceholder")}
        />
      </div>

      <div className="settings-card space-y-3">
        <div>
          <label className="font-medium">{t("settings.stt.modelDownloadTitle")}</label>
          <p className="mt-1 text-xs text-zinc-500">{t("settings.stt.modelDownloadHint")}</p>
        </div>

        {!localSttAvailable && (
          <p className="text-xs text-amber-700">{t("settings.stt.localNotEnabledHint")}</p>
        )}

        <div className="space-y-2">
          {localModelsLoading && (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-xs text-zinc-500">
              {t("settings.stt.loadingModels")}
            </div>
          )}

          {!localModelsLoading && localModels.map((model) => {
            const isBusy = localModelBusyId === model.id;
            const downloadProgress = localModelDownloadProgress[model.id];
            const isInstalling = isBusy && localModelBusyAction === "install";
            const isDownloadActive =
              downloadProgress?.status === "start" || downloadProgress?.status === "downloading";
            const progressPct = Math.max(0, Math.min(100, Math.round(downloadProgress?.progressPct ?? 0)));
            const downloadedBytes = downloadProgress?.downloadedBytes ?? 0;
            const totalBytes = downloadProgress?.totalBytes ?? 0;

            return (
              <div key={model.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{getLocalizedModelName(model)}</p>
                    <p className="text-xs text-zinc-500">{getLocalizedModelDescription(model)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {model.active && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">
                        {t("settings.stt.inUse")}
                      </span>
                    )}
                    {model.installed && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] text-green-700">
                        {t("settings.stt.installed")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[11px] text-zinc-600">
                    <span className="w-10">{t("settings.stt.speed")}</span>
                    <div className="flex gap-1">
                      {RATING_INDICES.map((idx) => (
                        <span
                          key={`speed-${model.id}-${idx}`}
                          className={`h-1.5 w-4 rounded ${idx < model.speed ? "bg-emerald-500" : "bg-zinc-200"}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-600">
                    <span className="w-10">{t("settings.stt.accuracy")}</span>
                    <div className="flex gap-1">
                      {RATING_INDICES.map((idx) => (
                        <span
                          key={`accuracy-${model.id}-${idx}`}
                          className={`h-1.5 w-4 rounded ${idx < model.accuracy ? "bg-blue-500" : "bg-zinc-200"}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!model.installed ? (
                    <>
                      <button
                        onClick={() => void onInstallLocalModel(model.id)}
                        disabled={!!localModelBusyId}
                        className="btn-primary px-2.5 py-1 text-xs"
                      >
                        {isDownloadActive || isInstalling
                          ? `${t("settings.stt.installing")} ${progressPct}%`
                          : failedDownloadModelId === model.id
                            ? t("settings.stt.retry")
                            : t("settings.stt.install")}
                      </button>
                      {(isDownloadActive || isInstalling) && (
                        <button
                          onClick={() => void onCancelLocalModelDownload()}
                          className="btn-secondary px-2.5 py-1 text-xs"
                        >
                          {t("settings.cancel")}
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => void onDeleteLocalModel(model.id)}
                      disabled={!!localModelBusyId}
                      className="btn-danger px-2.5 py-1 text-xs"
                    >
                      {isBusy && localModelBusyAction === "delete" ? t("settings.stt.deleting") : t("settings.stt.delete")}
                    </button>
                  )}
                </div>

                {downloadProgress && (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-200">
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
                    <p className="text-[11px] text-zinc-600">
                      {progressPct}% ({formatBytes(downloadedBytes)} / {formatBytes(totalBytes)})
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {downloadProgress.status === "downloading" || downloadProgress.status === "start"
                        ? t("settings.stt.installing")
                        : downloadProgress.status === "done"
                          ? t("settings.status.modelInstalled")
                          : downloadProgress.status === "cancelled"
                            ? t("settings.status.modelInstallCancelled")
                            : t("settings.status.modelInstallFailed")}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {localModelStatus.type === "success" && (
          <p className="text-xs text-green-600">{localModelStatus.message}</p>
        )}
        {localModelStatus.type === "error" && (
          <p className="text-xs text-red-600">{localModelStatus.message}</p>
        )}
      </div>
    </div>
  );
}
