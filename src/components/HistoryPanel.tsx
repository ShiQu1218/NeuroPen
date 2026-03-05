import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../i18n";

interface HistoryEntry {
  id: string;
  timestamp: number;
  mode: string;
  inputText: string;
  instruction: string;
  output: string;
  provider: string;
  model: string;
}

const MODE_LABELS: Record<string, string> = {
  A: "Voice Input",
  B1: "Quick Action",
  B2: "Voice + Selection",
  C: "LLM Query",
};

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
  const { t } = useI18n();

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

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200">
        <input
          className="flex-1 input-field px-2.5 py-1.5 text-sm"
          placeholder={t("history.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {entries.length > 0 && (
          <button
            className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap"
            onClick={handleClear}
          >
            {t("history.clearAll")}
          </button>
        )}
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="p-4 text-center text-zinc-400 text-sm">
            {t("history.empty")}
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors"
            >
              {/* Header */}
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                onClick={() =>
                  setExpanded(expanded === entry.id ? null : entry.id)
                }
              >
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                  {MODE_LABELS[entry.mode] || entry.mode}
                </span>
                <span className="flex-1 text-sm text-zinc-700 truncate">
                  {entry.instruction || entry.inputText || entry.output}
                </span>
                <span className="text-[10px] text-zinc-400 whitespace-nowrap">
                  {formatTime(entry.timestamp)}
                </span>
              </div>

              {/* Expanded details */}
              {expanded === entry.id && (
                <div className="px-3 pb-3 space-y-2 text-xs">
                  {entry.inputText && (
                    <div>
                      <span className="font-semibold text-zinc-500">
                        {t("history.input")}:
                      </span>
                      <p className="mt-0.5 text-zinc-600 whitespace-pre-wrap">
                        {entry.inputText}
                      </p>
                    </div>
                  )}
                  {entry.instruction && (
                    <div>
                      <span className="font-semibold text-zinc-500">
                        {t("history.instruction")}:
                      </span>
                      <p className="mt-0.5 text-zinc-600 whitespace-pre-wrap">
                        {entry.instruction}
                      </p>
                    </div>
                  )}
                  {entry.output && (
                    <div>
                      <span className="font-semibold text-zinc-500">
                        {t("history.output")}:
                      </span>
                      <p className="mt-0.5 text-zinc-600 whitespace-pre-wrap">
                        {entry.output}
                      </p>
                    </div>
                  )}
                  <div className="text-[10px] text-zinc-400">
                    {entry.provider} / {entry.model}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      className="text-[10px] text-blue-600 hover:text-blue-800"
                      onClick={() => handleCopy(entry.output)}
                    >
                      {t("history.copyOutput")}
                    </button>
                    <button
                      className="text-[10px] text-red-500 hover:text-red-700"
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
