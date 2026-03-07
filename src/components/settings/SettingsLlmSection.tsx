import type { useI18n } from "../../i18n";
import type { LlmProvider, OutputMode, PreferredLanguage } from "../../store/useAppStore";

interface SettingsLlmSectionProps {
  draftOutputMode: OutputMode;
  draftModeAStreamOutput: boolean;
  draftModeBStreamOutput: boolean;
  draftLlmProvider: LlmProvider;
  draftLlmModel: string;
  draftLlmModelOptions: string[];
  draftPreferredLanguage: PreferredLanguage;
  draftModeAPrompt: string;
  draftModeBPrompt: string;
  draftModeCPrompt: string;
  apiKeySet: boolean;
  apiKeyInput: string;
  apiKeySaveStatus: "" | "saving" | "saved" | "error";
  onOutputModeChange: (value: OutputMode) => void;
  onModeAStreamOutputChange: (value: boolean) => void;
  onModeBStreamOutputChange: (value: boolean) => void;
  onLlmProviderChange: (value: LlmProvider) => void;
  onLlmModelChange: (value: string) => void;
  onAddLlmModelOption: () => void;
  onDeleteLlmModelOption: (modelToDelete: string) => void;
  onPreferredLanguageChange: (value: PreferredLanguage) => void;
  onModeAPromptChange: (value: string) => void;
  onModeBPromptChange: (value: string) => void;
  onModeCPromptChange: (value: string) => void;
  onApiKeyInputChange: (value: string) => void;
  onSaveApiKey: () => void;
  t: ReturnType<typeof useI18n>["t"];
}

export default function SettingsLlmSection({
  draftOutputMode,
  draftModeAStreamOutput,
  draftModeBStreamOutput,
  draftLlmProvider,
  draftLlmModel,
  draftLlmModelOptions,
  draftPreferredLanguage,
  draftModeAPrompt,
  draftModeBPrompt,
  draftModeCPrompt,
  apiKeySet,
  apiKeyInput,
  apiKeySaveStatus,
  onOutputModeChange,
  onModeAStreamOutputChange,
  onModeBStreamOutputChange,
  onLlmProviderChange,
  onLlmModelChange,
  onAddLlmModelOption,
  onDeleteLlmModelOption,
  onPreferredLanguageChange,
  onModeAPromptChange,
  onModeBPromptChange,
  onModeCPromptChange,
  onApiKeyInputChange,
  onSaveApiKey,
  t,
}: SettingsLlmSectionProps) {
  return (
    <>
      <div className="space-y-1">
        <label className="font-medium">{t("settings.llm.outputMode")}</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="outputMode"
              value="PreviewStream"
              checked={draftOutputMode === "PreviewStream"}
              onChange={() => onOutputModeChange("PreviewStream")}
            />
            {t("settings.llm.previewStream")}
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="outputMode"
              value="DirectInject"
              checked={draftOutputMode === "DirectInject"}
              onChange={() => onOutputModeChange("DirectInject")}
            />
            {t("settings.llm.directInject")}
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <label className="font-medium">{t("settings.llm.streamToggles")}</label>
        <p className="text-xs text-gray-400">{t("settings.llm.streamTogglesHint")}</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draftModeAStreamOutput}
            onChange={(event) => onModeAStreamOutputChange(event.target.checked)}
          />
          <span>{t("settings.llm.modeAStreamOutput")}</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draftModeBStreamOutput}
            onChange={(event) => onModeBStreamOutputChange(event.target.checked)}
          />
          <span>{t("settings.llm.modeBStreamOutput")}</span>
        </label>
      </div>

      <div className="space-y-1">
        <label className="font-medium">{t("settings.llm.provider")}</label>
        <select
          className="w-full input-field px-2 py-1"
          value={draftLlmProvider}
          onChange={(event) => onLlmProviderChange(event.target.value as LlmProvider)}
        >
          <option value="openAi">OpenAI</option>
          <option value="gemini">Gemini</option>
          <option value="claude">Claude</option>
          <option value="grok">Grok</option>
          <option value="qwen">Qwen</option>
          <option value="doubao">豆包 Doubao</option>
          <option value="deepseek">DeepSeek</option>
          <option value="ollama">{t("settings.llm.ollamaLocal")}</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="font-medium">{t("settings.llm.model")}</label>
        <select
          className="w-full input-field px-2 py-1 font-mono text-xs"
          value={draftLlmModel}
          onChange={(event) => onLlmModelChange(event.target.value)}
        >
          {draftLlmModelOptions.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <input
          className="w-full input-field px-2 py-1 font-mono text-xs"
          value={draftLlmModel}
          onChange={(event) => onLlmModelChange(event.target.value)}
          placeholder="e.g. gpt-4o-mini / qwen-plus / doubao-seed-1-6-250615 / deepseek-chat / llama3.2"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAddLlmModelOption}
            disabled={!draftLlmModel.trim()}
            className="btn-secondary px-2 py-1 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("settings.llm.modelAdd")}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {draftLlmModelOptions.map((model) => (
            <button
              key={`saved-model-${model}`}
              type="button"
              onClick={() => onDeleteLlmModelOption(model)}
              className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] hover:bg-red-100 hover:text-red-700"
            >
              {model} ×
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">{t("settings.llm.modelHint")}</p>
      </div>

      <div className="space-y-1">
        <label className="font-medium">{t("settings.preferredLanguage.label")}</label>
        <select
          className="w-full input-field px-2 py-1"
          value={draftPreferredLanguage}
          onChange={(event) => onPreferredLanguageChange(event.target.value as PreferredLanguage)}
        >
          <option value="auto">{t("settings.preferredLanguage.auto")}</option>
          <option value="zh-TW">{t("settings.language.zh-TW")}</option>
          <option value="zh-CN">{t("settings.language.zh-CN")}</option>
          <option value="en-US">English</option>
          <option value="ja-JP">日本語</option>
          <option value="es-ES">Español</option>
          <option value="ko-KR">한국어</option>
          <option value="de-DE">Deutsch</option>
          <option value="fr-FR">Français</option>
          <option value="ar-SA">العربية</option>
          <option value="ru-RU">Русский</option>
        </select>
        <p className="text-xs text-gray-400">{t("settings.preferredLanguage.hint")}</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="font-medium">{t("settings.llm.modePrompts")}</label>
          <p className="text-xs text-gray-400">{t("settings.llm.modePromptsHint")}</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-600">{t("settings.llm.modeAPrompt")}</label>
          <textarea
            className="w-full min-h-[92px] input-field px-3 py-2 text-xs leading-5"
            value={draftModeAPrompt}
            onChange={(event) => onModeAPromptChange(event.target.value)}
            placeholder={t("settings.llm.modeAPromptPlaceholder")}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-600">{t("settings.llm.modeBPrompt")}</label>
          <textarea
            className="w-full min-h-[92px] input-field px-3 py-2 text-xs leading-5"
            value={draftModeBPrompt}
            onChange={(event) => onModeBPromptChange(event.target.value)}
            placeholder={t("settings.llm.modeBPromptPlaceholder")}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-600">{t("settings.llm.modeCPrompt")}</label>
          <textarea
            className="w-full min-h-[92px] input-field px-3 py-2 text-xs leading-5"
            value={draftModeCPrompt}
            onChange={(event) => onModeCPromptChange(event.target.value)}
            placeholder={t("settings.llm.modeCPromptPlaceholder")}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="font-medium">{t("settings.llm.apiKey")}</label>
        {draftLlmProvider === "ollama" && (
          <p className="text-xs text-gray-500">{t("settings.llm.ollamaNoKey")}</p>
        )}
        {apiKeySet && (
          <p className="text-xs text-green-600">{t("settings.llm.apiKeySet")}</p>
        )}
        <div className="flex gap-2">
          <input
            type="password"
            className="flex-1 input-field px-2 py-1 font-mono text-xs"
            value={apiKeyInput}
            onChange={(event) => onApiKeyInputChange(event.target.value)}
            placeholder={apiKeySet ? "••••••••" : t("settings.llm.apiKeyPlaceholder")}
            onKeyDown={(event) => {
              if (event.key === "Enter" && apiKeyInput) onSaveApiKey();
            }}
          />
          <button
            onClick={onSaveApiKey}
            disabled={!apiKeyInput || apiKeySaveStatus === "saving"}
            className="px-3 py-1 rounded text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {apiKeySaveStatus === "saving" ? t("settings.llm.saving") : t("settings.llm.save")}
          </button>
        </div>
        {apiKeySaveStatus === "saved" && (
          <p className="text-xs text-green-600">{t("settings.llm.savedToMemory")}</p>
        )}
        {apiKeySaveStatus === "error" && (
          <p className="text-xs text-red-600">{t("settings.llm.saveFailed")}</p>
        )}
      </div>
    </>
  );
}
