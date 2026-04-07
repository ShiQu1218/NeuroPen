import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useI18n } from "../i18n";
import { mainWindowService } from "../services/mainWindowService";
import { useAppStore } from "../store/useAppStore";
import {
  buildOtherPreferenceCategory,
  composePromptOverride,
  generatePreferenceRequestId,
  resolveHistoryPreferenceCategory,
  resolveHistoryRequestId,
  type PreferenceFeedbackRating,
} from "../utils/preferenceLearning";
import { resolveLanguageVariantPromptInstructionForText } from "../utils/languageVariants";
import { PREVIEW_DEFAULT_SIZE } from "../utils/previewLayout";
import { emitPreviewSession, showPreviewWindow } from "../utils/previewWindow";
import { APP_WORKFLOW_LABEL_KEYS } from "../utils/workflowLabels";

interface HistoryEntry {
  id: string;
  timestamp: number;
  mode: string;
  inputText: string;
  instruction: string;
  output: string;
  provider: string;
  model: string;
  favorited: boolean;
  requestId?: string;
  feedbackRating?: PreferenceFeedbackRating;
  preferenceCategoryKey?: string;
  preferenceCategoryLabel?: string;
  quickActionCommandId?: string;
}

type FilterTab = "all" | "favorites";

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function HistoryPanel() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const { t } = useI18n();
  const preferenceLearningEnabled = useAppStore((state) => state.preferenceLearningEnabled);
  const incognito = useAppStore((state) => state.incognito);
  const quickActionCommands = useAppStore((state) => state.quickActionCommands);

  const loadHistory = useCallback(async () => {
    try {
      if (search.trim()) {
        const results = await invoke<HistoryEntry[]>("history_search", { query: search });
        setEntries(results);
      } else {
        const all = await invoke<HistoryEntry[]>("history_list");
        setEntries(all);
      }
    } catch (e) {
      console.error("Failed to load history:", e);
    }
  }, [search]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleDelete = async (id: string) => {
    await invoke("history_delete", { id });
    loadHistory();
  };

  const handleClear = async () => {
    await invoke("history_clear");
    setEntries([]);
  };

  const handleCopy = async (text: string) => {
    await invoke("copy_to_clipboard", { text });
  };

  const handleToggleFavorite = async (id: string) => {
    await invoke<boolean | null>("history_toggle_favorite", { id });
    loadHistory();
  };

  const handleReExecute = async (entry: HistoryEntry) => {
    const state = useAppStore.getState();
    const sourceMode =
      entry.mode === "A" || entry.mode === "B1" || entry.mode === "B2" || entry.mode === "C"
        ? entry.mode
        : "C";
    const promptMode = (entry.mode === "B1" || entry.mode === "B2") ? "B" : entry.mode === "A" ? "A" : "C";
    const category = buildOtherPreferenceCategory(t("history.preferenceOther"));
    const requestId = generatePreferenceRequestId();
    const basePrompt =
      promptMode === "B" ? state.modeBPrompt : promptMode === "A" ? state.modeAPrompt : state.modeCPrompt;
    const learnedSummary =
      state.preferenceLearningEnabled
        ? await mainWindowService.preferenceGetSummary(category.key).catch(() => null)
        : null;
    const promptOverride = composePromptOverride(basePrompt, "", learnedSummary ?? "");

    // Set up session context
    state.setLastSelectedText(entry.inputText);
    state.setLastInstruction(entry.instruction);
    state.setCurrentRequestContext({
      requestId,
      preferenceCategoryKey: category.key,
      preferenceCategoryLabel: category.label,
    });
    state.setCurrentFeedbackRating(null);

    await emit("neuropen://llm-session-context", {
      mode: sourceMode,
      selectedText: entry.inputText,
      instruction: entry.instruction,
      requestId,
      preferenceCategoryKey: category.key,
      preferenceCategoryLabel: category.label,
    });

    await emitPreviewSession({
      sessionType: "text",
      sourceMode: sourceMode as "A" | "B1" | "B2" | "C",
      selectedText: entry.inputText,
      instruction: entry.instruction,
      preferredLanguage: resolveLanguageVariantPromptInstructionForText(
        `${entry.inputText}\n${entry.instruction}`,
        state.preferredLanguage,
        state.customLanguageVariants
      ),
      requestId,
      preferenceCategoryKey: category.key,
      preferenceCategoryLabel: category.label,
    });
    await showPreviewWindow({
      focusable: true,
      focus: true,
      size: PREVIEW_DEFAULT_SIZE,
    });

    try {
      await mainWindowService.callLlm({
        selectedText: entry.inputText,
        instruction: entry.instruction,
        outputMode: "PreviewStream",
        provider: state.llmProvider,
        model: state.llmModel,
        preferredLanguage: resolveLanguageVariantPromptInstructionForText(
          `${entry.inputText}\n${entry.instruction}`,
          state.preferredLanguage,
          state.customLanguageVariants
        ),
        promptMode,
        promptOverride,
        streamOutput: true,
        requestId,
      });
    } catch (err) {
      console.error("[History] re-execute call_llm failed:", err);
      state.setLlmError(String(err));
    }
  };

  const handleApplyToSelection = async (entry: HistoryEntry) => {
    if (!entry.instruction) return;

    const state = useAppStore.getState();
    const category = buildOtherPreferenceCategory(t("history.preferenceOther"));
    const requestId = generatePreferenceRequestId();

    // Get current selection
    let selectedText = "";
    try {
      const sel = await invoke<{ has_selection: boolean; text: string | null }>("get_selection");
      if (sel.has_selection && sel.text) {
        selectedText = sel.text;
      }
    } catch (err) {
      console.error("[History] get_selection failed:", err);
    }

    if (!selectedText) return;

    state.setLastSelectedText(selectedText);
    state.setLastInstruction(entry.instruction);
    state.setCurrentRequestContext({
      requestId,
      preferenceCategoryKey: category.key,
      preferenceCategoryLabel: category.label,
    });
    state.setCurrentFeedbackRating(null);

    await emit("neuropen://llm-session-context", {
      mode: "B1",
      selectedText,
      instruction: entry.instruction,
      requestId,
      preferenceCategoryKey: category.key,
      preferenceCategoryLabel: category.label,
    });

    await emitPreviewSession({
      sessionType: "text",
      sourceMode: "B1",
      selectedText,
      instruction: entry.instruction,
      preferredLanguage: resolveLanguageVariantPromptInstructionForText(
        `${selectedText}\n${entry.instruction}`,
        state.preferredLanguage,
        state.customLanguageVariants
      ),
      requestId,
      preferenceCategoryKey: category.key,
      preferenceCategoryLabel: category.label,
    });
    await showPreviewWindow({
      focusable: true,
      focus: true,
      size: PREVIEW_DEFAULT_SIZE,
    });

    try {
      const learnedSummary =
        state.preferenceLearningEnabled
          ? await mainWindowService.preferenceGetSummary(category.key).catch(() => null)
          : null;
      await mainWindowService.callLlm({
        selectedText,
        instruction: entry.instruction,
        outputMode: "PreviewStream",
        provider: state.llmProvider,
        model: state.llmModel,
        preferredLanguage: resolveLanguageVariantPromptInstructionForText(
          `${selectedText}\n${entry.instruction}`,
          state.preferredLanguage,
          state.customLanguageVariants
        ),
        promptMode: "B",
        promptOverride: composePromptOverride(state.modeBPrompt, "", learnedSummary ?? ""),
        streamOutput: state.modeBStreamOutput,
        requestId,
      });
    } catch (err) {
      console.error("[History] apply-to-selection call_llm failed:", err);
      state.setLlmError(String(err));
    }
  };

  const handleAddToQuickAction = (entry: HistoryEntry) => {
    if (!entry.instruction) return;

    const state = useAppStore.getState();
    const existing = state.quickActionCommands;

    // Avoid duplicates by instruction
    if (existing.some((cmd) => cmd.instruction === entry.instruction)) return;

    const newCommand = {
      id: `history-${Date.now()}`,
      label: entry.instruction.length > 20
        ? entry.instruction.slice(0, 20) + "…"
        : entry.instruction,
      instruction: entry.instruction,
    };

    state.setQuickActionCommands([...existing, newCommand]);
  };

  const handleRate = async (entry: HistoryEntry, rating: PreferenceFeedbackRating) => {
    if (!preferenceLearningEnabled || incognito || !entry.output.trim()) {
      return;
    }
    const state = useAppStore.getState();
    const category = resolveHistoryPreferenceCategory(
      entry,
      quickActionCommands,
      t("history.preferenceOther"),
    );
    await mainWindowService.preferenceRateResult({
      historyId: entry.id,
      requestId: resolveHistoryRequestId({ id: entry.id, requestId: entry.requestId }),
      rating,
      mode: entry.mode,
      inputText: entry.inputText,
      instruction: entry.instruction,
      output: entry.output,
      outputProvider: entry.provider,
      outputModel: entry.model,
      categoryKey: category.key,
      categoryLabel: category.label,
      quickActionCommandId: category.quickActionCommandId,
      analysisProvider: state.llmProvider,
      analysisModel: state.llmModel,
      appLanguage: state.language,
    });
    await loadHistory();
  };

  const displayedEntries = filter === "favorites"
    ? entries.filter((e) => e.favorited)
    : entries;

  return (
    <div className="flex h-full flex-col rounded-[22px] border border-zinc-200 bg-white/70 dark:border-zinc-700 dark:bg-zinc-950/50">
      {/* Search bar */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <input
          className="flex-1 input-field px-2.5 py-1.5 text-sm"
          placeholder={t("history.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {entries.length > 0 && (
          <button
            className="whitespace-nowrap text-xs text-red-500 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
            onClick={handleClear}
          >
            {t("history.clearAll")}
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
        <button
          className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
            filter === "all"
              ? "bg-blue-100 text-blue-700 font-medium dark:bg-blue-950/70 dark:text-blue-200"
              : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
          onClick={() => setFilter("all")}
        >
          {t("history.filterAll")}
        </button>
        <button
          className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
            filter === "favorites"
              ? "bg-amber-100 text-amber-700 font-medium dark:bg-zinc-100 dark:text-zinc-950"
              : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
          onClick={() => setFilter("favorites")}
        >
          {t("history.filterFavorites")}
        </button>
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-auto">
        {displayedEntries.length === 0 ? (
          <div className="p-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
            {t("history.empty")}
          </div>
        ) : (
          displayedEntries.map((entry) => (
            <div
              key={entry.id}
              className="border-b border-zinc-100 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/60"
            >
              {/* Header */}
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                onClick={() =>
                  setExpanded(expanded === entry.id ? null : entry.id)
                }
              >
                {entry.favorited && (
                  <span className="text-[11px] text-amber-500 dark:text-zinc-100">★</span>
                )}
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-mono text-blue-700 dark:bg-blue-950/70 dark:text-blue-200">
                  {(() => {
                    const workflowLabelKey =
                      APP_WORKFLOW_LABEL_KEYS[entry.mode as keyof typeof APP_WORKFLOW_LABEL_KEYS];
                    return workflowLabelKey ? t(workflowLabelKey) : entry.mode;
                  })()}
                </span>
                <span className="flex-1 truncate text-sm text-zinc-700 dark:text-zinc-200">
                  {entry.instruction || entry.inputText || entry.output}
                </span>
                <span className="whitespace-nowrap text-[10px] text-zinc-400 dark:text-zinc-500">
                  {formatTime(entry.timestamp)}
                </span>
              </div>

              {/* Expanded details */}
              {expanded === entry.id && (
                <div className="px-3 pb-3 space-y-2 text-xs">
                  {entry.inputText && (
                    <div>
                      <span className="font-semibold text-zinc-500 dark:text-zinc-400">
                        {t("history.input")}:
                      </span>
                      <p className="mt-0.5 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
                        {entry.inputText}
                      </p>
                    </div>
                  )}
                  {entry.instruction && (
                    <div>
                      <span className="font-semibold text-zinc-500 dark:text-zinc-400">
                        {t("history.instruction")}:
                      </span>
                      <p className="mt-0.5 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
                        {entry.instruction}
                      </p>
                    </div>
                  )}
                  {entry.output && (
                    <div>
                      <span className="font-semibold text-zinc-500 dark:text-zinc-400">
                        {t("history.output")}:
                      </span>
                      <p className="mt-0.5 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
                        {entry.output}
                      </p>
                    </div>
                  )}
                  {(entry.provider || entry.model) && (
                    <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      {entry.provider} / {entry.model}
                    </div>
                  )}
                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
                    <button
                      className={`text-[10px] ${
                        entry.feedbackRating === "up"
                          ? "text-emerald-600 dark:text-emerald-300"
                          : "text-zinc-400 hover:text-emerald-600 dark:text-zinc-500 dark:hover:text-emerald-300"
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                      disabled={!preferenceLearningEnabled || incognito}
                      onClick={() => void handleRate(entry, "up")}
                      title={
                        incognito
                          ? t("history.preferenceDisabledIncognito")
                          : !preferenceLearningEnabled
                            ? t("history.preferenceDisabledSetting")
                            : t("history.feedbackUp")
                      }
                    >
                      {t("history.feedbackUp")}
                    </button>
                    <button
                      className={`text-[10px] ${
                        entry.feedbackRating === "down"
                          ? "text-rose-600 dark:text-rose-300"
                          : "text-zinc-400 hover:text-rose-600 dark:text-zinc-500 dark:hover:text-rose-300"
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                      disabled={!preferenceLearningEnabled || incognito}
                      onClick={() => void handleRate(entry, "down")}
                      title={
                        incognito
                          ? t("history.preferenceDisabledIncognito")
                          : !preferenceLearningEnabled
                            ? t("history.preferenceDisabledSetting")
                            : t("history.feedbackDown")
                      }
                    >
                      {t("history.feedbackDown")}
                    </button>
                    <button
                      className="text-[10px] text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                      onClick={() => handleReExecute(entry)}
                    >
                      {t("history.reExecute")}
                    </button>
                    {entry.instruction && (
                      <button
                        className="text-[10px] text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                        onClick={() => handleApplyToSelection(entry)}
                      >
                        {t("history.applyToSelection")}
                      </button>
                    )}
                    {entry.instruction && (
                      <button
                        className="text-[10px] text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                        onClick={() => handleAddToQuickAction(entry)}
                      >
                        {t("history.addToQuickAction")}
                      </button>
                    )}
                    <button
                      className="text-[10px] text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                      onClick={() => handleCopy(entry.output)}
                    >
                      {t("history.copyOutput")}
                    </button>
                    <button
                      className={`text-[10px] ${
                        entry.favorited
                          ? "text-amber-500 hover:text-amber-700 dark:text-zinc-100 dark:hover:text-white"
                          : "text-zinc-400 hover:text-amber-500 dark:text-zinc-500 dark:hover:text-zinc-100"
                      }`}
                      onClick={() => handleToggleFavorite(entry.id)}
                    >
                      {entry.favorited ? t("history.unfavorite") : t("history.favorite")}
                    </button>
                    <button
                      className="text-[10px] text-red-500 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
                      onClick={() => handleDelete(entry.id)}
                    >
                      {t("history.delete")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
